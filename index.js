'use strict'

require('dotenv').config()

const { SerialPort } = require('serialport')
const { DelimiterParser } = require('@serialport/parser-delimiter')
const dashboard = require('./dashboard')
const osd = require('./osd')
const ui = require('./ui')
const { takePhoto } = require('./photo')
const { MavSystem, mav2 } = require('./mavlink')

const { log, fsExists } = require('./utils')
const { networkInterfaces } = require('os')
const packageJson = require('./package.json')
const { checkButton } = require('./rc')
const { udp, connect } = require('./adapters')
const { default: CancelablePromise } = require('cancelable-promise')

const droneId = process.env.DRONE_ID || '00'

const getIp = () => {
  const addrs = networkInterfaces().wlan0 || []
  const addr = addrs.filter(v => v.family === 'IPv4')[0] || {}
  return addr.address || undefined
}

console.log('[drone]: software:', packageJson.version)
console.log('[drone]: id:', droneId)

const current = {
  alley_name: undefined,
  pilot_name: undefined
}

let droneIp
const dashboardHostname = process.env.DASHBOARD_HOSTNAME || null
setInterval(() => {
  const ip = getIp()
  if (ip !== droneIp) {
    droneIp = ip
    console.log('[drone]: ip changed', ip)
    if (ip) {
      dashboard.setState('droneIp', ip)
      if (dashboardHostname) {
        dashboard.setState('droneHostname', dashboardHostname)
        console.log(`[dashboard]: Доступен по адресу: http://${dashboardHostname}:8080`)
      } else {
        dashboard.setState('droneHostname', null)
      }
      if (mavlinkUdpEn) {
        console.log(`[mavlink-udp]: Для подключения через Mission Planner используйте: ${ip}:${mavlinkUdpPort}`)
      }
    } else {
      dashboard.setState('droneIp', null)
      dashboard.setState('droneHostname', null)
    }
  }
}, 1000)

const mavlinkSerialPath = process.env.MAVLINK_SERIAL_PATH || '/dev/ttyACM0'
const mavlinkSerialBaud = +(process.env.MAVLINK_SERIAL_BAUD || 57600)
const scannerPath = process.env.SCANNER_SERIAL_PATH || '/dev/ttyAMA0'
const scannerBaud = +(process.env.SCANNER_SERIAL_BAUD || 115200)
const scannerReconnectTimeout = +(process.env.SCANNER_SERIAL_RECONNECT_TIMEOUT || 0)
const osdPath = process.env.OSD_SERIAL_PATH || scannerPath
const osdBaud = +(process.env.OSD_SERIAL_BAUD || scannerBaud)

const osdWidth = +(process.env.OSD_WIDTH || 30)
const osdHeight = +(process.env.OSD_HEIGHT || 16)
const osdPaddingTop = +(process.env.OSD_PADDING_TOP || 1)
const osdPaddingBottom = +(process.env.OSD_PADDING_BOTTOM || 5)
const osdPaddingRight = +(process.env.OSD_PADDING_RIGHT || 2)
const osdPaddingLeft = +(process.env.OSD_PADDING_LEFT || 2)

const mavlinkUdpEn = process.env.MAVLINK_UDP_EN === 'true'
const mavlinkUdpHost = process.env.MAVLINK_UDP_HOST || '0.0.0.0'
const mavlinkUdpPort = +(process.env.MAVLINK_UDP_PORT || 14550)
const mavlinkSystemId = +(process.env.MAVLINK_SYSTEM_ID || 1)

const rcEmptyCh = +(process.env.RC_EMPTY_CH || 6)
const rcRescanCh = +(process.env.RC_RESCAN_CH || 6)
const rcNoTagCh = +(process.env.RC_NO_TAG_CH || 6)
const rcUnreadableCh = +(process.env.RC_UNREADABLE_CH || 6)
const rcPhotoCh = +(process.env.RC_PHOTO_CH || 6)
const rcScanoffCh = +(process.env.RC_SCANOFF_CH || 8)
const rcAlleySwitchCh = +(process.env.RC_ALLEY_SWITCH_CH || 9)

