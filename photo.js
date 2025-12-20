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

// Режимы камеры Raspberry Pi HQ Mini (комбинации разрешения и FPS)
// Эти режимы предустановлены производителем и гарантированно работают
const CAMERA_MODES = [
  { width: 2028, height: 1520, framerate: 10, label: '2028x1520 @ 10fps (стандартный)', recommended: true },
  { width: 2028, height: 1080, framerate: 30, label: '2028x1080 @ 30fps', recommended: true },
  { width: 1332, height: 990, framerate: 40, label: '1332x990 @ 40fps', recommended: true },
  { width: 640, height: 480, framerate: 120, label: '640x480 @ 120fps', recommended: true },
  { width: 2028, height: 1520, framerate: 15, label: '2028x1520 @ 15fps', recommended: false },
  { width: 2028, height: 1520, framerate: 20, label: '2028x1520 @ 20fps', recommended: false },
  { width: 2028, height: 1080, framerate: 25, label: '2028x1080 @ 25fps', recommended: false },
  { width: 2028, height: 1080, framerate: 50, label: '2028x1080 @ 50fps', recommended: false },
  { width: 1332, height: 990, framerate: 50, label: '1332x990 @ 50fps', recommended: false },
  { width: 640, height: 480, framerate: 60, label: '640x480 @ 60fps', recommended: false },
]

// Настройки экспозиции и фотографирования
let cameraShutter = +(process.env.CAMERA_SHUTTER || 0) // Выдержка в микросекундах (0 = автоматическая)
let cameraGain = +(process.env.CAMERA_GAIN || 0) // Усиление (gain) (0 = автоматическая)
let cameraExposure = process.env.CAMERA_EXPOSURE || 'normal' // normal, short, long
let cameraMetering = process.env.CAMERA_METERING || 'centre' // centre, spot, matrix, custom
let cameraAwb = process.env.CAMERA_AWB || 'auto' // auto, incandescent, tungsten, fluorescent, indoor, daylight, cloudy, custom
let cameraBrightness = +(process.env.CAMERA_BRIGHTNESS || 0) // Яркость (-1.0 до 1.0)
let cameraContrast = +(process.env.CAMERA_CONTRAST || 1.0) // Контраст (0.0 до 2.0)
let cameraSaturation = +(process.env.CAMERA_SATURATION || 1.0) // Насыщенность (0.0 до 2.0)
let cameraSharpness = +(process.env.CAMERA_SHARPNESS || 1.0) // Резкость (0.0 до 2.0)

// Допустимые значения для настроек
const EXPOSURE_MODES = ['normal', 'short', 'long']
const METERING_MODES = ['centre', 'spot', 'matrix', 'custom']
const AWB_MODES = ['auto', 'incandescent', 'tungsten', 'fluorescent', 'indoor', 'daylight', 'cloudy', 'custom']

// Валидация режима камеры (комбинация разрешения и FPS)
const validateCameraMode = (width, height, framerate) => {
  const w = +width
  const h = +height
  const fps = +framerate
  
  if (!w || !h || w < 64 || h < 64 || w > 5000 || h > 5000) {
    return { valid: false, error: 'Недопустимое разрешение. Ширина и высота должны быть от 64 до 5000' }
  }
  
  if (!fps || fps < 1 || fps > 120) {
    return { valid: false, error: 'FPS должен быть от 1 до 120' }
  }
  
  // Проверяем, есть ли такой режим в списке допустимых
  const found = CAMERA_MODES.find(m => m.width === w && m.height === h && m.framerate === fps)
  if (!found) {
    return { valid: true, warning: 'Режим не в списке стандартных. Может не поддерживаться камерой.' }
  }
  
  // Проверяем предупреждения для режимов
  if (found.warning) {
    return { valid: true, warning: found.warning }
  }
  
  return { valid: true }
}

// Валидация выдержки (в микросекундах, 0 = автоматическая)
const validateShutter = (shutter) => {
  const s = +shutter
  if (s < 0 || s > 100000000) { // Максимум 100 секунд
    return { valid: false, error: 'Выдержка должна быть от 0 (авто) до 100000000 микросекунд' }
  }
  return { valid: true }
}

