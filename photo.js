'use strict'

const { LibcameravidJPEGStream } = require('./camera')
const { writeFileSync, mkdirSync, readdirSync, unlinkSync, statSync, existsSync } = require('node:fs')
const { join } = require('node:path')
const piexifjs = require('piexifjs')

let photoWidth = +(process.env.PHOTO_WIDTH || 2028)
let photoHeight = +(process.env.PHOTO_HEIGHT || 1520)
let photoExifOrientation = +(process.env.PHOTO_EXIF_ORIENTATION || 6)
// for rotation values see http://www.cipa.jp/std/documents/e/DC-008-2012_E.pdf

let photoSaveEnabled = process.env.PHOTO_SAVE_ENABLED === 'true'
let photoSaveDir = process.env.PHOTO_SAVE_DIR || './photos'

// Создаём директорию для сохранения фотографий, если включено сохранение
if (photoSaveEnabled) {
  try {
    mkdirSync(photoSaveDir, { recursive: true })
  } catch (err) {
    console.log('[photo]: Failed to create photo directory:', err.message)
  }
}

let cameraError = false
let camera = null

const initCamera = () => {
  if (camera) {
    // Удаляем старую камеру, если она была
    try {
      camera.removeAllListeners()
      if (camera.destroy) camera.destroy()
    } catch (err) {
      console.log('[photo]: Error cleaning up old camera:', err.message)
    }
  }
  
  camera = new LibcameravidJPEGStream({
    width: photoWidth,
    height: photoHeight,
  }, err => {
    cameraError = err
    if (err) console.log('[photo]: Camera error:', err.message)
  })
  
  camera.once?.('data', data => null)
}

initCamera()

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
  if (!camera) {
    callback(id, new Error('Camera not initialized'))
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

const getCameraSettings = () => ({
  width: photoWidth,
  height: photoHeight,
  exifOrientation: photoExifOrientation,
  saveEnabled: photoSaveEnabled,
  saveDir: photoSaveDir
})

const updateCameraSettings = (settings) => {
  if (settings.width !== undefined) photoWidth = +settings.width
  if (settings.height !== undefined) photoHeight = +settings.height
  if (settings.exifOrientation !== undefined) photoExifOrientation = +settings.exifOrientation
  if (settings.saveEnabled !== undefined) photoSaveEnabled = settings.saveEnabled === true || settings.saveEnabled === 'true'
  if (settings.saveDir !== undefined) photoSaveDir = settings.saveDir
  
  // Обновляем переменные окружения для совместимости
  process.env.PHOTO_WIDTH = String(photoWidth)
  process.env.PHOTO_HEIGHT = String(photoHeight)
  process.env.PHOTO_EXIF_ORIENTATION = String(photoExifOrientation)
  process.env.PHOTO_SAVE_ENABLED = String(photoSaveEnabled)
  process.env.PHOTO_SAVE_DIR = photoSaveDir
  
  // Создаём директорию, если включено сохранение
  if (photoSaveEnabled) {
    try {
      mkdirSync(photoSaveDir, { recursive: true })
    } catch (err) {
      console.log('[photo]: Failed to create photo directory:', err.message)
    }
  }
  
  return getCameraSettings()
}

const reloadCamera = () => {
  console.log('[photo]: Reloading camera with new settings...')
  initCamera()
  return getCameraSettings()
}

const getPhotoList = () => {
  if (!photoSaveEnabled || !existsSync(photoSaveDir)) {
    return []
  }
  try {
    const files = readdirSync(photoSaveDir)
    return files
      .filter(f => f.endsWith('.jpg'))
      .map(f => {
        const filepath = join(photoSaveDir, f)
        const stats = statSync(filepath)
        return {
          filename: f,
          path: filepath,
          size: stats.size,
          mtime: stats.mtime.getTime()
        }
      })
      .sort((a, b) => b.mtime - a.mtime) // Сортировка по времени изменения (новые первыми)
  } catch (err) {
    console.log('[photo]: Failed to read photo directory:', err.message)
    return []
  }
}

const deleteAllPhotos = () => {
  if (!photoSaveEnabled || !existsSync(photoSaveDir)) {
    return { deleted: 0, error: 'Photo saving is disabled or directory does not exist' }
  }
  try {
    const files = readdirSync(photoSaveDir)
    let deleted = 0
    files.forEach(f => {
      if (f.endsWith('.jpg')) {
        try {
          unlinkSync(join(photoSaveDir, f))
          deleted++
        } catch (err) {
          console.log(`[photo]: Failed to delete ${f}:`, err.message)
        }
      }
    })
    return { deleted, error: null }
  } catch (err) {
    console.log('[photo]: Failed to delete photos:', err.message)
    return { deleted: 0, error: err.message }
  }
}

module.exports = { 
  takePhoto, 
  getCameraSettings, 
  updateCameraSettings, 
  reloadCamera,
  getPhotoList,
  deleteAllPhotos
}
