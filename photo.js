'use strict'

const { LibcameravidJPEGStream } = require('./camera')
const { writeFileSync, mkdirSync } = require('node:fs')
const { join } = require('node:path')
const piexifjs = require('piexifjs')

const photoWidth = +(process.env.PHOTO_WIDTH || 2028)
const photoHeight = +(process.env.PHOTO_HEIGHT || 1520)
const photoExifOrientation = +(process.env.PHOTO_EXIF_ORIENTATION || 6)
// for rotation values see http://www.cipa.jp/std/documents/e/DC-008-2012_E.pdf

const photoSaveEnabled = process.env.PHOTO_SAVE_ENABLED === 'true'
const photoSaveDir = process.env.PHOTO_SAVE_DIR || './photos'

// Создаём директорию для сохранения фотографий, если включено сохранение
if (photoSaveEnabled) {
  try {
    mkdirSync(photoSaveDir, { recursive: true })
  } catch (err) {
    console.log('[photo]: Failed to create photo directory:', err.message)
  }
}

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
      const rotatedData = exifRotate(data, photoExifOrientation)
      
      // Сохранение на диск, если включено
      if (photoSaveEnabled) {
        try {
          const filename = `${id}.jpg`
          const filepath = join(photoSaveDir, filename)
          writeFileSync(filepath, rotatedData)
          console.log(`[photo]: Saved to ${filepath}`)
        } catch (err) {
          console.log(`[photo]: Failed to save file ${id}:`, err.message)
        }
      }
      
      callback?.(id, rotatedData)
    } catch (err) {
      console.log('failed saving', id)
      console.log(err)
    }
  }
  camera.once('data', on_photo)
  setTimeout(() => camera.off('data', on_photo), 2000)
}

module.exports = { takePhoto }
