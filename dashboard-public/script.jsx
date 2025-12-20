'use strict'

const log = (...args) => (console.log(...args), args[0])

const sleep = ms => new Promise(r => setTimeout(r, ms))

const identity = v => v

const callOnce = fn => {
  let called = false
  return (...args) => {
    if (!called) {
      called = true
      fn(...args)
    }
  }
}

const splitPayload = data => {
  const sepIndex = data.indexOf(':')
  const type = sepIndex > 0 ? data.slice(0, sepIndex) : data
  const payload = sepIndex > 0 ? data.slice(sepIndex + 1) : null
  return [type, payload]
}

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

function fromBase64(base64) {
  const binString = atob(base64)
  return textDecoder.decode(Uint8Array.from(binString, m => m.codePointAt(0)))
}

function toBase64(str) {
  const bytes = textEncoder.encode(str)
  const binString = String.fromCodePoint(...bytes)
  return btoa(binString)
}

const waitLoadAll = async elems => await Promise.all(elems.map(el => new Promise(r => el.addEventListener('canplaythrough', r))))

const sounds = Object.fromEntries([
  'disconnected.wav',
  'standard_signal.wav',
  'connected.wav',
].map(v => [v, new Audio('/music/' + v)]))

function beep(sound) {
  if (!sounds[sound])
    sounds[sound] = new Audio('/music/' + sound)
  sounds[sound].play()
}

const ansiToHtml = new AnsiToHtml({
  colors: [
    '#000000',
    '#cd3131',
    '#0dbc79',
    '#e5e510',
    '#2472c8',
    '#bc3fbc',
    '#11a8cd',
    '#e5e5e5',
    '#666666',
    '#f14c4c',
    '#23d18b',
    '#f5f543',
    '#3b8eea',
    '#d670d6',
    '#29b8db',
    '#e5e5e5',
  ],
  bg: 'var(--ansi-bg)',
  fg: 'var(--ansi-fg)',
})

