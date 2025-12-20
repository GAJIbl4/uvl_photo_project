'use strict'

const { LibcameravidJPEGStream } = require('./camera')
const { writeFileSync } = require('node:fs')
const piexifjs = require('piexifjs')

const photoWidth = +(process.env.PHOTO_WIDTH || 2028)
const photoHeight = +(process.env.PHOTO_HEIGHT || 1520)
const photoExifOrientation = +(process.env.PHOTO_EXIF_ORIENTATION || 6)
// for rotation values see http://www.cipa.jp/std/documents/e/DC-008-2012_E.pdf

let cameraError = false

const camera = new LibcameravidJPEGStream({
  width: photoWidth,
  height: photoHeight,
}, err => cameraError = err)

camera.once?.('data', data => null)

const exifRotate = (buff, orientation) => {
  if (!orientation) return buff
  const buffStr = buff.toString('latin1')
  const exifObj = piexifjs.load(buffStr)
  if (!exifObj['0th']) exifObj['0th'] = {}
  exifObj['0th'][piexifjs.ImageIFD.Orientation] = orientation
  const exifStr = piexifjs.dump(exifObj)
  return Buffer.from(piexifjs.insert(exifStr , buffStr), 'latin1')
}

let takePhoto = (id, callback) => {
  if (cameraError) {
    callback(id, cameraError)
    return
  }
  const on_photo = data => {
    try {
      //writeFileSync(name, data)
      callback?.(id, exifRotate(data, photoExifOrientation))
    } catch (err) {
      console.log('failed saving', id)
      console.log(err)
    }
  }
  camera.once('data', on_photo)
  setTimeout(() => camera.off('data', on_photo), 2000)
}

module.exports = { takePhoto }
