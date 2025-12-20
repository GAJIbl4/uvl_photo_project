'use strict'

const net = require('node:net')
const { EventEmitter } = require('node:events')
const { log, paseUrl, paramsJoin } = require('./utils')

const minttPort = +(process.env.MINTT_PORT || 55757)
const minttHost = process.env.MINTT_HOST || '0.0.0.0'

const clients = new Set()

const sender = new EventEmitter()

sender.on('send', data => [...clients].map(cl => cl.write(data)))

const protocol = new class Protocol extends EventEmitter {
  hasConnections = () => clients.size
  send = (topic, ...rest) => {
    let [params, data] = rest
    if (typeof params !== 'object' || params?.constructor !== Object) {
      const tmp = data
      data = params
      params = typeof tmp === 'object' ? tmp : {}
    }
    sender.emit('send', message(topic, params, data))
  }
}

const CRLF = Buffer.from([0x0d, 0x0a])
const EMPTY = Buffer.from([])

const parse = messages_buff => {
  let buff = messages_buff
  try {
    while (buff.length) {
      const headEnd = buff.indexOf(CRLF)
      const bodyStart = headEnd + 2
      const [topic, params, head] = paseUrl(buff.slice(0, headEnd))
      if (head.protocol !== 'mintt:') return
      const bodyEnd = bodyStart + (params.len || 0)
      let body = buff.slice(bodyStart, bodyEnd)
      if (params.mime === 'text/plain')
        body = body.toString('utf-8')
      protocol.emit('message', topic, params, body)
      protocol.emit(topic, params, body)
      buff = buff.slice(bodyEnd)
    }
  } catch (err) {
    console.log('mintt parsing error:', err)
  }
}

const message = (topic, params, data) => {
  if (data) {
    if (Buffer.isBuffer(data))
      params.mime = 'application/octet-stream'
    else {
      data = Buffer.from(String(data), 'utf-8')
      params.mime = 'text/plain'
    }
    params.len = data.length
  } else data = EMPTY
  const query = paramsJoin(params)
  const header = 'mintt:' + topic + (query ? '?' + query : '')
  return Buffer.concat([
    Buffer.from(header, 'utf-8'),
    CRLF,
    data,
  ])
}

const server = net.createServer(client => {
  const { address, port } = client.address()
  console.log(`[mintt]: client connected @ ${address}:${port}`)
  clients.add(client)
  client.on('data', parse)
  client.on('error', console.log)
  client.on('close', () => {
    clients.delete(client)
    client.removeAllListeners('data')
  })
  protocol.emit('clientConnected', client)
})

//server.maxConnections = 1
server.listen(minttPort, minttHost, () =>
  console.log(`[mintt]: ${minttHost}:${minttPort}`))

server.on('error', console.log)

module.exports = protocol