const htmlAnsify = value => ansiToHtml.toHtml(value
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#039;"))

const cx = (...args) => cx_flatten(args).join(' ')
const cx_flatten = (from, to = []) => {
  if (typeof from === 'string' || from instanceof String)
    to.push(from)
  else if (from && typeof from === 'object')
    if (typeof from[Symbol.iterator] === 'function')
      for (const item of from)
        cx_flatten(item, to)
    else
      for (const key in from)
        if (from[key])
          to.push(key)
  return to
}

const webSocketEngine = (ref, stateCb, openCb) => new Promise(disconnectCb => {
  const socket = new WebSocket(`ws://${location.hostname}:8081`)
  const closeAndDisconnect = () => socket.close(1000, 'ping failed')
  let disconnectDetectTimeoutId
  socket.addEventListener('message', ({ data }) => {
    clearTimeout(disconnectDetectTimeoutId)
    disconnectDetectTimeoutId = setTimeout(closeAndDisconnect, 2000)
    const [name, payload] = splitPayload(data)
    if (name === 'ping')
      socket.send('pong')
    else if (name === 'pong') {
      // refresh disconnect timer in any case of message
    }
    else if (name === 'state')
      stateCb(JSON.parse(payload))
    else if (name === 'download') {
      const [fileName, fileData] = splitPayload(payload)
      const blob = new Blob([fileData])
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = fileName.replace('/', '_').replace(' ', '_')
      a.textContent = 'Download'
      a.click()
      URL.revokeObjectURL(url)
    }
    else if (name === 'lastPhoto') {
      const [photoId, photoData] = splitPayload(payload)
      const blob = new Blob([Uint8Array.from(atob(photoData), c => c.charCodeAt(0))], { type: 'image/jpeg' })
      const url = URL.createObjectURL(blob)
      stateCb(state => ({ ...state, lastPhotoImage: url, lastPhotoId: photoId }))
    }
    else if (name === 'photosArchive') {
      const blob = new Blob([Uint8Array.from(atob(payload), c => c.charCodeAt(0))], { type: 'application/zip' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `photos_${new Date().toISOString().split('T')[0]}.zip`
      a.click()
      URL.revokeObjectURL(url)
    }
    else if (name === 'cameraSettings') {
      try {
        const settings = JSON.parse(payload)
        stateCb(state => ({ ...state, cameraSettings: settings }))
      } catch (err) {
        console.error('Failed to parse camera settings:', err)
      }
    }
    else if (name === 'info') {
      alert(payload)
    }
    else if (name === 'warning') {
      alert('Предупреждение: ' + payload)
    }
    else if (name === 'error') {
      alert('Ошибка: ' + payload)
    }
  })
  let pingIntervalId
  let tsIntervalId
  socket.addEventListener('open', () => {
    clearTimeout(disconnectDetectTimeoutId)
    disconnectDetectTimeoutId = setTimeout(closeAndDisconnect, 2000)
    pingIntervalId = setInterval(() => socket.send('ping'), 1000)
    tsIntervalId = setInterval(() => socket.send(`timestamp:${Date.now()}`), 5000)
    ref.current = socket
    openCb(socket)
  })
  socket.addEventListener('close', evt => {
    ref.current = null
    clearTimeout(disconnectDetectTimeoutId)
    clearInterval(pingIntervalId)
    clearInterval(tsIntervalId)
    disconnectCb(true)
  })
})

const App = () => {
  const [state, setState] = useState({})
  const [connectionState, setConnectionState] = useState({})
  const [shieldMessage, setShieldMessage] = useState('')
  const [cameraSettings, setCameraSettings] = useState({})
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const hardDisconnected = useRef(true)
  const wsRef = useRef(null)
  const sendIfConnected = (...args) => wsRef.current?.send?.(...args)

  useEffect(async () => {
    while (true) {
      setConnectionState('connecting')
      await webSocketEngine(wsRef, setState, socket => {
        setConnectionState('connected')
        // Запрашиваем настройки камеры при подключении
        socket.send('getCameraSettings')
        // Запрашиваем последнюю фотографию, если она есть
        if (state.lastPhoto?.path) {
          socket.send('getLastPhoto')
        }
      }).then(hard => hardDisconnected.current = hard)
      setConnectionState('disconnected')
      await sleep(1000)
    }
  }, [])

  useEffect(() => window.ipcRenderer?.on?.('message', (evt, v) => setShieldMessage(v)), [])

  useEffect(() => {
    if (hardDisconnected.current) {
      if (connectionState === 'connected') {
        beep('connected.wav')
        hardDisconnected.current = false
      }
      else if (connectionState === 'disconnected')
        beep('disconnected.wav')
    }
  }, [connectionState])

  useEffect(() => {
    if (state.cameraSettings) {
      setCameraSettings(state.cameraSettings)
    }
  }, [state.cameraSettings])

  // Запрашиваем последнюю фотографию при изменении lastPhoto
  useEffect(() => {
    if (state.lastPhoto?.path && connectionState === 'connected') {
      sendIfConnected('getLastPhoto')
    }
  }, [state.lastPhoto?.id, connectionState])

  const logsHtml = useMemo(() => (state.logs || []).map(htmlAnsify), [state.logs])

  const [hideDev, setHideDev] = useState(true)

  useEffect(() => {
    document.addEventListener('keydown', event => {
      if (event.ctrlKey && event.code == 'KeyD') {
        event.stopPropagation()
        event.preventDefault()
        setHideDev(v => !v)
      }
    })
  }, [])

  const handleDownloadArchive = () => {
    sendIfConnected('downloadPhotosArchive')
  }

  const handleDeleteAll = () => {
    if (confirm('Вы уверены, что хотите удалить все фотографии? Это действие нельзя отменить.')) {
      sendIfConnected('deleteAllPhotos')
    }
  }

  const handleUpdateSettings = () => {
    sendIfConnected(`updateCameraSettings:${JSON.stringify(cameraSettings)}`)
  }

  const handleReloadCamera = () => {
    if (confirm('Перезагрузить камеру с новыми настройками?')) {
      sendIfConnected('reloadCamera')
    }
  }

  const formatDate = (timestamp) => {
    if (!timestamp) return ''
    return new Date(timestamp).toLocaleString('ru-RU')
  }

  return (
    <div class="root">
      {connectionState !== 'connected' && <Shield message={shieldMessage} progress logo />}
      <div class="controls">
        <h1>UVL Photo Project</h1>
        <div style="flex:1"></div>
        <div style="font-size:1.5em;z-index:10" onClick={() => setHideDev(v => !v)}>{{ connected: '🟢', disconnected: '🔴', connecting: '🟠' }[connectionState]}</div>
      </div>
      <div class="main">
        <div class="panel left">
          <div class="photo-section">
            <h2>Последняя фотография</h2>
            {state.lastPhotoImage ? (
              <div class="photo-container">
                <img src={state.lastPhotoImage} alt="Last photo" style="max-width:100%;max-height:60vh;object-fit:contain;" />
                <div style="margin-top:0.5em;font-size:0.9em;color:#aaa;">
                  ID: {state.lastPhoto?.id || 'N/A'}<br />
                  Время: {formatDate(state.lastPhoto?.timestamp)}
                </div>
              </div>
            ) : state.lastPhoto ? (
              <div>Загрузка фотографии...</div>
            ) : (
              <div style="color:#aaa;">Нет фотографий</div>
            )}
          </div>
          
          <div class="controls-section" style="margin-top:1em;">
            <h2>Управление</h2>
            <div style="display:flex;flex-direction:column;gap:0.5em;">
              <button onClick={handleDownloadArchive}>Выгрузить архив фотографий</button>
              <button onClick={handleDeleteAll} style="background:#f44336;color:white;">Очистить все фотографии</button>
            </div>
          </div>
        </div>
        
        <div class="panel right">
          <div class="settings-section">
            <h2>Настройки камеры</h2>
            <div style="display:flex;flex-direction:column;gap:0.5em;">
              <label>
                Режим камеры:
                <select 
                  value={cameraSettings.mode || ''}
                  onChange={e => {
                    const mode = e.target.value
                    if (mode) {
                      const modeMatch = mode.match(/(\d+)x(\d+)@(\d+))fps/)
                      if (modeMatch) {
                        const width = +modeMatch[1]
                        const height = +modeMatch[2]
                        const framerate = +modeMatch[3]
                        setCameraSettings({...cameraSettings, mode, width, height, framerate})
                      }
                    }
                  }}
                  style="width:100%;"
                >
                  <option value="">Выберите режим</option>
                  {(cameraSettings.cameraModes || []).map((mode, i) => (
                    <option key={i} value={`${mode.width}x${mode.height}@${mode.framerate}fps`}>
                      {mode.label}
                    </option>
                  ))}
                </select>
              </label>
              
              <h3 style="margin-top:1em;margin-bottom:0.5em;">Настройки экспозиции</h3>
              
              <label>
                Выдержка (микросекунды, 0 = авто):
                <input 
                  type="number" 
                  min="0" 
                  max="100000000"
                  value={cameraSettings.shutter || 0} 
                  onChange={e => setCameraSettings({...cameraSettings, shutter: +e.target.value})}
                  style="width:100%;"
                />
              </label>
              
              <label>
                Gain (усиление, 0 = авто):
                <input 
                  type="number" 
                  min="0" 
                  max="16" 
                  step="0.1"
                  value={cameraSettings.gain || 0} 
                  onChange={e => setCameraSettings({...cameraSettings, gain: +e.target.value})}
                  style="width:100%;"
                />
              </label>
              
              <label>
                Режим экспозиции:
                <select 
                  value={cameraSettings.exposure || 'normal'}
                  onChange={e => setCameraSettings({...cameraSettings, exposure: e.target.value})}
                  style="width:100%;"
                >
                  {(cameraSettings.exposureModes || []).map((mode, i) => (
                    <option key={i} value={mode}>
                      {mode}
                    </option>
                  ))}
                </select>
              </label>
              
              <label>
                Режим замера экспозиции:
                <select 
                  value={cameraSettings.metering || 'centre'}
                  onChange={e => setCameraSettings({...cameraSettings, metering: e.target.value})}
                  style="width:100%;"
                >
                  {(cameraSettings.meteringModes || []).map((mode, i) => (
                    <option key={i} value={mode}>
                      {mode}
                    </option>
                  ))}
                </select>
              </label>
              
              <label>
                Баланс белого:
                <select 
                  value={cameraSettings.awb || 'auto'}
                  onChange={e => setCameraSettings({...cameraSettings, awb: e.target.value})}
                  style="width:100%;"
                >
                  {(cameraSettings.awbModes || []).map((mode, i) => (
                    <option key={i} value={mode}>
                      {mode}
                    </option>
                  ))}
                </select>
              </label>
              
              <h3 style="margin-top:1em;margin-bottom:0.5em;">Настройки изображения</h3>
              
              <label>
                Яркость (-1.0 до 1.0):
                <input 
                  type="number" 
                  min="-1.0" 
                  max="1.0" 
                  step="0.1"
                  value={cameraSettings.brightness || 0} 
                  onChange={e => setCameraSettings({...cameraSettings, brightness: +e.target.value})}
                  style="width:100%;"
                />
              </label>
              
              <label>
                Контраст (0.0 до 2.0):
                <input 
                  type="number" 
                  min="0.0" 
                  max="2.0" 
                  step="0.1"
                  value={cameraSettings.contrast || 1.0} 
                  onChange={e => setCameraSettings({...cameraSettings, contrast: +e.target.value})}
                  style="width:100%;"
                />
              </label>
              
              <label>
                Насыщенность (0.0 до 2.0):
                <input 
                  type="number" 
                  min="0.0" 
                  max="2.0" 
                  step="0.1"
                  value={cameraSettings.saturation || 1.0} 
                  onChange={e => setCameraSettings({...cameraSettings, saturation: +e.target.value})}
                  style="width:100%;"
                />
              </label>
              
              <label>
                Резкость (0.0 до 2.0):
                <input 
                  type="number" 
                  min="0.0" 
                  max="2.0" 
                  step="0.1"
                  value={cameraSettings.sharpness || 1.0} 
                  onChange={e => setCameraSettings({...cameraSettings, sharpness: +e.target.value})}
                  style="width:100%;"
                />
              </label>
              
              <h3 style="margin-top:1em;margin-bottom:0.5em;">Другие настройки</h3>
              <label>
                EXIF ориентация:
                <input 
                  type="number" 
                  value={cameraSettings.exifOrientation || ''} 
                  onChange={e => setCameraSettings({...cameraSettings, exifOrientation: +e.target.value})}
                  style="width:100%;"
                />
              </label>
              <label>
                <input 
                  type="checkbox" 
                  checked={cameraSettings.saveEnabled || false}
                  onChange={e => setCameraSettings({...cameraSettings, saveEnabled: e.target.checked})}
                />
                Сохранять фотографии на диск
              </label>
              <label>
                Директория сохранения:
                <input 
                  type="text" 
                  value={cameraSettings.saveDir || ''} 
                  onChange={e => setCameraSettings({...cameraSettings, saveDir: e.target.value})}
                  style="width:100%;"
                />
              </label>
              <div style="display:flex;gap:0.5em;margin-top:0.5em;">
                <button onClick={handleUpdateSettings}>Сохранить настройки</button>
                <button onClick={handleReloadCamera}>Перезагрузить камеру</button>
              </div>
            </div>
          </div>
          
          {!hideDev &&
            <>
              <AutoScroll class="box" style="margin-top:1em;">
                <b>log</b>
                {logsHtml.map((__html, i) =>
                  <pre key={i} dangerouslySetInnerHTML={{ __html }} />
                )}
              </AutoScroll>
              <div class="box" style="margin-top:1em;">
                <b>state</b>
                <pre>{JSON.stringify(state, null, 2)}</pre>
              </div>
            </>
          }
        </div>
      </div>
    </div>
  )
}

const stringifyMessage = val => {
  if (val instanceof Error)
    return val.toString()
  else if (val === undefined)
    return ''
  else if (typeof val === 'string')
    return val
  else
    return JSON.stringify(val, null, 2)
}

const Shield = ({ progress = false, logo = false, message = undefined }) => {
  return (
    <div class="shield_overlay">
      {!!logo && <img src="logo.svg" style="width:150px;height:61px;object-fit:cover;" />}
      {!!progress && <div class="progress"></div>}
      {message !== undefined && <pre style="white-space:pre-wrap;text-align:center;font-size:0.8rem;color:#aaaa">{stringifyMessage(message)}</pre>}
    </div>
  )
}

const AutoScroll = ({ as: As = 'div', ...props }) => {
  const asRef = useRef(null)
  const ref = asRef.current
  useEffect(() => {
    if (!ref) return
    const { fontSize } = getComputedStyle(ref)
    const padding = fontSize.replace('px', '') * 2
    const bottom = Math.abs(ref.scrollHeight - ref.clientHeight - ref.scrollTop)
    if (bottom < padding)
      requestAnimationFrame(() => ref.scrollTo(0, ref.scrollHeight))
  }, [ref, props])
  return <As ref={asRef} {...props} />
}

waitLoadAll(Object.values(sounds)).then(() => preact.render(<App />, document.body))
