'use strict'

require('dotenv').config()
const { SerialPort } = require('serialport')
const { DelimiterParser } = require('@serialport/parser-delimiter')
const osd = require('./osd')
const ui = require('./ui')
const { MavSystem, mav2 } = require('./mavlink')

const { log } = require('./utils')
const { networkInterfaces } = require('os')
const packageJson = require('./package.json')
const { checkButton } = require('./rc')
const { udp, connect } = require('./adapters')
const { default: CancelablePromise } = require('cancelable-promise')

const boxCounting = require('./box-counting')
const fs = require('node:fs')
const path = require('node:path')

const droneId = process.env.DRONE_ID || 0

const getIp = () => {
  const addrs = networkInterfaces().wlan0 || []
  const addr = addrs.filter(v => v.family === 'IPv4')[0] || {}
  return addr.address || undefined
}

console.log('[drone]: software:', packageJson.version)
console.log('[drone]: id:', droneId)

let droneIp
setInterval(() => {
  const ip = getIp()
  if (ip !== droneIp) {
    droneIp = ip
    console.log('[drone]: ip changed', ip)
  }
}, 1000)

const mavlinkSerialPath = process.env.MAVLINK_SERIAL_PATH || '/dev/ttyACM0'
const mavlinkSerialBaud = +(process.env.MAVLINK_SERIAL_BAUD || 57600)
const scanerOSDPath = process.env.SCANNER_OSD_SERIAL_PATH || '/dev/ttyAMA0'
const scanerOSDBaud = +(process.env.SCANNER_OSD_SERIAL_BAUD || 115200)

const osdWidth = +(process.env.OSD_WIDTH || 30)
const osdHeight = +(process.env.OSD_HEIGHT || 16)
const osdPaddingTop = +(process.env.OSD_PADDING_TOP || 1)
const osdPaddingBottom = +(process.env.OSD_PADDING_BOTTOM || 5)
const osdPaddingRight = +(process.env.OSD_PADDING_RIGHT || 2)
const osdPaddingLeft = +(process.env.OSD_PADDING_LEFT || 2)

const mavlinkUdpEn = process.env.MAVLINK_UDP_EN === 'true'
const mavlinkUdpHost = process.env.MAVLINK_UDP_HOST || '0.0.0.0'
const mavlinkUdpPort = +(process.env.MAVLINK_UDP_PORT || 14550)
const mavlinkSystemId = +(process.env.MAVLINK_SYSTEM_ID || process.env.DRONE_ID || 1)

const rcEmptyCh = +(process.env.RC_EMPTY_CH || 6)
const rcRescanCh = +(process.env.RC_RESCAN_CH || 6)
const rcNoTagCh = +(process.env.RC_NO_TAG_CH || 6)
const rcUnreadableCh = +(process.env.RC_UNREADABLE_CH || 6)
const rcPhotoCh = +(process.env.RC_PHOTO_CH || 7)
const rcScanoffCh = +(process.env.RC_SCANOFF_CH || 8)
const rcFlydirectionCh = +(process.env.RC_FLYDIRECTION_CH || 9)

const rcEmptyPwm = +(process.env.RC_EMPTY_PWM || 1067)
const rcRescanPwm = +(process.env.RC_RESCAN_PWM || 1249)
const rcNoTagPwm = +(process.env.RC_NO_TAG_PWM || 1495)
const rcUnreadablePwm = +(process.env.RC_UNREADABLE_PWM || 982)
const rcPhotoPwm = +(process.env.RC_PHOTO_PWM || 2006)
const rcScanoffPwm = +(process.env.RC_SCANOFF_PWM || 2006)
const rcFlydirectionFwrdPwm = +(process.env.RC_FLYDIRECTION_FORWARD_PWM || 982)
const rcFlydirectionBackPwm = +(process.env.RC_FLYDIRECTION_BACK_PWM || 2006)
const rcFlydirectionNonePwm = +(process.env.RC_FLYDIRECTION_NONE_PWM || 1495)

const rcFlydirectionLeftToRight = (process.env.RC_FLYDIRECTION_LEFT_TO_RIGHT || 'true') === 'true'

const rcScanoffPpin = +(process.env.RC_SCANOFF_PIN || 589)

