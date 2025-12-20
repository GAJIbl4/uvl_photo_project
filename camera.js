'use strict'

const child = require('node:child_process')
const SplitFrames = require('split-frames')

const JPEG_START = Buffer.from('\xff\xd8', 'binary')
const JPEG_END = Buffer.from('\xff\xd9', 'binary')
const cameraEn = process.env.CAMERA_EN === 'true'

function Libcameravid(options = {}, errorCb) {
  if (!cameraEn) {
    errorCb(new Error('Camera not enabled'))
    return { pipe: ()=>{} }
  }

  const args = ['--nopreview']

  for (const key in options) {
    args.push('--' + key)
    const val = options[key]
    if (val || val === 0) {
      args.push(val)
    }
  }

  args.push('-o')
  args.push('-')

  const video_process = child.spawn('libcamera-vid', args, {
    stdio: ['ignore', 'pipe', 'inherit']
  })
  
  // Сохраняем ссылку на процесс для возможности его остановки
  if (typeof module !== 'undefined' && module.exports) {
    // Экспортируем функцию для получения процесса, если нужно
    video_process.stdout._process = video_process
  }
  
  if (errorCb) {
    video_process.on('error', errorCb)
    video_process.on('exit', (code, signal) => {
      if (code !== 0 && code !== null) {
        errorCb(new Error(`libcamera process quit with code ${code}`))
      }
    })
  }

  return video_process.stdout
}

function LibcameravidJPEGStream(options = {}, errorCb) {
  const cameraTimeout = +(process.env.CAMERA_TIMEOUT || 0)
  const defaultFramerate = +(process.env.CAMERA_FRAMERATE || 10)
  
  const libcameraOptions = {
    width: options.width || 640,
    height: options.height || 480,
    timeout: cameraTimeout,
    framerate: options.framerate !== undefined ? options.framerate : defaultFramerate,
    codec: 'MJPEG',
  }
  
  // Добавляем настройки экспозиции, если они указаны
  if (options.shutter !== undefined && options.shutter > 0) {
    libcameraOptions.shutter = options.shutter
  }
  if (options.gain !== undefined && options.gain > 0) {
    libcameraOptions.gain = options.gain
  }
  if (options.exposure) {
    libcameraOptions.exposure = options.exposure
  }
  if (options.metering) {
    libcameraOptions.metering = options.metering
  }
  if (options.awb) {
    libcameraOptions.awb = options.awb
  }
  if (options.brightness !== undefined) {
    libcameraOptions.brightness = options.brightness
  }
  if (options.contrast !== undefined) {
    libcameraOptions.contrast = options.contrast
  }
  if (options.saturation !== undefined) {
    libcameraOptions.saturation = options.saturation
  }
  if (options.sharpness !== undefined) {
    libcameraOptions.sharpness = options.sharpness
  }
  
  return Libcameravid(libcameraOptions, errorCb).pipe(new SplitFrames({
    startWith: JPEG_START,
    endWith: JPEG_END
  }))
}

module.exports = {
  Libcameravid,
  LibcameravidJPEGStream,
}
