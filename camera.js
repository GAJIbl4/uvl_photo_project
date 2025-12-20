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
  if (errorCb) {
    video_process.on('error', errorCb)
    video_process.on('exit', () => errorCb(new Error('libcamera process quit')))
  }

  return video_process.stdout
}

function LibcameravidJPEGStream(options = {}, errorCb) {
  const cameraTimeout = +(process.env.CAMERA_TIMEOUT || 0)
  const cameraFramerate = +(process.env.CAMERA_FRAMERATE || 10)
  
  return Libcameravid({
    width: options.width || 640,
    height: options.height || 480,
    timeout: cameraTimeout,
    framerate: cameraFramerate,
    ...options,
    codec: 'MJPEG',
  }, errorCb).pipe(new SplitFrames({
    startWith: JPEG_START,
    endWith: JPEG_END
  }))
}

module.exports = {
  Libcameravid,
  LibcameravidJPEGStream,
}
