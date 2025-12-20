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
      //setTimeout(() => URL.revokeObjectURL(url), 30000)
    }
    else if (name === 'error') {
      alert(payload)
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
  const hardDisconnected = useRef(true)
  const wsRef = useRef(null)
  const sendIfConnected = (...args) => wsRef.current?.send?.(...args)

  useEffect(async () => {
    while (true) {
      setConnectionState('connecting')
      await webSocketEngine(wsRef, setState, socket => {
        setConnectionState('connected')
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
    if (state.table?.current_pallet && state.barcode)
      beep('standard_signal.wav')
  }, [state.table?.current_pallet])

  const logsHtml = useMemo(() => (state.logs || []).map(htmlAnsify), [state.logs])

  const onLoadWarehouseJson = useCallback(({ json, name }) => {
    sendIfConnected('warehouseJson:' + JSON.stringify({ ...json, name: name.slice(0, -5) }))
  }, [])

  const savedResultsOptionsRef = useRef(null)
  const alleyInputRef = useRef(null)

  const [hideDev, setHideDev] = useState(true)

  const sameCompany = state.copterSoft?.warehouseName === state.table?.company_name

  useEffect(() => {
    document.addEventListener('keydown', event => {
      if (event.ctrlKey && event.code == 'KeyD') {
        event.stopPropagation()
        event.preventDefault()
        setHideDev(v => !v)
      }
  })
  }, [])

  return (
    <div class="root">
      {connectionState !== 'connected' && <Shield message={shieldMessage} progress logo />}
      <div class="controls">
        <h1>{state.table?.company_name}{' '}{state.table?.alley_name}{' '}<span style="font-size:0.8em">{state.table?.pilot_name}</span></h1>
        <div style="flex:1"></div>
        {!!(state.copterSoft?.warehouseName && state.table?.company_name) &&
          <AlleyPicker
            key={state.table.pilot_name + state.table.alley_name}
            onAlley={params => sendIfConnected('loadAlley:' + JSON.stringify(params))}
            alleyNames={state.copterSoft?.alleyNames || []}
            defaultPilot={state.table.pilot_name}
            defaultAlley={state.table.alley_name}
            warehouseName={state.copterSoft.warehouseName}
            tableWarehouseName={state.table.company_name}
            exisintgResults={state.copterSoft.savedResults}
          />
        }
        <div style="flex:1"></div>
        <JsonFileLoader onJson={onLoadWarehouseJson} prompt="Import Warehouse JSON" style="font-size:small" confirm="Override Warehouse JSON configuration, are you sure?" />
        <input type="button" value="Delete all saved results" onClick={() => {
          if (confirm(`Delete all saved results from drone?\nAll existing files will be deleted, are you sure?`))
            sendIfConnected('deleteAllCopterSoftReports')
        }} />
        <div style="font-size:1.5em;z-index:10" onClick={() => setHideDev(v => !v)}>{{ connected: '🟢', disconnected: '🔴', connecting: '🟠' }[connectionState]}</div>
      </div>
      <div class="main">
        <div class="panel left">
          <div class="rack_table_container minibox">
            {state.table ? (
              <Table table={state.table} key={state.table?.alley_name} />
            ) : (
              'No rack loaded'
            )}
          </div>
          <div class="panel rack_table_controls">
            <div class="barcode">
              <pre style="font-size:2rem;">{state.barcode || 'Scan a code'}</pre>
              <div style="margin-top:1em;">
                Uniqie filters:
                {(state.table?.unique_filters || []).map((v, i) => <pre key={i}>[{v.join(' | ')}]</pre>)}
              </div>
              <div style="margin-top:1em;">
                Extra filters:
                {(state.table?.extra_filters || []).map((v, i) => <pre key={i}>[{v.join(' | ')}]</pre>)}
              </div>
            </div>
            <div class="image"><img src={(state.osd_scan_status || 'logo') + '.svg'} /></div>
          </div>
          <div class="results_controls">
            <select onClick={() => sendIfConnected('getSavedResults')} ref={savedResultsOptionsRef}>
              {(state.copterSoft?.savedResults || []).map(v =>
                <option key={v} value={v}>{v}</option>
              )}
            </select>
            <input type="button" value="Download inventory result" onClick={() => sendIfConnected('downloadCopterSoftReport:' + savedResultsOptionsRef.current.value)} />
            <input type="button" value="Load alley" onClick={() => {
              sendIfConnected('loadAlleyFromFile:' + savedResultsOptionsRef.current.value)
            }} />
          </div>
        </div>
        {!hideDev &&
          <div class="panel right">
            <AutoScroll class="box">
              <b>log</b>
              {logsHtml.map((__html, i) =>
                <pre key={i} dangerouslySetInnerHTML={{ __html }} />
              )}
            </AutoScroll>
            <div class="box">
              <b>state</b>
              <pre>{JSON.stringify(state, null, 2)}</pre>
            </div>
          </div>
        }
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

const Table = ({ table, ...rest }) => {
  const currentTableRef = useRef(null)
  const currentPalleteRef = useRef(null)
  const [palletCellWidth, setPalletCellWidth] = useState(0)
  const balk_list = []
  let balk_max = 0
  for (const width of table.balk_list) {
    balk_max += width
    balk_list.push(balk_max)
  }
  const cols = table.column_headers.length + 1
  const current_pallet_show = table.current_pallet <= table.column_headers.length * table.row_headers.length
  const cl = v => ['NO_TAG', 'EMPTY', 'UNREADABLE', undefined].includes(v) ? v : 'BARCODE'
  useEffect(() => {
    currentTableRef.current?.parentElement?.scrollTo?.({ left: table.current_pallet_col * palletCellWidth, behavior: 'instant' })
  }, [table.alley_name, table.current_pallet_col, palletCellWidth])

  const currentPalletRef = useCallback(el => {
    const width = el?.getBoundingClientRect?.()?.width
    if (width) {
      currentPalleteRef.current = el
      setPalletCellWidth(width)
    }
  }, [])

  return (
    <table ref={currentTableRef} {...rest} class="rack_table" style={`font-size:1rem;min-width:${cols * 3}em`}>
      <tr><td>{' '}</td>{
        table.column_headers.map((v, coli) => <td class={cx({ balk: balk_list.includes(coli + 1) })} key={v}><b>{v}</b></td>)
      }</tr>
      {table.table.map((row, rowi) =>
        <tr key={rowi}>
          <td><b>{table.row_headers[rowi]}</b></td>
          {row.map((col, coli) => {
            const current_pallet = current_pallet_show && table.current_pallet_row === rowi && table.current_pallet_col === coli
            const balk = balk_list.includes(coli + 1)
            return (
              <td ref={current_pallet ? currentPalletRef : undefined} key={coli} class={cx({ balk, current_pallet }, cl(col[0]))}>
                {col.join(', ')}
              </td>
            )
          })}
        </tr>
      )}
    </table>
  )
}

const AlleyPicker = ({ onAlley, alleyNames, defaultAlley, defaultPilot, warehouseName, tableWarehouseName, exisintgResults }) => {
  const [pilot, setPilot] = useState(defaultPilot)
  const [alley, setAlley] = useState(defaultAlley)
  const reflyAlley = (tableWarehouseName === warehouseName && defaultAlley === alley) || exisintgResults.includes(`${warehouseName}/${alley}.jsonl`)
  const onLoadClick = useCallback(() => {
    if (reflyAlley)
      if (!confirm(`Refly alley ${alley}?\nExisting data will be deleted, are you sure?`))
        return
    onAlley({ pilot, alley })
  }, [pilot, alley, reflyAlley])
  return <>
    <input placeholder="Pilot name" value={pilot} onChange={e => setPilot(e.target.value)} defaultValue={defaultPilot} />
    <select value={alley} onChange={e => setAlley(e.target.value)} defaultValue={defaultAlley}>
      {alleyNames.map(v => <option key={v} value={v}>{v}</option>)}
    </select>
    <input type="button" value={reflyAlley ? 'Refly' : 'Load alley'} onClick={onLoadClick} disabled={!pilot || !alley} />
  </>
}

const JsonFileLoader = ({ prompt = 'Open .json file', onJson = identity, confirm: confirmText = false }) => {
  const fileInputRef = useRef(null)
  const handleChange = useCallback(event => {
    const input = event.target
    if (!input.files.length) {
      return
    }
    const selectedFile = input.files.item(0)
    const fileReader = new FileReader()
    fileReader.addEventListener('load', e => {
      if (confirmText && !confirm(confirmText)) return
      onJson({ name: selectedFile.name, json: JSON.parse(e.target.result) })
    })
    fileReader.readAsText(selectedFile)
  }, [onJson, confirmText])
  const handleClick = useCallback(() => {
    if (!fileInputRef.current) return
    fileInputRef.current.value = null
    fileInputRef.current.click()
  }, [])
  return (
    <>
      <input type="button" value={prompt} onClick={handleClick} />
      <input ref={fileInputRef} type="file" onChange={handleChange} accept=".json" hidden />
    </>
  )
}

//window.addEventListener('load', () => preact.render(<App />, document.body))


waitLoadAll(Object.values(sounds)).then(() => preact.render(<App />, document.body))