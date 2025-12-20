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
  // Используем /ws путь через nginx proxy, если сайт на порту 80 (или без порта)
  // Иначе используем прямой порт 8081
  const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const isPort80 = !location.port || location.port === '80' || location.port === '443'
  const wsUrl = isPort80 
    ? `${wsProtocol}//${location.hostname}/ws`
    : `ws://${location.hostname}:8081`
  const socket = new WebSocket(wsUrl)
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
    else if (name === 'archiveProgress') {
      const [percent, ...messageParts] = payload.split(':')
      const message = messageParts.join(':') || ''
      stateCb(state => ({ ...state, archiveProgress: { percent: +percent || 0, message } }))
    }
    else if (name === 'photosArchive') {
      const blob = new Blob([Uint8Array.from(atob(payload), c => c.charCodeAt(0))], { type: 'application/zip' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `photos_${new Date().toISOString().split('T')[0]}.zip`
      a.click()
      URL.revokeObjectURL(url)
      // Сбрасываем прогресс после загрузки
      stateCb(state => ({ ...state, archiveProgress: { percent: 0, message: '' } }))
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

// Компонент ползунка с кнопкой сброса
const SliderWithReset = ({ label, value, min, max, step, onChange, onReset, formatValue, unit = '' }) => {
  const displayValue = formatValue ? formatValue(value) : value
  return (
    <div style="display:flex;flex-direction:column;gap:0.3em;margin-bottom:0.8em;">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <label style="flex:1;font-size:0.9em;">{label}:</label>
        <div style="display:flex;align-items:center;gap:0.5em;">
          <span style="min-width:80px;text-align:right;font-weight:bold;">{displayValue}{unit}</span>
          <button 
            onClick={onReset}
            style="padding:0.2em 0.5em;font-size:0.8em;background:#666;color:white;border:none;border-radius:3px;cursor:pointer;"
            title="Сбросить на значение по умолчанию"
          >
            ↺
          </button>
        </div>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step || 1}
        value={value}
        onChange={e => onChange(+e.target.value)}
        style="width:100%;"
      />
    </div>
  )
}

const App = () => {
  const [state, setState] = useState({})
  const [connectionState, setConnectionState] = useState({})
  const [shieldMessage, setShieldMessage] = useState('')
  const [cameraSettings, setCameraSettings] = useState({})
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [archiveProgress, setArchiveProgress] = useState({ percent: 0, message: '' })
  const hardDisconnected = useRef(true)
  const wsRef = useRef(null)
  const sendIfConnected = (...args) => wsRef.current?.send?.(...args)
  
  // Дефолтные значения настроек
  const defaultSettings = {
    shutter: 0,
    gain: 0,
    brightness: 0,
    contrast: 1.0,
    saturation: 1.0,
    sharpness: 1.0,
    exifOrientation: 6,
    exposure: 'normal',
    metering: 'centre',
    awb: 'auto'
  }

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

  useEffect(() => {
    if (state.archiveProgress) {
      setArchiveProgress(state.archiveProgress)
    }
  }, [state.archiveProgress])

  useEffect(() => {
    if (state.archiveProgress) {
      setArchiveProgress(state.archiveProgress)
    }
  }, [state.archiveProgress])

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
  
  // Автоматическое применение настроек при изменении
  const applySettings = (newSettings) => {
    const updatedSettings = { ...cameraSettings, ...newSettings }
    setCameraSettings(updatedSettings)
    sendIfConnected(`updateCameraSettings:${JSON.stringify(updatedSettings)}`)
  }
  
  // Сброс одного параметра на дефолтное значение
  const resetSetting = (key) => {
    const defaultValue = defaultSettings[key]
    if (defaultValue !== undefined) {
      applySettings({ [key]: defaultValue })
    }
  }
  
  // Сброс всех параметров на дефолтные значения
  const resetAllSettings = () => {
    if (confirm('Сбросить все настройки на значения по умолчанию?')) {
      const resetSettings = {
        shutter: defaultSettings.shutter,
        gain: defaultSettings.gain,
        brightness: defaultSettings.brightness,
        contrast: defaultSettings.contrast,
        saturation: defaultSettings.saturation,
        sharpness: defaultSettings.sharpness,
        exifOrientation: defaultSettings.exifOrientation,
        exposure: defaultSettings.exposure,
        metering: defaultSettings.metering,
        awb: defaultSettings.awb
      }
      applySettings(resetSettings)
    }
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
        {state.droneHostname && (
          <div style="font-size:0.9em;color:#aaa;margin-right:1em;">
            {state.droneHostname}:8080
          </div>
        )}
        {!state.droneHostname && state.droneIp && (
          <div style="font-size:0.9em;color:#aaa;margin-right:1em;">
            {state.droneIp}:8080
          </div>
        )}
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
              <button onClick={handleDownloadArchive} disabled={archiveProgress.percent > 0 && archiveProgress.percent < 100}>
                {archiveProgress.percent > 0 && archiveProgress.percent < 100 ? 'Создание архива...' : 'Выгрузить архив фотографий'}
              </button>
              {archiveProgress.percent > 0 && (
                <div style="width:100%;">
                  <div style="display:flex;justify-content:space-between;margin-bottom:0.25em;font-size:0.9em;color:#aaa;">
                    <span>{archiveProgress.message || 'Обработка...'}</span>
                    <span>{archiveProgress.percent}%</span>
                  </div>
                  <div style="width:100%;height:8px;background:#333;border-radius:4px;overflow:hidden;">
                    <div style={`width:${archiveProgress.percent}%;height:100%;background:#4CAF50;transition:width 0.3s ease;`}></div>
                  </div>
                </div>
              )}
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
                      const modeMatch = mode.match(/(\d+)x(\d+)@(\d+)fps/)
                      if (modeMatch) {
                        const width = +modeMatch[1]
                        const height = +modeMatch[2]
                        const framerate = +modeMatch[3]
                        applySettings({ mode, width, height, framerate })
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
              
              <SliderWithReset
                label="Выдержка (микросекунды, 0 = авто)"
                value={cameraSettings.shutter || 0}
                min={0}
                max={100000000}
                step={100000}
                onChange={val => applySettings({ shutter: val })}
                onReset={() => resetSetting('shutter')}
                formatValue={val => val === 0 ? 'Авто' : val.toLocaleString()}
                unit=" мкс"
              />
              
              <SliderWithReset
                label="Gain (усиление, 0 = авто)"
                value={cameraSettings.gain || 0}
                min={0}
                max={16}
                step={0.1}
                onChange={val => applySettings({ gain: val })}
                onReset={() => resetSetting('gain')}
                formatValue={val => val === 0 ? 'Авто' : val.toFixed(1)}
              />
              
              <label>
                Режим экспозиции:
                <select 
                  value={cameraSettings.exposure || 'normal'}
                  onChange={e => applySettings({ exposure: e.target.value })}
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
                  onChange={e => applySettings({ metering: e.target.value })}
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
                  onChange={e => applySettings({ awb: e.target.value })}
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
              
              <SliderWithReset
                label="Яркость"
                value={cameraSettings.brightness || 0}
                min={-1.0}
                max={1.0}
                step={0.01}
                onChange={val => applySettings({ brightness: val })}
                onReset={() => resetSetting('brightness')}
                formatValue={val => val.toFixed(2)}
              />
              
              <SliderWithReset
                label="Контраст"
                value={cameraSettings.contrast || 1.0}
                min={0.0}
                max={2.0}
                step={0.01}
                onChange={val => applySettings({ contrast: val })}
                onReset={() => resetSetting('contrast')}
                formatValue={val => val.toFixed(2)}
              />
              
              <SliderWithReset
                label="Насыщенность"
                value={cameraSettings.saturation || 1.0}
                min={0.0}
                max={2.0}
                step={0.01}
                onChange={val => applySettings({ saturation: val })}
                onReset={() => resetSetting('saturation')}
                formatValue={val => val.toFixed(2)}
              />
              
              <SliderWithReset
                label="Резкость"
                value={cameraSettings.sharpness || 1.0}
                min={0.0}
                max={2.0}
                step={0.01}
                onChange={val => applySettings({ sharpness: val })}
                onReset={() => resetSetting('sharpness')}
                formatValue={val => val.toFixed(2)}
              />
              
              <h3 style="margin-top:1em;margin-bottom:0.5em;">Другие настройки</h3>
              
              <SliderWithReset
                label="EXIF ориентация"
                value={cameraSettings.exifOrientation || 6}
                min={1}
                max={8}
                step={1}
                onChange={val => applySettings({ exifOrientation: val })}
                onReset={() => resetSetting('exifOrientation')}
                formatValue={val => val}
              />
              
              <label>
                <input 
                  type="checkbox" 
                  checked={cameraSettings.saveEnabled || false}
                  onChange={e => applySettings({ saveEnabled: e.target.checked })}
                />
                Сохранять фотографии на диск
              </label>
              <label>
                Директория сохранения:
                <input 
                  type="text" 
                  value={cameraSettings.saveDir || ''} 
                  onChange={e => applySettings({ saveDir: e.target.value })}
                  style="width:100%;"
                />
              </label>
              <div style="display:flex;gap:0.5em;margin-top:0.5em;">
                <button onClick={resetAllSettings} style="background:#666;color:white;">Сбросить все настройки</button>
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
