'use strict'

const net = require('node:net')
const { EventEmitter } = require('node:events')
const url = require('node:url')
const dgram = require('node:dgram')

const boxcHost = process.env.BOXC_HOST || '0.0.0.0'
const boxcPort = +(process.env.BOXC_PORT || 8081)
const boxcServiceHost = process.env.BOXC_SERVICE_HOST || '127.0.0.1'
const boxcServicePort = +(process.env.BOXC_SERVICE_PORT || 8082)
const boxcPalletBottomUdpServerPort = +(process.env.BOXC_PALLET_BOTTOM_UDP_SERVER_PORT || 8088)

const protocolPackMsg = args =>
  '?' + Object.entries(args).map(([k, v]) => k + '=' + v).join('&') + '\n'


const clients = new Set()
const hub = new EventEmitter()
hub.on('sendToClients', data => [...clients].map(cl => cl.write(data)))

const server = net.createServer(client => {
  const { address, port } = client.address()
  console.log(`[boxc]: client connected @ ${address}:${port}`)
  clients.add(client)
  client.on('data', data => hub.emit('recvFromClient', data))
  client.on('error', console.log)
  client.on('close', () => {
    clients.delete(client)
    client.removeAllListeners()
  })
})

server.listen(boxcPort, boxcHost, () =>
  console.log(`[boxc]: ${boxcHost}:${boxcPort}`))

server.on('error', console.log)


const serverClient = new net.Socket()

serverClient.on('connect', () => {
  console.log(`[boxc]: server connected @ ${boxcServiceHost}:${boxcServicePort}`)
  //serverClientConnected = true
})

serverClient.connect(boxcServicePort, boxcServiceHost)

const detectedBoxesReg = /DETECTED (-?\d+) BOXES!/
const notDetectedBoxesReg = /NOT DETECTED!/
const numerLineReg = /\n(-?\d+)/
const lineReqReg = /(\?.*)\r?\n/

let responseBuffer
let responseBufferMatched = false

serverClient.on('data', data => {
  const dataStr = String(data)
  responseBuffer += dataStr
  /*
  if (!responseBufferMatched) {
    const totalBoxesMathed = responseBuffer.match(detectedBoxesReg)
    if (totalBoxesMathed) {
      responseBufferMatched = true
      hub.emit('totalBoxes', +totalBoxesMathed[1])
    }
  }
  if (!responseBufferMatched) {
    const notDetectedBoxesMatched = responseBuffer.match(notDetectedBoxesReg)
    if (notDetectedBoxesMatched) {
      responseBufferMatched = true
      hub.emit('totalBoxes', -1)
    }
  }
  */
  if (!responseBufferMatched) {
    const numberMatched = responseBuffer.match(numerLineReg)
    if (numberMatched) {
      responseBufferMatched = true
      hub.emit('totalBoxes', +numberMatched[1])
    }
  }
  hub.emit('sendToClients', data)
})

serverClient.write = serverClient.write.bind(serverClient)

hub.on('recvFromClient', data => {
  const dataStr = String(data)
  const lineReqMatched = dataStr.match(lineReqReg)
  if (lineReqMatched) {
    hub.emit('req', { ...url.parse(lineReqMatched[1], true).query })
  }
})

const sendReq = req => {
  responseBuffer = ''
  responseBufferMatched = false
  serverClient.write(protocolPackMsg(req))
}

serverClient.on('error', () => console.log)

serverClient.on('close', () => {
  console.log('[boxc]: server closed!')
  setTimeout(() => serverClient.connect(boxcServicePort, boxcServiceHost), 3000)
})

///////////////////////////////////// poddon ok

const palletBottomUdpServer = dgram.createSocket('udp4')
palletBottomUdpServer.on('error', (err) => {
  console.log('[palletBottomUdp] server error', err)
  palletBottomUdpServer.close()
})
palletBottomUdpServer.on('message', (msg, rinfo) => {
  hub.emit('palletBottomVisible', msg[0] === 121 /*'y'*/)
})
palletBottomUdpServer.on('listening', () => {
  const address = palletBottomUdpServer.address()
  console.log(`[palletBottomUdp] listening ${address.address}:${address.port}`)
})
palletBottomUdpServer.bind(boxcPalletBottomUdpServerPort)


module.exports = {
  protocolPackMsg,
  hub,
  sendReq
}
