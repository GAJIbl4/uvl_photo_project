'use strict';function _extends() {return _extends = Object.assign ? Object.assign.bind() : function (n) {for (var e = 1; e < arguments.length; e++) {var t = arguments[e];for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]);}return n;}, _extends.apply(null, arguments);}

const log = (...args) => (console.log(...args), args[0]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const identity = (v) => v;

const callOnce = (fn) => {
  let called = false;
  return (...args) => {
    if (!called) {
      called = true;
      fn(...args);
    }
  };
};

const splitPayload = (data) => {
  const sepIndex = data.indexOf(':');
  const type = sepIndex > 0 ? data.slice(0, sepIndex) : data;
  const payload = sepIndex > 0 ? data.slice(sepIndex + 1) : null;
  return [type, payload];
};

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function fromBase64(base64) {
  const binString = atob(base64);
  return textDecoder.decode(Uint8Array.from(binString, (m) => m.codePointAt(0)));
}

function toBase64(str) {
  const bytes = textEncoder.encode(str);
  const binString = String.fromCodePoint(...bytes);
  return btoa(binString);
}

const waitLoadAll = async (elems) => await Promise.all(elems.map((el) => new Promise((r) => el.addEventListener('canplaythrough', r))));

const sounds = Object.fromEntries([
'disconnected.wav',
'standard_signal.wav',
'connected.wav'].
map((v) => [v, new Audio('/music/' + v)]));

function beep(sound) {
  if (!sounds[sound])
  sounds[sound] = new Audio('/music/' + sound);
  sounds[sound].play();
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
  '#e5e5e5'],

  bg: 'var(--ansi-bg)',
  fg: 'var(--ansi-fg)'
});

