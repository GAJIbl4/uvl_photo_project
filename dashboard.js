'use strict'

const http = require('node:http')
const { inspect } = require('node:util')
const { WebSocketServer, WebSocket } = require('ws')
const fs = require('node:fs')
const { join } = require('node:path')
const archiver = require('archiver')
const { log } = require('./utils')
const lodashSet = require('lodash/set')
const lodashGet = require('lodash/get')
const EventEmitter = require('node:events')
const finalhandler = require('finalhandler')
const serveStatic = require('serve-static')
const { 
  getCameraSettings, 
  updateCameraSettings, 
  reloadCamera,
  getPhotoList,
  deleteAllPhotos,
  getCameraModes,
  getExposureModes,
  getMeteringModes,
  getAwbModes
} = require('./photo')
const { existsSync } = require('node:fs')
require('./dashboard-make')

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

const inspectCustom = v => typeof v === 'string' ? v : inspect(v, {
  showHidden: false,
  depth: Infinity,
  colors: true,
})

const console_log = console.log
console.log = (...args) => {
  const logstr = args.map(inspectCustom).join(' ')
  setDashboardState('logs', logs => logs ? [...logs, logstr] : [logstr])
  console_log(...args)
}

const dashboardLog = (type, ...args) => {
  const logstr = args.map(inspectCustom).join(' ')
  setDashboardState('logsTyped.' + type, logstr)
}

const serve = serveStatic('./dashboard-public')
const server = http.createServer((req, res) => {
  const done = finalhandler(req, res)
  serve(req, res, done)
})
server.listen(8080, '0.0.0.0', () => console.log('[dashboard]: http online @ port ', 8080))


let dashboardState = {}
let dashboardStateJSON = ''

const sendDashboardState = (ws) => {
  if (ws.readyState === WebSocket.OPEN && ws !== wss)
    ws.send('state:' + dashboardStateJSON)
}

const sendDashboardStateToAll = () =>
  wss.clients.forEach(sendDashboardState)

const setDashboardState = (...args) => {
  if (args.length === 2) {
    if (typeof args[1] === 'function') {
      lodashSet(dashboardState, args[0], args[1](lodashGet(dashboardState, args[0])))
    } else {
      lodashSet(dashboardState, args[0], args[1])
    }
  } else if (typeof args[0] === 'function') {
    dashboardState = args[0](dashboardState)
  } else {
    dashboardState = args[0]
  }
  dashboardStateJSON = JSON.stringify(dashboardState)
  sendDashboardStateToAll()
}