const minttHost = process.env.MINTT_HOST || '0.0.0.0'
const minttPort = +(process.env.MINTT_PORT || 55757)
const minttSerialEn = process.env.MINTT_SERIAL_EN === 'true'
const minttSerialPath = process.env.MINTT_SERIAL_PATH || '/dev/ttyUSB0'
const minttSerialBaud = +(process.env.MINTT_SERIAL_BAUD || 115200)

const realsensepyEn = process.env.REALSENSEPY_EN === 'true'
const realsensepyCameraOrientation = process.env.REALSENSEPY_CAMERA_ORIENTATION
const realsensepyUdpHost = process.env.REALSENSEPY_UDP_HOST || 'localhost'
const realsensepyUdpPort = +(process.env.REALSENSEPY_UDP_PORT || 14552)

const reportDir = process.env.REPORT_DIR || '../uvl-box-counting/data'
const masterDataFile = process.env.MASTER_DATA_FILE || '../warehouseBoxCounting.json'
const currentScanTaskFile = process.env.CURRENT_SCAN_TASK_FILE || '../warehouseCurrentScanTaskFile.json'

let masterData = []
try {
  masterData = JSON.parse(fs.readFileSync(masterDataFile, 'utf-8'))
} catch (err) {
  console.log('[masterData] no Master Data file found')
}

let currentScanTaskDirection = 0
let currentScanTask = { alley: 'UNKNOWN', bin: 1 }

try {
  currentScanTask = JSON.parse(fs.readFileSync(currentScanTaskFile, 'utf-8'))
} catch (err) {}

const currentScanNext = (mult = 1) => {
  currentScanTask = {
    bin: currentScanTask.bin + currentScanTaskDirection * mult,
    alley: currentScanTask.alley,
    zone: currentScanTask.zone,
  }
  if (currentScanTask.bin < 1)
    currentScanTask.bin = 1
  updateOsdCurrentScanTask()
}

const saveScanToReport = (scanStatus) => {
  fs.appendFileSync(path.join(reportDir, 'boxCountingReport.json'), JSON.stringify({ ...currentScanTask, scanStatus, timestamp: Date.now() }) + '\n', 'utf-8')
}

const scanerOSD = new SerialPort({
  path: scanerOSDPath, baudRate: scanerOSDBaud, lock: false, autoOpen: false
})

setInterval(() => {
  if (!scanerOSD.isOpen) scanerOSD.open(err => {
    if (err) {
      console.log(`[scanerOSD]:`, err)
    } else {
      console.log(`[scanerOSD]: ${scanerOSDPath}:${scanerOSDBaud}`)
      setTimeout(onOSDConnected, 5000)
    }
  })
}, 3000)

const scanerOSDrl = scanerOSD.pipe(new DelimiterParser({ delimiter: Buffer.from([0x0a]) }))

if (process.env.__TEST_GCS === 'true') {
  const rchoice = arr => arr[Math.floor(Math.random() * arr.length)]
  const rch = () => rchoice('012345678901234567890123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ')
  const rstr = count => new Array(count).fill('').map(rch).join('')
  setInterval(() => scanerOSDrl.emit('data', Buffer.from('07' + rstr(16))), 4500)
  setInterval(() => handleButton(rchoice(['EMPTY', 'NEXT', 'UNREADABLE'])), 5000)
  setInterval(() => rchoice([true, false]) && handleButton('RESCAN'), 500)
}



scanerOSDrl.on('data', buff => {
  const barcode = String(buff)
  console.log('[scanner]:', barcode)

  if (barcode.match(/^\d\d\d\d\d\d\d\d\d\d$/)) {
    const [zone, alley, bin] = [
      barcode.slice(0,1),
      barcode.slice(1,4),
      +barcode.slice(4,8)
    ]
    console.log('[scanner]: location',{zone, alley, bin})
    currentScanTask = { zone, alley, bin }
    updateOsdCurrentScanTask()
  } else {
    if (currentScanTask.scanStatus !== 'PHOTO TO SCAN') {
      const record = masterData.find(v => v?.barcode == barcode)
      currentScanTask = Object.assign({}, record, currentScanTask, { scanStatus: record ? 'PHOTO TO SCAN' : 'UNKNOWN' })
      updateOsdCurrentScanTask()
    }
  }
})