const rcEmptyPwm = +(process.env.RC_EMPTY_PWM || 1067)
const rcRescanPwm = +(process.env.RC_RESCAN_PWM || 1249)
const rcNoTagPwm = +(process.env.RC_NO_TAG_PWM || 1495)
const rcUnreadablePwm = +(process.env.RC_UNREADABLE_PWM || 982)
const rcPhotoPwm = +(process.env.RC_PHOTO_PWM || 2006)
const rcScanoffPwm = +(process.env.RC_SCANOFF_PWM || 2006)
const rcAlleyNextPwm = +(process.env.RC_ALLEY_NEXT_PWM || 1025)
const rcAlleyPrevPwm = +(process.env.RC_ALLEY_PREV_PWM || 1075)

const protocol = require('./protocol')

const osdSp = new SerialPort(
  { path: osdPath, baudRate: osdBaud, lock: false },
  () => {
    console.log(`[osd]: ${osdPath}:${osdBaud}`)
    setTimeout(onOSDConnected, 2000)
  }
)

let scannerSp

if (scannerPath === osdPath) {
  scannerSp = osdSp
  console.log(`[scanner]: ${scannerPath}:${scannerBaud}`)
} else {
  const scannerOpenCb = error => {
    if (error){
      console.log(`[scanner]: ${error?.message}`)
      if (scannerReconnectTimeout)
        scannerSp.emit('reconnect-after-timeout')
    } else {
      console.log(`[scanner]: ${scannerPath}:${scannerBaud}`)
    }
  }
  scannerSp = new SerialPort(
    { path: scannerPath, baudRate: scannerBaud, lock: false },
    scannerOpenCb
  )
  scannerSp.on('close', error => {
    console.log('[scanner]: closed:', error?.message)
    if (scannerReconnectTimeout)
      scannerSp.emit('reconnect-after-timeout')
  })
  scannerSp.on('reconnect-after-timeout', () => setTimeout(() => scannerSp.open(scannerOpenCb), scannerReconnectTimeout))
}


// Scanner removed - no longer needed for photo mode
// const scannerRl = scannerSp.pipe(new DelimiterParser({ delimiter: Buffer.from([0x0a]) }))

// Python module events removed - no longer needed for photo mode

ui.configure(osdSp.write.bind(osdSp), {
  width: osdWidth,
  height: osdHeight,
  paddingTop: osdPaddingTop,
  paddingBottom: osdPaddingBottom,
  paddingRight: osdPaddingRight,
  paddingLeft: osdPaddingLeft,
})

ui.updateLayout({
  logo: () => [
    ['center', 'center', 'UVL-INVENTORY'],
    ['center +1', 'center', 'V' + packageJson.version]
  ],

  name: ['top', 'center', `UVL_${droneId}X`],
  palletAlley: ['top +1', 'left'],
  palletLevel: ['top +2', 'left'],
  palletName: ['top +3', 'left'],
  
  connection: ['top +2', 'center'],

  scanoff: ['top +2', 'left'],
  scanStatusOk: v => !v ? [[], []] : [
    ['center -1', 'center -4', [osd.ch.Checkmark1, osd.ch.Checkmark2]],
    ['center', 'center -4', [osd.ch.Checkmark3, osd.ch.Checkmark4]]
  ],
  scanStatusNo: v => !v ? [[], []] : [
    ['center +2', 'center -4', [osd.ch.Crossmark3, osd.ch.Crossmark4]],
    ['center +1', 'center -4', [osd.ch.Crossmark1, osd.ch.Crossmark2]]
  ],
  button: ['center +1', 'left'],

  barcode: ['bottom -3', 'center'],
  infoMessage: ['bottom -2', 'center'],
  palletMap: ['center +4', 'center'],
  //positionRight: ['bottom', 'center'],
})

let showInfoMessageTimeout = undefined
const showInfoMessage = (data, duration = 5000) => {
  clearTimeout(showInfoMessageTimeout)
  const text = String(data).toUpperCase()
  ui.update('infoMessage', text)
  console.log('[OSD Message]:', text)
  showInfoMessageTimeout = setTimeout(
    () => ui.update('infoMessage', false),
    duration
  )
}

const onOSDConnected = () => {
  ui.render()
  setTimeout(() => ui.updateLayout({ logo: () => [[], []] }, true), 5000)
}

let prevConnectionStatus = null
setInterval(() => {
  const status = connectionStatus()
  if (status && status !== prevConnectionStatus)
    console.log(`[status]: ${status} (${getIp() || 'noip'})`)
  prevConnectionStatus = status
  ui.update('connection', status)
}, 500)

