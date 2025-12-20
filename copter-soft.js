'use strict'

const { EventEmitter } = require('node:events')
const fs = require('node:fs')
const path = require('node:path')
const { getFiles, log } = require('./utils')

const warehouseFileLocation = process.env.WAREHOUSE_FILE || '../warehouse.json'
const warehouseLoadedAlleyFileLocation = process.env.WAREHOUSE_LOADED_ALLEY_FILE || '../warehouseLoadedAlley.txt'
const resultsLocation = process.env.WAREHOUSE_RESULTS_DIR || '../warehouseResults/'
const resultsTarServerPort = +(process.env.WAREHOUSE_RESULTS_TAR_SERVER_PORT || 8082)

try { fs.mkdirSync(resultsLocation) } catch {}

class CopterSoft extends EventEmitter {
  resultsLocation = resultsLocation
  warehouse = null
  loadedAlleyFilename = ''
  constructor() {
    super()
    this.reloadWarehouse()
  }

  reloadWarehouse = () => {
    try {
      this.warehouse = JSON.parse(fs.readFileSync(warehouseFileLocation))
      return this.warehouse
    } catch (err) {
      this.warehouse = null
      this.emit('err', err)
      return null
    }
  }

  overwriteWarehouse = (desc) => {
    fs.writeFileSync(warehouseFileLocation, JSON.stringify(desc))
    fs.writeFileSync(warehouseLoadedAlleyFileLocation, '')
    return this.reloadWarehouse()
  }

  getSavedResults = async () => await getFiles(resultsLocation).then(v => v.filter(v => v.endsWith('.jsonl')).map(v => v.slice(resultsLocation.length)).sort())
  getSavedResult = async name => await fs.promises.readFile(this.getSavedResultFilename(name), 'base64')
  deleteSavedResult = async name => await fs.promises.unlink(this.getSavedResultFilename(name), 'base64')
  deleteAllSavedResults = async () => await getFiles(resultsLocation).then(v => Promise.all(v.map(fs.promises.unlink)))
  getSavedResultFilename = name => {
    if (name !== undefined)
      return path.resolve(path.join(resultsLocation, name))
    else {
      try {
        return fs.readFileSync(warehouseLoadedAlleyFileLocation, 'utf-8')
      } catch {
        return ''
      }
    }
  }

  overwriteLoadedAlleyFilename = file => {
    if (this.loadedAlleyFilename !== file)
      fs.writeFileSync(warehouseLoadedAlleyFileLocation, file)
    this.loadedAlleyFilename = file
  }
}

const { startResultDownloadServer } = require('./http-server')
startResultDownloadServer(resultsTarServerPort)

module.exports = CopterSoft