ui.configure(scanerOSD.write.bind(scanerOSD), {
  width: osdWidth,
  height: osdHeight,
  paddingTop: osdPaddingTop,
  paddingBottom: osdPaddingBottom,
  paddingRight: osdPaddingRight,
  paddingLeft: osdPaddingLeft,
})

const l515FrameLeft = +(process.env.L515_FRAME_LEFT || 15)
const l515FrameTop = +(process.env.L515_FRAME_TOP || 2)
const l515FrameWidth = +(process.env.L515_FRAME_WIDTH || 18)
const l515FrameHeight = +(process.env.L515_FRAME_HEIGHT || 10)
const l515FrameConeFactor = +(process.env.L515_FRAME_CONE_FACTOR || 2)
const l515FrameWidthExtra = i => Math.round(i / (l515FrameHeight/l515FrameConeFactor))

ui.updateLayout({
  l515top1: [l515FrameTop,    l515FrameLeft, '/'+'_'.repeat(l515FrameWidth-2)+'\\'],
  ...Object.fromEntries(new Array(l515FrameHeight-1).fill().map((v, i) => ['l515frame'+i+1, [l515FrameTop+i+1,  l515FrameLeft - l515FrameWidthExtra(i), '|'+' '.repeat(l515FrameWidth - 2 + l515FrameWidthExtra(i) * 2)+'|']])),
  logo: () => [
    ['center', 'center', 'UVL-INVENTORY'],
    ['center +1', 'center', 'V' + packageJson.version]
  ],

  name: ['top', 'center', `UVL_${droneId}X`],
  connection: ['top +1', 'center'],
  barcode: ['top +1', 'left'],
  alley: ['top +2', 'left'],
  bin: ['top +3', 'left'],
  scanStatusText: ['top +4', 'left'],

  palletBottomVisible: ['top', 'right'],
  scanoff: ['top +1', 'right'],
  scanStatus: v => !v ? [[], []] : (
    v === 'y' ? [
      ['center -1', 'left', [osd.ch.Checkmark1, osd.ch.Checkmark2]],
      ['center', 'left', [osd.ch.Checkmark3, osd.ch.Checkmark4]]
    ] : [
      ['center -1', 'left', 'XX'],
      ['center', 'left', 'XX']
    ]
  ),
  button: ['center +1', 'left'],
  
  palletMap: ['bottom', 'center', ''],
})

const updateOsdCurrentScanTask = (cst = currentScanTask) => {

  const palletMap = [
    osd.ch.Space,
    osd.ch.Space,
    osd.ch.Space,
    osd.ch.PalletNotScanned,
    osd.ch.PalletNotScanned,
    osd.ch.PalletNotScanned,
    osd.ch.Space,
    currentScanTaskDirection
      ? (currentScanTaskDirection === 1 ? osd.ch.ASCII_Plus : osd.ch.ASCII_Dash)
      : osd.ch.Space,
    currentScanTaskDirection
      ? osd.ch.ASCII_1
      : osd.ch.Space,
  ]

  const offs = 3
  let upto = (cst.bin - 1) % 3
  if (currentScanTaskDirection === -1)
    upto = 2 - upto
  let i
  for (i = 0; i < upto; i++)
    palletMap[offs + i] = osd.ch.PalletScanned
  palletMap[offs + i] = osd.ch.PalletCurrent

  if (!rcFlydirectionLeftToRight) {
    const tmp = palletMap[offs + 2]
    palletMap[offs + 2] = palletMap[offs + 0]
    palletMap[offs + 0] = tmp
  }

  ui.update({
    barcode: (cst.barcode || '').toUpperCase(),
    alley: (cst.alley ? 'ALL ' + cst.alley : '').toUpperCase(),
    bin: (cst.bin ? 'BIN ' + cst.bin : '').toUpperCase(),
    scanStatusText: (typeof cst.scanStatus === 'number'
      ? (cst.scanStatus < 0 ? 'NO DETECT' : cst.scanStatus + ' BOXES')
      : (cst.scanStatus || '')).toUpperCase(),
    palletMap
  })

  try {
    fs.writeFileSync(currentScanTaskFile, JSON.stringify(currentScanTask), 'utf-8')
  } catch (err) {}
}

const onOSDConnected = () => {
  ui.render()
  setTimeout(() => {
    ui.updateLayout({ logo: () => [[], []] }, true)
    updateOsdCurrentScanTask()
  }, 5000)
}

