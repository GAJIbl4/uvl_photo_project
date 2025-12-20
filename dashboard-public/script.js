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
    } else if (name === 'lastPhoto') {
      const [photoId, photoData] = splitPayload(payload);
      const blob = new Blob([Uint8Array.from(atob(photoData), c => c.charCodeAt(0))], { type: 'image/jpeg' });
      const url = URL.createObjectURL(blob);
      stateCb(state => ({ ...state, lastPhotoImage: url, lastPhotoId: photoId }));
    } else if (name === 'photosArchive') {
      const blob = new Blob([Uint8Array.from(atob(payload), c => c.charCodeAt(0))], { type: 'application/zip' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `photos_${new Date().toISOString().split('T')[0]}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } else if (name === 'cameraSettings') {
      try {
        const settings = JSON.parse(payload);
        stateCb(state => ({ ...state, cameraSettings: settings }));
      } catch (err) {
        console.error('Failed to parse camera settings:', err);
      }
    } else if (name === 'info') {
      alert(payload);
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
  const [state, setState] = window.useState({});
  const [connectionState, setConnectionState] = window.useState({});
  const [shieldMessage, setShieldMessage] = window.useState('');
  const [cameraSettings, setCameraSettings] = window.useState({});
  const [showDeleteConfirm, setShowDeleteConfirm] = window.useState(false);
  const hardDisconnected = window.useRef(true);
  const wsRef = window.useRef(null);
  const sendIfConnected = (...args) => {
    if (wsRef.current && wsRef.current.send) {
      wsRef.current.send(...args);
    }
  };

  window.useEffect(async () => {
    while (true) {
      setConnectionState('connecting');
      await webSocketEngine(wsRef, setState, (socket) => {
        setConnectionState('connected');
        socket.send('getCameraSettings');
        if (state.lastPhoto && state.lastPhoto.path) {
          socket.send('getLastPhoto');
        }
      }).then((hard) => hardDisconnected.current = hard);
      setConnectionState('disconnected');
      await sleep(1000);
    }
  }, []);

  window.useEffect(() => {
    if (window.ipcRenderer && window.ipcRenderer.on) {
      window.ipcRenderer.on('message', (evt, v) => setShieldMessage(v));
    }
  }, []);

  window.useEffect(() => {
    if (hardDisconnected.current) {
      if (connectionState === 'connected') {
        beep('connected.wav');
        hardDisconnected.current = false;
      } else
      if (connectionState === 'disconnected')
      beep('disconnected.wav');
    }
  }, [connectionState]);

  window.useEffect(() => {
    if (state.cameraSettings) {
      setCameraSettings(state.cameraSettings);
    }
  }, [state.cameraSettings]);

  window.useEffect(() => {
    if (state.lastPhoto && state.lastPhoto.path && connectionState === 'connected') {
      sendIfConnected('getLastPhoto');
    }
  }, [state.lastPhoto && state.lastPhoto.id, connectionState]);

  const logsHtml = window.useMemo(() => (state.logs || []).map(htmlAnsify), [state.logs]);

  const [hideDev, setHideDev] = window.useState(true);

  window.useEffect(() => {
    document.addEventListener('keydown', (event) => {
      if (event.ctrlKey && event.code == 'KeyD') {
        event.stopPropagation();
        event.preventDefault();
        setHideDev((v) => !v);
      }
    });
  }, []);

  const handleDownloadArchive = () => {
    sendIfConnected('downloadPhotosArchive');
  };

  const handleDeleteAll = () => {
    if (confirm('Вы уверены, что хотите удалить все фотографии? Это действие нельзя отменить.')) {
      sendIfConnected('deleteAllPhotos');
    }
  };

  const handleUpdateSettings = () => {
    sendIfConnected(`updateCameraSettings:${JSON.stringify(cameraSettings)}`);
  };

  const handleReloadCamera = () => {
    if (confirm('Перезагрузить камеру с новыми настройками?')) {
      sendIfConnected('reloadCamera');
    }
  };

  const formatDate = (timestamp) => {
    if (!timestamp) return '';
    return new Date(timestamp).toLocaleString('ru-RU');
  };

  return (
    window.preact.h("div", { class: "root" },
    connectionState !== 'connected' && window.preact.h(Shield, { message: shieldMessage, progress: true, logo: true }),
    window.preact.h("div", { class: "controls" },
    window.preact.h("h1", null, "UVL Photo Project"),
    window.preact.h("div", { style: "flex:1" }),
    window.preact.h("div", { style: "font-size:1.5em;z-index:10", onClick: () => setHideDev((v) => !v) }, { connected: '🟢', disconnected: '🔴', connecting: '🟠' }[connectionState])
    ),
    window.preact.h("div", { class: "main" },
    window.preact.h("div", { class: "panel left" },
    window.preact.h("div", { class: "photo-section" },
    window.preact.h("h2", null, "Последняя фотография"),
    state.lastPhotoImage ? window.preact.h("div", { class: "photo-container" },
    window.preact.h("img", { src: state.lastPhotoImage, alt: "Last photo", style: "max-width:100%;max-height:60vh;object-fit:contain;" }),
    window.preact.h("div", { style: "margin-top:0.5em;font-size:0.9em;color:#aaa;" },
    "ID: ", (state.lastPhoto && state.lastPhoto.id) || 'N/A', window.preact.h("br"),
    "Время: ", formatDate(state.lastPhoto && state.lastPhoto.timestamp)
    )
    ) : (state.lastPhoto ? window.preact.h("div", null, "Загрузка фотографии...")
    : window.preact.h("div", { style: "color:#aaa;" }, "Нет фотографий"))
    ),
    window.preact.h("div", { class: "controls-section", style: "margin-top:1em;" },
    window.preact.h("h2", null, "Управление"),
    window.preact.h("div", { style: "display:flex;flex-direction:column;gap:0.5em;" },
    window.preact.h("button", { onClick: handleDownloadArchive }, "Выгрузить архив фотографий"),
    window.preact.h("button", { onClick: handleDeleteAll, style: "background:#f44336;color:white;" }, "Очистить все фотографии")
    )
    )
    ),
    window.preact.h("div", { class: "panel right" },
    window.preact.h("div", { class: "settings-section" },
    window.preact.h("h2", null, "Настройки камеры"),
    window.preact.h("div", { style: "display:flex;flex-direction:column;gap:0.5em;" },
    window.preact.h("label", null,
    "Ширина:",
    window.preact.h("input", { 
      type: "number", 
      value: cameraSettings.width || '', 
      onChange: (e) => setCameraSettings({...cameraSettings, width: +e.target.value}),
      style: "width:100%;"
    })
    ),
    window.preact.h("label", null,
    "Высота:",
    window.preact.h("input", { 
      type: "number", 
      value: cameraSettings.height || '', 
      onChange: (e) => setCameraSettings({...cameraSettings, height: +e.target.value}),
      style: "width:100%;"
    })
    ),
    window.preact.h("label", null,
    "EXIF ориентация:",
    window.preact.h("input", { 
      type: "number", 
      value: cameraSettings.exifOrientation || '', 
      onChange: (e) => setCameraSettings({...cameraSettings, exifOrientation: +e.target.value}),
      style: "width:100%;"
    })
    ),
    window.preact.h("label", null,
    window.preact.h("input", { 
      type: "checkbox", 
      checked: cameraSettings.saveEnabled || false,
      onChange: (e) => setCameraSettings({...cameraSettings, saveEnabled: e.target.checked})
    }),
    " Сохранять фотографии на диск"
    ),
    window.preact.h("label", null,
    "Директория сохранения:",
    window.preact.h("input", { 
      type: "text", 
      value: cameraSettings.saveDir || '', 
      onChange: (e) => setCameraSettings({...cameraSettings, saveDir: e.target.value}),
      style: "width:100%;"
    })
    ),
    window.preact.h("div", { style: "display:flex;gap:0.5em;margin-top:0.5em;" },
    window.preact.h("button", { onClick: handleUpdateSettings }, "Сохранить настройки"),
    window.preact.h("button", { onClick: handleReloadCamera }, "Перезагрузить камеру")
    )
    )
    ),
    !hideDev &&
    window.preact.h(window.preact.Fragment, null,
    window.preact.h(AutoScroll, { class: "box", style: "margin-top:1em;" },
    window.preact.h("b", null, "log"),
    logsHtml.map((__html, i) =>
    window.preact.h("pre", { key: i, dangerouslySetInnerHTML: { __html } })
    )
    ),
    window.preact.h("div", { class: "box", style: "margin-top:1em;" },
    window.preact.h("b", null, "state"),
    window.preact.h("pre", null, JSON.stringify(state, null, 2))
    )
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
    window.preact.h("div", { class: "shield_overlay" },
    !!logo && window.preact.h("img", { src: "logo.svg", style: "width:150px;height:61px;object-fit:cover;" }),
    !!progress && window.preact.h("div", { class: "progress" }),
    message !== undefined && window.preact.h("pre", { style: "white-space:pre-wrap;text-align:center;font-size:0.8rem;color:#aaaa" }, stringifyMessage(message))
    ));
};

const AutoScroll = ({ as: As = 'div', ...props }) => {
  const asRef = window.useRef(null);
  const ref = asRef.current;
  window.useEffect(() => {
    if (!ref) return;
    const { fontSize } = getComputedStyle(ref);
    const padding = fontSize.replace('px', '') * 2;
    const bottom = Math.abs(ref.scrollHeight - ref.clientHeight - ref.scrollTop);
    if (bottom < padding)
    requestAnimationFrame(() => ref.scrollTo(0, ref.scrollHeight));
  }, [ref, props]);
  return window.preact.h(As, _extends({ ref: asRef }, props));
};

waitLoadAll(Object.values(sounds)).then(() => {
  if (typeof window.preact === 'undefined') {
    console.error('Preact is not loaded');
    return;
  }
  if (typeof window.useState === 'undefined') {
    console.error('Preact hooks are not loaded');
    return;
  }
  window.preact.render(window.preact.h(App, null), document.body);
});