// Валидация усиления (gain, 0 = автоматическая)
const validateGain = (gain) => {
  const g = +gain
  if (g < 0 || g > 16) {
    return { valid: false, error: 'Gain должен быть от 0 (авто) до 16' }
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
    shutter: cameraShutter || undefined,
    gain: cameraGain || undefined,
    exposure: cameraExposure !== 'normal' ? cameraExposure : undefined,
    metering: cameraMetering !== 'centre' ? cameraMetering : undefined,
    awb: cameraAwb !== 'auto' ? cameraAwb : undefined,
    brightness: cameraBrightness !== 0 ? cameraBrightness : undefined,
    contrast: cameraContrast !== 1.0 ? cameraContrast : undefined,
    saturation: cameraSaturation !== 1.0 ? cameraSaturation : undefined,
    sharpness: cameraSharpness !== 1.0 ? cameraSharpness : undefined,
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

const getCameraModes = () => CAMERA_MODES

const getExposureModes = () => EXPOSURE_MODES
const getMeteringModes = () => METERING_MODES
const getAwbModes = () => AWB_MODES

const updateCameraSettings = (settings) => {
  const errors = []
  const warnings = []
  
  // Валидация режима камеры (если указан mode или width/height/framerate)
  if (settings.mode !== undefined) {
    // Режим задан как строка "2028x1520@10fps"
    const modeMatch = settings.mode.match(/(\d+)x(\d+)@(\d+)fps/)
    if (modeMatch) {
      const width = +modeMatch[1]
      const height = +modeMatch[2]
      const framerate = +modeMatch[3]
      const validation = validateCameraMode(width, height, framerate)
      if (!validation.valid) {
        errors.push(validation.error)
      } else {
        if (validation.warning) warnings.push(validation.warning)
        photoWidth = width
        photoHeight = height
        cameraFramerate = framerate
      }
    } else {
      errors.push('Неверный формат режима. Используйте формат: "2028x1520@10fps"')
    }
  } else if (settings.width !== undefined || settings.height !== undefined || settings.framerate !== undefined) {
    // Режим задан отдельными параметрами
    const width = settings.width !== undefined ? +settings.width : photoWidth
    const height = settings.height !== undefined ? +settings.height : photoHeight
    const framerate = settings.framerate !== undefined ? +settings.framerate : cameraFramerate
    const validation = validateCameraMode(width, height, framerate)
    if (!validation.valid) {
      errors.push(validation.error)
    } else {
      if (validation.warning) warnings.push(validation.warning)
      if (settings.width !== undefined) photoWidth = width
      if (settings.height !== undefined) photoHeight = height
      if (settings.framerate !== undefined) cameraFramerate = framerate
    }
  }
  
  // Валидация выдержки
  if (settings.shutter !== undefined) {
    const validation = validateShutter(settings.shutter)
    if (!validation.valid) {
      errors.push(validation.error)
    } else {
      cameraShutter = +settings.shutter
    }
  }
  
  // Валидация усиления (gain)
  if (settings.gain !== undefined) {
    const validation = validateGain(settings.gain)
    if (!validation.valid) {
      errors.push(validation.error)
    } else {
      cameraGain = +settings.gain
    }
  }
  
  // Валидация режима экспозиции
  if (settings.exposure !== undefined) {
    if (!EXPOSURE_MODES.includes(settings.exposure)) {
      errors.push(`Режим экспозиции должен быть одним из: ${EXPOSURE_MODES.join(', ')}`)
    } else {
      cameraExposure = settings.exposure
    }
  }
  
  // Валидация режима замера экспозиции
  if (settings.metering !== undefined) {
    if (!METERING_MODES.includes(settings.metering)) {
      errors.push(`Режим замера должен быть одним из: ${METERING_MODES.join(', ')}`)
    } else {
      cameraMetering = settings.metering
    }
  }
  
  // Валидация баланса белого
  if (settings.awb !== undefined) {
    if (!AWB_MODES.includes(settings.awb)) {
      errors.push(`Баланс белого должен быть одним из: ${AWB_MODES.join(', ')}`)
    } else {
      cameraAwb = settings.awb
    }
  }
  
  // Валидация яркости (-1.0 до 1.0)
  if (settings.brightness !== undefined) {
    const b = +settings.brightness
    if (b < -1.0 || b > 1.0) {
      errors.push('Яркость должна быть от -1.0 до 1.0')
    } else {
      cameraBrightness = b
    }
  }
  
  // Валидация контраста (0.0 до 2.0)
  if (settings.contrast !== undefined) {
    const c = +settings.contrast
    if (c < 0.0 || c > 2.0) {
      errors.push('Контраст должен быть от 0.0 до 2.0')
    } else {
      cameraContrast = c
    }
  }
  
  // Валидация насыщенности (0.0 до 2.0)
  if (settings.saturation !== undefined) {
    const s = +settings.saturation
    if (s < 0.0 || s > 2.0) {
      errors.push('Насыщенность должна быть от 0.0 до 2.0')
    } else {
      cameraSaturation = s
    }
  }
  
  // Валидация резкости (0.0 до 2.0)
  if (settings.sharpness !== undefined) {
    const s = +settings.sharpness
    if (s < 0.0 || s > 2.0) {
      errors.push('Резкость должна быть от 0.0 до 2.0')
    } else {
      cameraSharpness = s
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
  process.env.CAMERA_SHUTTER = String(cameraShutter)
  process.env.CAMERA_GAIN = String(cameraGain)
  process.env.CAMERA_EXPOSURE = cameraExposure
  process.env.CAMERA_METERING = cameraMetering
  process.env.CAMERA_AWB = cameraAwb
  process.env.CAMERA_BRIGHTNESS = String(cameraBrightness)
  process.env.CAMERA_CONTRAST = String(cameraContrast)
  process.env.CAMERA_SATURATION = String(cameraSaturation)
  process.env.CAMERA_SHARPNESS = String(cameraSharpness)
  
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
    'CAMERA_FRAMERATE': String(cameraFramerate),
    'CAMERA_SHUTTER': String(cameraShutter),
    'CAMERA_GAIN': String(cameraGain),
    'CAMERA_EXPOSURE': cameraExposure,
    'CAMERA_METERING': cameraMetering,
    'CAMERA_AWB': cameraAwb,
    'CAMERA_BRIGHTNESS': String(cameraBrightness),
    'CAMERA_CONTRAST': String(cameraContrast),
    'CAMERA_SATURATION': String(cameraSaturation),
    'CAMERA_SHARPNESS': String(cameraSharpness)
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
  const modeValidation = validateCameraMode(photoWidth, photoHeight, cameraFramerate)
  
  if (!modeValidation.valid) {
    return {
      success: false,
      error: modeValidation.error,
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
              modeValidation.warning
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