let prevConnectionStatus = null
setInterval(() => {
  const status = connectionStatus()
  if (status && status !== prevConnectionStatus)
    console.log(`[status]: ${status} (${getIp() || 'noip'})`)
  prevConnectionStatus = status
  ui.update('connection', status)
}, 500)

let scanStatusTimeout = undefined
const showScanStatus = (success) => {
  clearTimeout(scanStatusTimeout)
  ui.update('scanStatus', success ? 'y' : 'n')
  scanStatusTimeout = setTimeout(() => ui.update('scanStatus', false), 2000)
}

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
  ui.update('button', label)
  buttonTimeoutId = setTimeout(() => ui.update('button', false), 2000)
  if (label === 'EMPTY') {
    boxCounting.sendReq({...currentScanTask, command:'CMD:PHOTO'})
    saveScanToReport('EMPTY')
    currentScanNext()
  }
  if (label === 'UNREADABLE') {
    boxCounting.sendReq({...currentScanTask, command:'CMD:PHOTO'})
    saveScanToReport('UNREADABLE')
    currentScanNext()
  }
  if (label === 'RESCAN') {
    currentScanNext(-1)
  }
  if (label === 'NEXT') {
    currentScanNext()
  }
}

const updateOsdCurrentScanTaskDirection = dir => {
  currentScanTaskDirection = dir
  updateOsdCurrentScanTask()
}

mavSystem.on('rc_channels', msg => {
  checkButton(msg, rcPhotoCh, rcPhotoPwm, 'PHOTO', () => {
    if (currentScanTask.barcode) {
      handlBoxCountingReq({ barcode: currentScanTask.barcode })
    }
  })
  checkButton(msg, rcEmptyCh, rcEmptyPwm, 'EMPTY', handleButton)
  checkButton(msg, rcRescanCh, rcRescanPwm, 'RESCAN', handleButton)
  checkButton(msg, rcNoTagCh, rcNoTagPwm, 'NEXT', handleButton)
  checkButton(msg, rcUnreadableCh, rcUnreadablePwm, 'UNREADABLE', handleButton)
  checkButton(msg, rcScanoffCh, rcScanoffPwm, 'SCANOFF',
    () => ui.update('scanoff', 'SCANOFF'),
    () => ui.update('scanoff', false)
  )
  checkButton(msg, rcFlydirectionCh, rcFlydirectionFwrdPwm, 'FORWARD', () => updateOsdCurrentScanTaskDirection(1))
  checkButton(msg, rcFlydirectionCh, rcFlydirectionBackPwm, 'BACKWARD', () => updateOsdCurrentScanTaskDirection(-1))
  checkButton(msg, rcFlydirectionCh, rcFlydirectionNonePwm, 'NONE', () => updateOsdCurrentScanTaskDirection(0))
})

const connectionStatus = () => mavlinkHeartbeat
  ? getIp()
    ? true // TODO protocol has connection
      ? false
      : 'NO SOFTWARE'
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
if (mavlinkUdpEn) connect(
  mavSystem.connect('mavlink-udp'),
  udp(
    mavlinkUdpHost,
    mavlinkUdpPort,
    (v, twoWay) => {
      console.log('[mavlink-udp]:', v)
      if (twoWay && !rcChannelsArdupilotFixInterval)
        rcChannelsArdupilotFixInterval = setInterval(
          () => mavSystem.setMessageInterval('RC_CHANNELS', 10).catch(() => { }), 1000)
    }
  )
)

let palletInfoAlley = ''
let palletInfoBin = ''

const handlBoxCountingReq = (req) => {
  if ('barcode' in req && Object.keys(req).length === 1)
    Object.assign(currentScanTask, req)
  else
    currentScanTask = req
  currentScanTask.scanStatus = 'DTECTING...'
  updateOsdCurrentScanTask()
  console.log('[boxc]: cst', currentScanTask)
  boxCounting.sendReq(currentScanTask)
}

boxCounting.hub.on('req', handlBoxCountingReq)
boxCounting.hub.on('palletBottomVisible', y => ui.update('palletBottomVisible', y ? 'PODDON OK' : ''))
boxCounting.hub.on('totalBoxes', count => {
  currentScanTask.scanStatus = count
  updateOsdCurrentScanTask()
  showScanStatus(count >= 0)
  console.log('[boxc]: count', count)
  saveScanToReport(count)
})
