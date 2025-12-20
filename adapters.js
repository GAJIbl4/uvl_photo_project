'use strict'

const dgram = require('node:dgram')

const udp = (host, port, connected) => recv => {
  const socket = dgram.createSocket('udp4')
  let rinfo = null
  socket.on('listening', () => {
    connected?.(`${host}:${port} > unknown`, false)
    socket.once('message', (msg, _rinfo) => {
      rinfo = _rinfo
      connected?.(`${host}:${port} > ${rinfo.address}:${rinfo.port}`, true)
    })
  })
  socket.bind(port, host)
  socket.on('message', (buff, _rinfo) => {
    rinfo = _rinfo
    recv(buff)
  })
  const send = buff => rinfo &&
    socket.send(buff, rinfo.port, rinfo.address)
  return send
}

const connect = async (
  adapter1,
  adapter2,
) => {
  let sendTo1
  const sendTo2 = await adapter2(
    buff => sendTo1?.(buff)
  )
  sendTo1 = await adapter1(
    sendTo2
  )
}

const connectSync = (
  adapter1,
  adapter2,
) => {
  let sendTo1
  const sendTo2 = adapter2(
    buff => sendTo1?.(buff)
  )
  sendTo1 = adapter1(
    sendTo2
  )
}

module.exports = { udp, connect, connectSync }