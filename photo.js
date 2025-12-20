'use strict'

const { LibcameravidJPEGStream } = require('./camera')
const { writeFileSync, mkdirSync, readdirSync, unlinkSync, statSync, existsSync } = require('node:fs')
const { join } = require('node:path')
const piexifjs = require('piexifjs')
const { execSync } = require('child_process')

let photoWidth = +(process.env.PHOTO_WIDTH || 2028)
let photoHeight = +(process.env.PHOTO_HEIGHT || 1520)
let photoExifOrientation = +(process.env.PHOTO_EXIF_ORIENTATION || 6)
// for rotation values see http://www.cipa.jp/std/documents/e/DC-008-2012_E.pdf

let photoSaveEnabled = process.env.PHOTO_SAVE_ENABLED === 'true'
let photoSaveDir = process.env.PHOTO_SAVE_DIR || './photos'
let cameraFramerate = +(process.env.CAMERA_FRAMERATE || 10)

// Допустимые разрешения для камеры Raspberry Pi (стандартные значения)
const VALID_RESOLUTIONS = [
  { width: 640, height: 480, label: '640x480 (VGA)' },
  { width: 800, height: 600, label: '800x600 (SVGA)' },
  { width: 1024, height: 768, label: '1024x768 (XGA)' },
  { width: 1280, height: 720, label: '1280x720 (HD)' },
  { width: 1280, height: 960, label: '1280x960' },
  { width: 1600, height: 1200, label: '1600x1200 (UXGA)' },
  { width: 1920, height: 1080, label: '1920x1080 (Full HD)' },
  { width: 2028, height: 1520, label: '2028x1520 (2MP)' },
  { width: 2592, height: 1944, label: '2592x1944 (5MP)' },
  { width: 3280, height: 2464, label: '3280x2464 (8MP)' },
  { width: 4056, height: 3040, label: '4056x3040 (12MP)' },
]

// Допустимые значения FPS
const VALID_FPS = [1, 2, 5, 10, 15, 20, 25, 30, 60]

// Валидация разрешения
const validateResolution = (width, height) => {
  const w = +width
  const h = +height
  if (!w || !h || w < 64 || h < 64 || w > 5000 || h > 5000) {
    return { valid: false, error: 'Недопустимое разрешение. Ширина и высота должны быть от 64 до 5000' }
  }
  
  // Проверяем, есть ли такое разрешение в списке допустимых
  const found = VALID_RESOLUTIONS.find(r => r.width === w && r.height === h)
  if (!found) {
    // Разрешаем произвольные разрешения, но предупреждаем
    return { valid: true, warning: 'Разрешение не в списке стандартных. Может не поддерживаться камерой.' }
  }
  
  return { valid: true }
}

// Валидация FPS
const validateFPS = (fps) => {
  const f = +fps
  if (!f || f < 1 || f > 120) {
    return { valid: false, error: 'FPS должен быть от 1 до 120' }
  }
  
  if (!VALID_FPS.includes(f)) {
    return { valid: true, warning: 'FPS не в списке стандартных. Может не поддерживаться камерой.' }
  }
  
  return { valid: true }
}

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
    framerate: cameraFramerate,
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
  saveDir: photoSaveDir,
  framerate: cameraFramerate
})

const getValidResolutions = () => VALID_RESOLUTIONS

const getValidFPS = () => VALID_FPS