const htmlAnsify = (value) => ansiToHtml.toHtml(value.
replace(/&/g, "&amp;").
replace(/</g, "&lt;").
replace(/>/g, "&gt;").
replace(/"/g, "&quot;").
replace(/'/g, "&#039;"));

const cx = (...args) => cx_flatten(args).join(' ');
const cx_flatten = (from, to = []) => {
  if (typeof from === 'string' || from instanceof String)
  to.push(from);else
  if (from && typeof from === 'object')
  if (typeof from[Symbol.iterator] === 'function')
  for (const item of from)
  cx_flatten(item, to);else

  for (const key in from)
  if (from[key])
  to.push(key);
  return to;
};

const webSocketEngine = (ref, stateCb, openCb) => new Promise((disconnectCb) => {
  const socket = new WebSocket(`ws://${location.hostname}:8081`);
  const closeAndDisconnect = () => socket.close(1000, 'ping failed');
  let disconnectDetectTimeoutId;
  socket.addEventListener('message', ({ data }) => {
    clearTimeout(disconnectDetectTimeoutId);
    disconnectDetectTimeoutId = setTimeout(closeAndDisconnect, 2000);
    const [name, payload] = splitPayload(data);
    if (name === 'ping')
    socket.send('pong');else
    if (name === 'pong') {

      // refresh disconnect timer in any case of message
    } else if (name === 'state')
    stateCb(JSON.parse(payload));else
    if (name === 'download') {
      const [fileName, fileData] = splitPayload(payload);
      const blob = new Blob([fileData]);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName.replace('/', '_').replace(' ', '_');
      a.textContent = 'Download';
      a.click();
      URL.revokeObjectURL(url);
      //setTimeout(() => URL.revokeObjectURL(url), 30000)
    } else
    if (name === 'error') {
      alert(payload);
    }
  });
  let pingIntervalId;
  let tsIntervalId;
  socket.addEventListener('open', () => {
    clearTimeout(disconnectDetectTimeoutId);
    disconnectDetectTimeoutId = setTimeout(closeAndDisconnect, 2000);
    pingIntervalId = setInterval(() => socket.send('ping'), 1000);
    tsIntervalId = setInterval(() => socket.send(`timestamp:${Date.now()}`), 5000);
    ref.current = socket;
    openCb(socket);
  });
  socket.addEventListener('close', (evt) => {
    ref.current = null;
    clearTimeout(disconnectDetectTimeoutId);
    clearInterval(pingIntervalId);
    clearInterval(tsIntervalId);
    disconnectCb(true);
  });
});

const App = () => {
  const [state, setState] = useState({});
  const [connectionState, setConnectionState] = useState({});
  const [shieldMessage, setShieldMessage] = useState('');
  const hardDisconnected = useRef(true);
  const wsRef = useRef(null);
  const sendIfConnected = (...args) => wsRef.current?.send?.(...args);

  useEffect(async () => {
    while (true) {
      setConnectionState('connecting');
      await webSocketEngine(wsRef, setState, (socket) => {
        setConnectionState('connected');
      }).then((hard) => hardDisconnected.current = hard);
      setConnectionState('disconnected');
      await sleep(1000);
    }
  }, []);

  useEffect(() => window.ipcRenderer?.on?.('message', (evt, v) => setShieldMessage(v)), []);

  useEffect(() => {
    if (hardDisconnected.current) {
      if (connectionState === 'connected') {
        beep('connected.wav');
        hardDisconnected.current = false;
      } else
      if (connectionState === 'disconnected')
      beep('disconnected.wav');
    }
  }, [connectionState]);

  useEffect(() => {
    if (state.table?.current_pallet && state.barcode)
    beep('standard_signal.wav');
  }, [state.table?.current_pallet]);

  const logsHtml = useMemo(() => (state.logs || []).map(htmlAnsify), [state.logs]);

  const [hideDev, setHideDev] = useState(true);

  useEffect(() => {
    document.addEventListener('keydown', (event) => {
      if (event.ctrlKey && event.code == 'KeyD') {
        event.stopPropagation();
        event.preventDefault();
        setHideDev((v) => !v);
      }
    });
  }, []);

  return (
    preact.h("div", { class: "root" },
    connectionState !== 'connected' && preact.h(Shield, { message: shieldMessage, progress: true, logo: true }),
    preact.h("div", { class: "controls" },
    preact.h("h1", null, state.table?.company_name, ' ', state.table?.alley_name, ' ', preact.h("span", { style: "font-size:0.8em" }, state.table?.pilot_name)),
    preact.h("div", { style: "flex:1" }),
    preact.h("div", { style: "font-size:1.5em;z-index:10", onClick: () => setHideDev((v) => !v) }, { connected: '🟢', disconnected: '🔴', connecting: '🟠' }[connectionState])
    ),
    preact.h("div", { class: "main" },
    preact.h("div", { class: "panel left" },
    preact.h("div", { class: "rack_table_container minibox" },
    state.table ?
    preact.h(Table, { table: state.table, key: state.table?.alley_name }) :

    'No rack loaded'

    ),
    preact.h("div", { class: "panel rack_table_controls" },
    preact.h("div", { class: "barcode" },
    preact.h("pre", { style: "font-size:2rem;" }, state.barcode || 'Scan a code'),
    preact.h("div", { style: "margin-top:1em;" }, "Uniqie filters:",

    (state.table?.unique_filters || []).map((v, i) => preact.h("pre", { key: i }, "[", v.join(' | '), "]"))
    ),
    preact.h("div", { style: "margin-top:1em;" }, "Extra filters:",

    (state.table?.extra_filters || []).map((v, i) => preact.h("pre", { key: i }, "[", v.join(' | '), "]"))
    )
    ),
    preact.h("div", { class: "image" }, preact.h("img", { src: (state.osd_scan_status || 'logo') + '.svg' }))
    )
    ),
    !hideDev &&
    preact.h("div", { class: "panel right" },
    preact.h(AutoScroll, { class: "box" },
    preact.h("b", null, "log"),
    logsHtml.map((__html, i) =>
    preact.h("pre", { key: i, dangerouslySetInnerHTML: { __html } })
    )
    ),
    preact.h("div", { class: "box" },
    preact.h("b", null, "state"),
    preact.h("pre", null, JSON.stringify(state, null, 2))
    )
    )

    )
    ));

};

const stringifyMessage = (val) => {
  if (val instanceof Error)
  return val.toString();else
  if (val === undefined)
  return '';else
  if (typeof val === 'string')
  return val;else

  return JSON.stringify(val, null, 2);
};

const Shield = ({ progress = false, logo = false, message = undefined }) => {
  return (
    preact.h("div", { class: "shield_overlay" },
    !!logo && preact.h("img", { src: "logo.svg", style: "width:150px;height:61px;object-fit:cover;" }),
    !!progress && preact.h("div", { class: "progress" }),
    message !== undefined && preact.h("pre", { style: "white-space:pre-wrap;text-align:center;font-size:0.8rem;color:#aaaa" }, stringifyMessage(message))
    ));

};

const AutoScroll = ({ as: As = 'div', ...props }) => {
  const asRef = useRef(null);
  const ref = asRef.current;
  useEffect(() => {
    if (!ref) return;
    const { fontSize } = getComputedStyle(ref);
    const padding = fontSize.replace('px', '') * 2;
    const bottom = Math.abs(ref.scrollHeight - ref.clientHeight - ref.scrollTop);
    if (bottom < padding)
    requestAnimationFrame(() => ref.scrollTo(0, ref.scrollHeight));
  }, [ref, props]);
  return preact.h(As, _extends({ ref: asRef }, props));
};

const Table = ({ table, ...rest }) => {
  const currentTableRef = useRef(null);
  const currentPalleteRef = useRef(null);
  const [palletCellWidth, setPalletCellWidth] = useState(0);
  const balk_list = [];
  let balk_max = 0;
  for (const width of table.balk_list) {
    balk_max += width;
    balk_list.push(balk_max);
  }
  const cols = table.column_headers.length + 1;
  const current_pallet_show = table.current_pallet <= table.column_headers.length * table.row_headers.length;
  const cl = (v) => ['NO_TAG', 'EMPTY', 'UNREADABLE', undefined].includes(v) ? v : 'BARCODE';
  useEffect(() => {
    currentTableRef.current?.parentElement?.scrollTo?.({ left: table.current_pallet_col * palletCellWidth, behavior: 'instant' });
  }, [table.alley_name, table.current_pallet_col, palletCellWidth]);

  const currentPalletRef = useCallback((el) => {
    const width = el?.getBoundingClientRect?.()?.width;
    if (width) {
      currentPalleteRef.current = el;
      setPalletCellWidth(width);
    }
  }, []);

  return (
    preact.h("table", _extends({ ref: currentTableRef }, rest, { class: "rack_table", style: `font-size:1rem;min-width:${cols * 3}em` }),
    preact.h("tr", null, preact.h("td", null, ' '),
    table.column_headers.map((v, coli) => preact.h("td", { class: cx({ balk: balk_list.includes(coli + 1) }), key: v }, preact.h("b", null, v)))
    ),
    table.table.map((row, rowi) =>
    preact.h("tr", { key: rowi },
    preact.h("td", null, preact.h("b", null, table.row_headers[rowi])),
    row.map((col, coli) => {
      const current_pallet = current_pallet_show && table.current_pallet_row === rowi && table.current_pallet_col === coli;
      const balk = balk_list.includes(coli + 1);
      return (
        preact.h("td", { ref: current_pallet ? currentPalletRef : undefined, key: coli, class: cx({ balk, current_pallet }, cl(col[0])) },
        col.join(', ')
        ));

    })
    )
    )
    ));

};

// AlleyPicker component removed - no longer needed
const _AlleyPicker = ({ onAlley, alleyNames, defaultAlley, defaultPilot, warehouseName, tableWarehouseName, exisintgResults }) => {
  const [pilot, setPilot] = useState(defaultPilot);
  const [alley, setAlley] = useState(defaultAlley);
  const reflyAlley = tableWarehouseName === warehouseName && defaultAlley === alley || exisintgResults.includes(`${warehouseName}/${alley}.jsonl`);
  const onLoadClick = useCallback(() => {
    if (reflyAlley)
    if (!confirm(`Refly alley ${alley}?\nExisting data will be deleted, are you sure?`))
    return;
    onAlley({ pilot, alley });
  }, [pilot, alley, reflyAlley]);
  return preact.h(preact.Fragment, null,
  preact.h("input", { placeholder: "Pilot name", value: pilot, onChange: (e) => setPilot(e.target.value), defaultValue: defaultPilot }),
  preact.h("select", { value: alley, onChange: (e) => setAlley(e.target.value), defaultValue: defaultAlley },
  alleyNames.map((v) => preact.h("option", { key: v, value: v }, v))
  ),
  preact.h("input", { type: "button", value: reflyAlley ? 'Refly' : 'Load alley', onClick: onLoadClick, disabled: !pilot || !alley })
  );
};

const JsonFileLoader = ({ prompt = 'Open .json file', onJson = identity, confirm: confirmText = false }) => {
  const fileInputRef = useRef(null);
  const handleChange = useCallback((event) => {
    const input = event.target;
    if (!input.files.length) {
      return;
    }
    const selectedFile = input.files.item(0);
    const fileReader = new FileReader();
    fileReader.addEventListener('load', (e) => {
      if (confirmText && !confirm(confirmText)) return;
      onJson({ name: selectedFile.name, json: JSON.parse(e.target.result) });
    });
    fileReader.readAsText(selectedFile);
  }, [onJson, confirmText]);
  const handleClick = useCallback(() => {
    if (!fileInputRef.current) return;
    fileInputRef.current.value = null;
    fileInputRef.current.click();
  }, []);
  return (
    preact.h(preact.Fragment, null,
    preact.h("input", { type: "button", value: prompt, onClick: handleClick }),
    preact.h("input", { ref: fileInputRef, type: "file", onChange: handleChange, accept: ".json", hidden: true })
    ));

};

//window.addEventListener('load', () => preact.render(<App />, document.body))


waitLoadAll(Object.values(sounds)).then(() => preact.render(preact.h(App, null), document.body));