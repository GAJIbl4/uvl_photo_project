'use strict'

const { LibcameravidJPEGStream } = require('./camera')
const { writeFileSync, mkdirSync, readdirSync, unlinkSync, statSync, existsSync, readFileSync } = require('node:fs')
const { join } = require('node:path')
const piexifjs = require('piexifjs')
const { execSync, spawn } = require('child_process')

let photoWidth = +(process.env.PHOTO_WIDTH || 2028)
let photoHeight = +(process.env.PHOTO_HEIGHT || 1520)
let photoExifOrientation = +(process.env.PHOTO_EXIF_ORIENTATION || 6)
// for rotation values see http://www.cipa.jp/std/documents/e/DC-008-2012_E.pdf

let photoSaveEnabled = process.env.PHOTO_SAVE_ENABLED === 'true'
let photoSaveDir = process.env.PHOTO_SAVE_DIR || './photos'
let cameraFramerate = +(process.env.CAMERA_FRAMERATE || 10)

// Допустимые разрешения для камеры Raspberry Pi (стандартные значения)
// Высокие разрешения (3280x2464 и выше) могут требовать увеличения gpu_mem в config.txt
// и могут не работать на всех моделях Raspberry Pi
const VALID_RESOLUTIONS = [
  { width: 640, height: 480, label: '640x480 (VGA)', recommended: true },
  { width: 800, height: 600, label: '800x600 (SVGA)', recommended: true },
  { width: 1024, height: 768, label: '1024x768 (XGA)', recommended: true },
  { width: 1280, height: 720, label: '1280x720 (HD)', recommended: true },
  { width: 1280, height: 960, label: '1280x960', recommended: true },
  { width: 1600, height: 1200, label: '1600x1200 (UXGA)', recommended: true },
  { width: 1920, height: 1080, label: '1920x1080 (Full HD)', recommended: true },
  { width: 2028, height: 1520, label: '2028x1520 (2MP)', recommended: true },
  { width: 2592, height: 1944, label: '2592x1944 (5MP)', recommended: false, warning: 'Может требовать увеличения gpu_mem' },
  { width: 3280, height: 2464, label: '3280x2464 (8MP)', recommended: false, warning: 'Требует увеличения gpu_mem в config.txt' },
  { width: 4056, height: 3040, label: '4056x3040 (12MP) - экспериментальное', recommended: false, warning: 'Может не работать из-за нехватки памяти' },
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
  
  // Проверяем предупреждения для высоких разрешений
  if (found.warning) {
    return { valid: true, warning: found.warning }
  }
  
  // Предупреждение для очень высоких разрешений (может не хватить памяти)
  if (w * h > 10000000) { // Больше 10MP
    return { valid: true, warning: 'Высокое разрешение может не работать из-за нехватки памяти GPU. Увеличьте gpu_mem в /boot/config.txt' }
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

// Остановка всех процессов libcamera-vid
const killLibcameraProcesses = () => {
  try {
    // Находим и убиваем все процессы libcamera-vid
    execSync('pkill -f "libcamera-vid" || true', { timeout: 2000 })
    // Небольшая задержка для завершения процессов
    return new Promise(resolve => setTimeout(resolve, 500))
  } catch (err) {
    // Игнорируем ошибки, если процессов нет
    return Promise.resolve()
  }
}

const initCamera = async () => {
  // Сначала останавливаем старые процессы libcamera-vid
  await killLibcameraProcesses()
  
  if (camera) {
    // Удаляем старую камеру, если она была
    try {
      camera.removeAllListeners()
      if (camera.destroy) camera.destroy()
      camera = null
    } catch (err) {
      console.log('[photo]: Error cleaning up old camera:', err.message)
    }
  }
  
  // Сбрасываем ошибку перед инициализацией
  cameraError = false
  
  camera = new LibcameravidJPEGStream({
    width: photoWidth,
    height: photoHeight,
    framerate: cameraFramerate,
  }, err => {
    cameraError = err
    if (err) {
      console.log('[photo]: Camera error:', err.message)
      // Если ошибка связана с памятью, предлагаем снизить разрешение
      if (err.message && (err.message.includes('memory') || err.message.includes('allocate') || err.message.includes('buffer') || err.message.includes('failed to start'))) {
        console.log('[photo]: Возможно, не хватает памяти для данного разрешения. Попробуйте снизить разрешение или увеличить gpu_mem в /boot/config.txt')
      }
    }
  })
  
  camera.once?.('data', data => null)
  
  // Проверяем ошибку через небольшую задержку
  setTimeout(() => {
    if (cameraError) {
      console.log(`[photo]: Не удалось запустить камеру с разрешением ${photoWidth}x${photoHeight}. Ошибка: ${cameraError.message}`)
    }
  }, 1000)
}

// Инициализируем камеру при загрузке модуля (асинхронно, чтобы не блокировать)
setTimeout(() => {
  initCamera().catch(err => {
    console.log('[photo]: Failed to initialize camera on startup:', err.message)
  })
}, 1000)

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
  
  // Сохраняем настройки в .env файл
  try {
    saveSettingsToEnv()
  } catch (err) {
    warnings.push(`Не удалось сохранить настройки в .env файл: ${err.message}`)
  }
  
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

// Сохранение настроек в .env файл
const saveSettingsToEnv = () => {
  const envPath = join(process.cwd(), '.env')
  let envContent = ''
  
  // Читаем существующий .env файл, если он есть
  if (existsSync(envPath)) {
    envContent = readFileSync(envPath, 'utf8')
  }
  
  // Обновляем или добавляем настройки камеры
  const cameraSettings = {
    'PHOTO_WIDTH': String(photoWidth),
    'PHOTO_HEIGHT': String(photoHeight),
    'PHOTO_EXIF_ORIENTATION': String(photoExifOrientation),
    'PHOTO_SAVE_ENABLED': String(photoSaveEnabled),
    'PHOTO_SAVE_DIR': photoSaveDir,
    'CAMERA_FRAMERATE': String(cameraFramerate)
  }
  
  // Разбиваем на строки и обновляем нужные
  const lines = envContent.split('\n')
  const updatedLines = []
  const updatedKeys = new Set()
  
  for (const line of lines) {
    const trimmed = line.trim()
    // Пропускаем пустые строки и комментарии
    if (!trimmed || trimmed.startsWith('#')) {
      updatedLines.push(line)
      continue
    }
    
    // Проверяем, есть ли в строке настройка камеры
    let found = false
    for (const [key, value] of Object.entries(cameraSettings)) {
      if (trimmed.startsWith(key + '=')) {
        updatedLines.push(`${key}=${value}`)
        updatedKeys.add(key)
        found = true
        break
      }
    }
    
    if (!found) {
      updatedLines.push(line)
    }
  }
  
  // Добавляем настройки, которых не было в файле
  for (const [key, value] of Object.entries(cameraSettings)) {
    if (!updatedKeys.has(key)) {
      updatedLines.push(`${key}=${value}`)
    }
  }
  
  // Сохраняем обратно
  writeFileSync(envPath, updatedLines.join('\n') + '\n', 'utf8')
  console.log('[photo]: Settings saved to .env file')
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
  
  // Останавливаем старую камеру и процессы libcamera-vid
  return new Promise(async (resolve) => {
    try {
      // Останавливаем все процессы libcamera-vid
      await killLibcameraProcesses()
      
      if (camera) {
        try {
          camera.removeAllListeners()
          if (camera.destroy) camera.destroy()
          camera = null
        } catch (err) {
          console.log('[photo]: Error cleaning up old camera:', err.message)
        }
      }
      
      // Дополнительная задержка для полного освобождения ресурсов
      await new Promise(r => setTimeout(r, 500))
      
      // Инициализируем новую камеру
      await initCamera()
      
      // Проверяем успешность запуска через 1.5 секунды
      setTimeout(() => {
        if (cameraError) {
          const errorMsg = cameraError.message || 'Неизвестная ошибка'
          console.log('[photo]: Failed to reload camera:', errorMsg)
          
          // Если ошибка связана с памятью, предлагаем решение
          let userError = errorMsg
          if (errorMsg.includes('memory') || errorMsg.includes('allocate') || errorMsg.includes('buffer') || errorMsg.includes('failed to start')) {
            userError = `Не удалось запустить камеру с разрешением ${photoWidth}x${photoHeight}. Не хватает памяти GPU. Попробуйте: 1) Снизить разрешение до 2592x1944 или ниже, 2) Увеличить gpu_mem в /boot/config.txt (например, gpu_mem=128 или gpu_mem=256), затем перезагрузить Raspberry Pi`
          }
          
          resolve({
            success: false,
            error: userError,
            settings: getCameraSettings()
          })
        } else {
          console.log('[photo]: Camera reloaded successfully')
          resolve({
            success: true,
            settings: getCameraSettings(),
            warnings: [
              resolutionValidation.warning,
              fpsValidation.warning
            ].filter(Boolean)
          })
        }
      }, 1500)
    } catch (err) {
      console.log('[photo]: Failed to reload camera:', err.message)
      cameraError = err
      resolve({
        success: false,
        error: err.message,
        settings: getCameraSettings()
      })
    }
  })
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