const updateCameraSettings = (settings) => {
  const errors = []
  const warnings = []
  
  // Валидация разрешения
  if (settings.width !== undefined || settings.height !== undefined) {
    const width = settings.width !== undefined ? +settings.width : photoWidth
    const height = settings.height !== undefined ? +settings.height : photoHeight
    const validation = validateResolution(width, height)
    if (!validation.valid) {
      errors.push(validation.error)
    } else if (validation.warning) {
      warnings.push(validation.warning)
    } else {
      if (settings.width !== undefined) photoWidth = width
      if (settings.height !== undefined) photoHeight = height
    }
  }
  
  // Валидация FPS
  if (settings.framerate !== undefined) {
    const validation = validateFPS(settings.framerate)
    if (!validation.valid) {
      errors.push(validation.error)
    } else if (validation.warning) {
      warnings.push(validation.warning)
    } else {
      cameraFramerate = +settings.framerate
    }
  }
  
  // Валидация EXIF ориентации (1-8)
  if (settings.exifOrientation !== undefined) {
    const orientation = +settings.exifOrientation
    if (orientation < 1 || orientation > 8) {
      errors.push('EXIF ориентация должна быть от 1 до 8')
    } else {
      photoExifOrientation = orientation
    }
  }
  
  if (settings.saveEnabled !== undefined) {
    photoSaveEnabled = settings.saveEnabled === true || settings.saveEnabled === 'true'
  }
  
  if (settings.saveDir !== undefined) {
    if (settings.saveDir.trim() === '') {
      errors.push('Директория сохранения не может быть пустой')
    } else {
      photoSaveDir = settings.saveDir.trim()
    }
  }
  
  if (errors.length > 0) {
    return { 
      success: false, 
      errors, 
      warnings,
      settings: getCameraSettings() 
    }
  }
  
  // Обновляем переменные окружения для совместимости
  process.env.PHOTO_WIDTH = String(photoWidth)
  process.env.PHOTO_HEIGHT = String(photoHeight)
  process.env.PHOTO_EXIF_ORIENTATION = String(photoExifOrientation)
  process.env.PHOTO_SAVE_ENABLED = String(photoSaveEnabled)
  process.env.PHOTO_SAVE_DIR = photoSaveDir
  process.env.CAMERA_FRAMERATE = String(cameraFramerate)
  
  // Создаём директорию, если включено сохранение
  if (photoSaveEnabled) {
    try {
      mkdirSync(photoSaveDir, { recursive: true })
    } catch (err) {
      errors.push(`Не удалось создать директорию: ${err.message}`)
      return { success: false, errors, warnings, settings: getCameraSettings() }
    }
  }
  
  return { 
    success: true, 
    errors: [], 
    warnings,
    settings: getCameraSettings() 
  }
}

const reloadCamera = () => {
  // Валидация перед перезагрузкой
  const resolutionValidation = validateResolution(photoWidth, photoHeight)
  const fpsValidation = validateFPS(cameraFramerate)
  
  if (!resolutionValidation.valid) {
    return {
      success: false,
      error: resolutionValidation.error,
      settings: getCameraSettings()
    }
  }
  
  if (!fpsValidation.valid) {
    return {
      success: false,
      error: fpsValidation.error,
      settings: getCameraSettings()
    }
  }
  
  console.log('[photo]: Reloading camera with new settings...')
  console.log(`[photo]: Resolution: ${photoWidth}x${photoHeight}, FPS: ${cameraFramerate}`)
  
  // Останавливаем старую камеру
  if (camera) {
    try {
      camera.removeAllListeners()
      // Пытаемся убить процесс, если это возможно
      if (camera._readableState && camera._readableState.pipes) {
        const pipes = camera._readableState.pipes
        if (Array.isArray(pipes)) {
          pipes.forEach(pipe => {
            if (pipe && pipe.destroy) pipe.destroy()
          })
        }
      }
    } catch (err) {
      console.log('[photo]: Error cleaning up old camera:', err.message)
    }
  }
  
  // Небольшая задержка перед перезапуском
  setTimeout(() => {
    try {
      initCamera()
      console.log('[photo]: Camera reloaded successfully')
    } catch (err) {
      console.log('[photo]: Failed to reload camera:', err.message)
      cameraError = err
    }
  }, 500)
  
  return {
    success: true,
    settings: getCameraSettings(),
    warnings: [
      resolutionValidation.warning,
      fpsValidation.warning
    ].filter(Boolean)
  }
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
  deleteAllPhotos,
  getValidResolutions,
  getValidFPS,
  validateResolution,
  validateFPS
}