const wss = new WebSocketServer({ port: 8081 })
wss.on('connection', ws => {
  ws.on('error', console.error)
  const close = () => ws.close()
  let closeTimeout
  ws.on('message', (data, isBinary) => {
    clearTimeout(closeTimeout)
    closeTimeout = setTimeout(close, 60 * 1000)
    if (!isBinary)
      data = data.toString('utf-8')
    const sepIndex = data.indexOf(':')
    const name = sepIndex > 0 ? data.slice(0, sepIndex) : data
    const payload = sepIndex > 0 ? data.slice(sepIndex + 1) : null
    if (name === 'ping')
      ws.send('pong')
    else if (name === 'download')
      fs.promises.readFile(payload, 'base64')
        .then(data => ws.send(`download:${payload}:${data}`))
        .catch(err => ws.send(`error:${err.message}`))
    else if (name === 'getLastPhoto') {
      // Отправка последней фотографии
      const lastPhoto = lodashGet(dashboardState, 'lastPhoto')
      if (lastPhoto && lastPhoto.path) {
        fs.promises.access(lastPhoto.path, fs.constants.F_OK)
          .then(() => fs.promises.readFile(lastPhoto.path, 'base64'))
          .then(data => ws.send(`lastPhoto:${lastPhoto.id}:${data}`))
          .catch(err => ws.send(`error:${err.message}`))
      } else {
        ws.send(`error:No photo available`)
      }
    } else if (name === 'downloadPhotosArchive') {
      // Создание и отправка архива со всеми фотографиями
      try {
        const photos = getPhotoList()
        if (photos.length === 0) {
          ws.send(`error:Нет фотографий для выгрузки`)
          return
        }
        
        console.log(`[dashboard]: Creating archive with ${photos.length} photos`)
        
        const archive = archiver('zip', { zlib: { level: 9 } })
        const chunks = []
        
        archive.on('data', chunk => {
          chunks.push(chunk)
        })
        
        archive.on('end', () => {
          const buffer = Buffer.concat(chunks)
          const base64 = buffer.toString('base64')
          console.log(`[dashboard]: Archive created, size: ${buffer.length} bytes`)
          ws.send(`photosArchive:${base64}`)
        })
        
        archive.on('error', err => {
          console.error('[dashboard]: Archive error:', err)
          ws.send(`error:Ошибка при создании архива: ${err.message}`)
        })
        
        photos.forEach(photo => {
          try {
            if (fs.existsSync(photo.path)) {
              archive.file(photo.path, { name: photo.filename })
            } else {
              console.warn(`[dashboard]: Photo file not found: ${photo.path}`)
            }
          } catch (err) {
            console.error(`[dashboard]: Error adding photo ${photo.filename}:`, err.message)
          }
        })
        
        archive.finalize()
      } catch (err) {
        console.error('[dashboard]: Failed to create archive:', err)
        ws.send(`error:Не удалось создать архив: ${err.message}`)
      }
    } else if (name === 'getCameraSettings') {
      const settings = getCameraSettings()
      const modes = getCameraModes()
      const exposureModes = getExposureModes()
      const meteringModes = getMeteringModes()
      const awbModes = getAwbModes()
      ws.send(`cameraSettings:${JSON.stringify({ 
        ...settings, 
        cameraModes: modes,
        exposureModes,
        meteringModes,
        awbModes
      })}`)
    } else if (name === 'updateCameraSettings') {
      try {
        const settings = JSON.parse(payload)
        const result = updateCameraSettings(settings)
        const modes = getCameraModes()
        const exposureModes = getExposureModes()
        const meteringModes = getMeteringModes()
        const awbModes = getAwbModes()
        const settingsWithModes = { 
          ...result.settings, 
          cameraModes: modes,
          exposureModes,
          meteringModes,
          awbModes
        }
        if (result.success) {
          ws.send(`cameraSettings:${JSON.stringify(settingsWithModes)}`)
          setDashboardState('cameraSettings', settingsWithModes)
          if (result.warnings && result.warnings.length > 0) {
            ws.send(`warning:${result.warnings.join('; ')}`)
          } else {
            ws.send(`info:Настройки сохранены успешно`)
          }
        } else {
          ws.send(`error:${result.errors.join('; ')}`)
          ws.send(`cameraSettings:${JSON.stringify(settingsWithModes)}`)
        }
      } catch (err) {
        ws.send(`error:${err.message}`)
      }
    } else if (name === 'reloadCamera') {
      reloadCamera().then(result => {
        const modes = getCameraModes()
        const exposureModes = getExposureModes()
        const meteringModes = getMeteringModes()
        const awbModes = getAwbModes()
        if (result.success) {
          ws.send(`cameraSettings:${JSON.stringify({ 
            ...result.settings, 
            cameraModes: modes,
            exposureModes,
            meteringModes,
            awbModes
          })}`)
          setDashboardState('cameraSettings', result.settings)
          if (result.warnings && result.warnings.length > 0) {
            ws.send(`warning:Камера перезагружена. Предупреждения: ${result.warnings.join('; ')}`)
          } else {
            ws.send(`info:Камера перезагружена успешно`)
          }
        } else {
          ws.send(`error:${result.error}`)
          ws.send(`cameraSettings:${JSON.stringify({ 
            ...result.settings, 
            cameraModes: modes,
            exposureModes,
            meteringModes,
            awbModes
          })}`)
        }
      }).catch(err => {
        ws.send(`error:${err.message}`)
      })
    } else if (name === 'deleteAllPhotos') {
      try {
        const result = deleteAllPhotos()
        if (result.error) {
          ws.send(`error:${result.error}`)
        } else {
          ws.send(`info:Deleted ${result.deleted} photos`)
          setDashboardState('lastPhoto', null)
        }
      } catch (err) {
        ws.send(`error:${err.message}`)
      }
    } else {
      if (payload === null)
        dashboard.emit(name, ws)
      else
        dashboard.emit(name, payload, ws)
    }
  })
  sendDashboardState(ws)
  
  // Отправляем начальные настройки камеры
  const cameraSettings = getCameraSettings()
  const modes = getCameraModes()
  const exposureModes = getExposureModes()
  const meteringModes = getMeteringModes()
  const awbModes = getAwbModes()
  setDashboardState('cameraSettings', { 
    ...cameraSettings, 
    cameraModes: modes,
    exposureModes,
    meteringModes,
    awbModes
  })
})
wss.on('listening', () => {
  console.log('[dashboard]: ws online @ port ', 8081)
  
  // Инициализируем настройки камеры в состоянии
  const cameraSettings = getCameraSettings()
  const modes = getCameraModes()
  const exposureModes = getExposureModes()
  const meteringModes = getMeteringModes()
  const awbModes = getAwbModes()
  setDashboardState('cameraSettings', { 
    ...cameraSettings, 
    cameraModes: modes,
    exposureModes,
    meteringModes,
    awbModes
  })
})

class Dashboard extends EventEmitter {
  setState = setDashboardState
  log = dashboardLog
}

const dashboard = new Dashboard()

module.exports = dashboard