// Python module events removed - no longer needed for photo mode

const mavlinkSerial = new SerialPort(
  { path: mavlinkSerialPath, baudRate: mavlinkSerialBaud, lock: false },
  () => console.log(`[mavlink]: ${mavlinkSerialPath}:${mavlinkSerialBaud}`)
)
mavlinkSerial.on('error', console.log)

const mavSystem = new MavSystem(mavlinkSystemId, recv => {
  mavlinkSerial.on('data', recv)
  mavlinkSerial.write = mavlinkSerial.write.bind(mavlinkSerial)
  return mavlinkSerial.write
}, {
  RC_CHANNELS: 10
})
mavSystem.sendEnabled = true

let buttonTimeoutId
const handleButton = label => {
  clearTimeout(buttonTimeoutId)
  dashboard.setState('button', label)
  ui.update('button', label)
  buttonTimeoutId = setTimeout(() => ui.update('button', false), 2000)
}

let photoCounter = 0
mavSystem.on('rc_channels', msg => {
  checkButton(msg, rcPhotoCh, rcPhotoPwm, 'PHOTO', () => {
    photoCounter++
    const photoId = `photo_${Date.now()}_${photoCounter}`
    handleButton('PHOTO')
    takePhoto(photoId, (id, data) => {
      if (data instanceof Error) {
        showInfoMessage(data.message)
      } else {
        const photoSaveEnabled = process.env.PHOTO_SAVE_ENABLED === 'true'
        const photoSaveDir = process.env.PHOTO_SAVE_DIR || './photos'
        const message = photoSaveEnabled 
          ? `Photo saved: ${id}.jpg` 
          : `Photo captured: ${id}`
        showInfoMessage(message, 2000)
        dashboard.setState('lastPhoto', { 
          id, 
          timestamp: Date.now(),
          saved: photoSaveEnabled,
          path: photoSaveEnabled ? `${photoSaveDir}/${id}.jpg` : null
        })
      }
    })
  })
  
  // Other buttons removed - no longer needed for photo mode
  // checkButton(msg, rcEmptyCh, rcEmptyPwm, 'EMPTY', handleButton)
  // checkButton(msg, rcRescanCh, rcRescanPwm, 'RESCAN', handleButton)
  // checkButton(msg, rcNoTagCh, rcNoTagPwm, 'NO_TAG', handleButton)
  // checkButton(msg, rcUnreadableCh, rcUnreadablePwm, 'UNREADABLE', handleButton)
  // checkButton(msg, rcAlleySwitchCh, rcAlleyNextPwm, 'ALLEY_NEXT', nextAlley)
  // checkButton(msg, rcAlleySwitchCh, rcAlleyPrevPwm, 'ALLEY_PREV', prevAlley)
  // checkButton(msg, rcScanoffCh, rcScanoffPwm, 'SCANOFF',
  //   () => ui.update('scanoff', 'SCANOFF'),
  //   () => ui.update('scanoff', false)
  // )
})

const connectionStatus = () => mavlinkHeartbeat
  ? getIp()
    ? false
    : 'NO IP'
  : 'NO MAVLINK'

let mavlinkHeartbeat = false
let mavlinkHeartbeatTimeoutId
let mavlinkHeartbeatTimeoutPromise = new CancelablePromise.resolve()
const mavlinkHeartbitTimeoutStart = () => {
  clearTimeout(mavlinkHeartbeatTimeoutId)
  mavlinkHeartbeatTimeoutId = setTimeout(() => {
    mavlinkHeartbeat = false
    mavlinkSerial.close(() => {
      mavlinkSerial.open(() => {
        mavlinkHeartbeatTimeoutPromise.catch(() => { }).cancel()
        mavlinkHeartbeatTimeoutPromise = mavSystem.requestInitialMessages().catch(() => { })
        mavlinkHeartbitTimeoutStart()
      })
    })
  }, 5000)
}
mavSystem.on('heartbeat', () => {
  mavlinkHeartbeat = true
  mavlinkHeartbitTimeoutStart()
})
mavlinkHeartbitTimeoutStart()

