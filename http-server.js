const http = require('node:http')
const path = require('node:path')
const fs = require('node:fs')
const { inspect } = require('node:util')
const tar = require('tar')
const { fsExists } = require('./utils')

const resultsLocation = process.env.WAREHOUSE_RESULTS_DIR || '../warehouseResults/'

const resInspect = (res, code, value) => {
  if (value instanceof Error) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.write(inspect(value))
    res.end()
  } else {
    res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.write(inspect(value))
    res.end()
  }
}

const safePath = (root, ...args) => path.join(root, path.join('/', ...args))
const safeRelativePath = (root, ...args) => path.relative(root, safePath(root, ...args))

const startResultDownloadServer = (port=8082, host='0.0.0.0', callback) => {
  http.createServer(function (req, res) {
    try {
      const url = new URL('http://localhost' + req.url)
      const [warehouse, alley] = url.pathname.slice(1).split('/').map(decodeURIComponent)
      const warehousePath = safePath(resultsLocation, warehouse)

      if (!fsExists(warehousePath)) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.write('Results not found: warehouse folder not found')
        res.end()
        return
      }

      if (alley) {
        const alleyPath = safeRelativePath(warehousePath, alley + '.jsonl')
        const photoPath = safeRelativePath(warehousePath, 'Photo', alley)
        const tarEntries = []
        if (fsExists(path.join(warehousePath, alleyPath))) tarEntries.push(alleyPath)
        if (fsExists(path.join(warehousePath, photoPath))) tarEntries.push(photoPath)
        if (tarEntries.length) {
          res.writeHead(200, {
            'Content-Type': 'application/tar',
            'Content-Disposition': `attachment; filename="${encodeURIComponent(`${warehouse}_${alley}.tar`)}"`,
          })
          tar.create({
            cwd: warehousePath
          }, tarEntries).pipe(res)
        } else {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
          res.write('Results not found: no photos or report file')
          res.end()
        }
      } else {
        const dirents = fs.readdirSync(warehousePath)
        if (dirents.length) {
          res.writeHead(200, {
            'Content-Type': 'application/tar',
            'Content-Disposition': `attachment; filename="${encodeURIComponent(`${warehouse}.tar`)}"`,
          })
          tar.create({
            cwd: warehousePath,
          }, dirents).pipe(res)
        } else {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
          res.write('Results not found: warehouse folder empty')
          res.end()
        }
      }
    } catch (err) {
      console.log(err)
      resInspect(res, 500, err)
    }
  }).listen(port, host, callback)
}

module.exports = {
  startResultDownloadServer,
}