let rcChannelsArdupilotFixInterval = null
if (mavlinkUdpEn) {
  console.log(`[mavlink-udp]: Запуск UDP сервера на ${mavlinkUdpHost}:${mavlinkUdpPort}`)
  connect(
    mavSystem.connect('mavlink-udp'),
    udp(
      mavlinkUdpHost,
      mavlinkUdpPort,
      (v, twoWay) => {
        console.log('[mavlink-udp]:', v)
        if (twoWay) {
          const clientIp = v.split(' > ')[1]?.split(':')[0]
          if (clientIp && clientIp !== 'unknown') {
            console.log(`[mavlink-udp]: Подключен клиент ${clientIp}, двусторонняя связь установлена`)
            dashboard.setState('mavlinkUdpConnected', true)
            dashboard.setState('mavlinkUdpClientIp', clientIp)
          }
          if (!rcChannelsArdupilotFixInterval)
            rcChannelsArdupilotFixInterval = setInterval(
              () => mavSystem.setMessageInterval('RC_CHANNELS', 10).catch(() => { }), 1000)
        } else {
          dashboard.setState('mavlinkUdpConnected', false)
          dashboard.setState('mavlinkUdpClientIp', null)
        }
      }
    )
  )
} else {
  console.log('[mavlink-udp]: UDP отключен (MAVLINK_UDP_EN не установлен в true)')
  console.log('[mavlink-udp]: Для подключения через Mission Planner установите MAVLINK_UDP_EN=true в .env')
}


// Python module commands removed - no longer needed for photo mode
// dashboard.on('loadAlley', json => {
//   const params = JSON.parse(json)
//   protocol.send('load_alley', params)
// })

// dashboard.on('goto', json => {
//   const params = JSON.parse(json)
//   protocol.send('goto', params)
// })

const child_process = require('node:child_process')
dashboard.on('timestamp', tsStr => {
  let timestamp = +tsStr
  if (Date.now() < timestamp) child_process.exec(
    `sudo date -s @${Math.round(timestamp/ 1000)}`,
    err => err ? console.log(err) : null
  )
})


// Python module commands removed - no longer needed for photo mode
// dashboard.on('loadAlleyFromFile', (name) => {
//   if (!name) return
//   const file = copterSoft.getSavedResultFilename(name)
//   protocol.send('load_alley_from_file', { file })
// })

// Python module events removed - no longer needed for photo mode
// protocol.on('clientConnected', () => {
//   protocol.send('refresh_state')
//   const file = copterSoft.getSavedResultFilename()
//   if (file)
//     protocol.send('load_alley_from_file', { file })
// })

// protocol.on('table_json', (params, table_json) => {
//   const table = JSON.parse(table_json)
//   copterSoft.overwriteLoadedAlleyFilename(table.report_file)
//   ui.update({ palletAlley: 'RCK ' + table.alley_name })
//   current.alley_name = table.alley_name
//   current.pilot_name = table.pilot_name
//   dashboard.setState('table', table)
// })

// Alley management functions removed - no longer needed for photo mode
// const nextAlleyName = (currName, offset = 1) => {
//   const names = Object.keys(copterSoft.warehouse.warehouse)
//   const currIndex = names.indexOf(currName)
//   if (currIndex === -1) return undefined
//   const nextIndex = (currIndex + names.length + offset) % names.length
//   const nextName = names[nextIndex]
//   return nextName
// }

// const loadExistingOrNewAlley = (alley, pilot) => {
//   const file = copterSoft.getSavedResultFilename(
//     `${copterSoft.warehouse.name}/${alley}.jsonl`
//   )
//   if (fsExists(file))
//     protocol.send('load_alley_from_file', { file })
//   else
//     protocol.send('load_alley', { alley, pilot })
// }

// const nextAlley = () => {
//   if (!current.alley_name) {
//     showInfoMessage('no alley loaded')
//     return
//   }
//   const nextName = nextAlleyName(current.alley_name, +1)
//   if (!nextName) {
//     showInfoMessage('next alley not found')
//     return
//   }
//   loadExistingOrNewAlley(nextName, current.pilot_name)
// }

// const prevAlley = () => {
//   if (!current.alley_name) {
//     showInfoMessage('no alley loaded')
//     return
//   }
//   const nextName = nextAlleyName(current.alley_name, -1)
//   if (!nextName) {
//     showInfoMessage('prev alley not found')
//     return
//   }
//   loadExistingOrNewAlley(nextName, current.pilot_name)
// }
