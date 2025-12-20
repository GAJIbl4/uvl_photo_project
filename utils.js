'use strict'

const { CancelablePromise }  = require('cancelable-promise')
const fs = require('node:fs')
const path = require('node:path')

const log = (arg, ...args) => (!log.off && console.log(arg, ...args), arg)

const parseJson = data => {
  try {
    return JSON.parse(data)
  } catch {
    return data
  }
}

const paseUrl = urlStr => {
  if (Buffer.isBuffer(urlStr))
    urlStr = urlStr.toString('utf-8')
  const url = new URL(urlStr)
  const params = Object.fromEntries(url.searchParams)
  for (const k in params)
    params[k] = parseJson(params[k])
  return [url.pathname, params, url]
}

function is(x, y) {
  if (x === y) {
    return x !== 0 || y !== 0 || 1 / x === 1 / y
  } else {
    return x !== x && y !== y
  }
}

function shallowEqual(objA, objB) {
  if (is(objA, objB))
    return true

  if (
    typeof objA !== 'object' ||
    objA === null ||
    typeof objB !== 'object' ||
    objB === null
  ) return false

  const keysA = Object.keys(objA)
  const keysB = Object.keys(objB)

  if (keysA.length !== keysB.length)
    return false

  for (let i = 0; i < keysA.length; i++) {
    if (
      !Object.prototype.hasOwnProperty.call(objB, keysA[i]) ||
      !is(objA[keysA[i]], objB[keysA[i]])
    ) return false
  }

  return true
}

function shallowEqualAll(all1, all2) {
  if (!Array.isArray(all1) || !Array.isArray(all2) || all1.length !== all2.length)
    return false
  for (let i = 0; i < all1.length; i++)
    if (!shallowEqual(all1[i], all2[i]))
      return false
  return true
}

const once = (
  emitter,
  event,
  check,
  transform,
) => {
  const simple = !check && !transform
  if (simple) {
    return new CancelablePromise((resolve, reject, onCancel) => {
      emitter.once(event, resolve)
      onCancel(() => {
        emitter.off(event, resolve)
        reject()
      })
    })
  }
  else {
    return new CancelablePromise((resolve, reject, onCancel) => {
      const listen = (...args) => {
        if (!check || check(...args)) {
          emitter.off('error', reject)
          resolve(transform ? transform(...args) : args[0])
        }
        else emitter.once(event, listen)
      }
      emitter.once(event, listen)
      emitter.once('error', reject)
      onCancel(() => {
        emitter.off(event, listen)
        emitter.off('error', reject)
      })
    })
  }
}

const subscribe_once = (emitter, event, func) => {
  emitter.once(event, func)
  return () => emitter.off(event, func)
}

const subscribe_one = (emitter, event, func) => {
  emitter.on(event, func)
  return () => emitter.off(event, func)
}

const subscribe = (
  emitter,
  event, func,
  ...morelisteners
) => {
  if (!morelisteners.length)
    return subscribe_one(emitter, event, func)
  const unsubbers = [subscribe_one(emitter, event, func)]
  for (let i = 0; morelisteners[i + 1]; i += 2)
    unsubbers.push(subscribe_one(emitter, morelisteners[i], morelisteners[i + 1]))
  return () => unsubbers.forEach(call)
}

function repeatRetryUntilTimeout(repeat, until, timeout = Infinity, retryLimit = Infinity, currentLimit = 0) {
  if (currentLimit >= retryLimit) return Promise.reject(new Error(
    `repeatRetryUntilTimeout hit retry limit of ${currentLimit} out of ${retryLimit} in:\n\trepeat ${repeat}\n\tuntil ${until}`
  ))
  return new Promise((resolve, reject) => {
    if (repeat) {
      try {
        const repeated = repeat()
        if (repeated instanceof Promise)
          repeated.catch(reject)
      } catch (e) {
        reject(e)
      }
    }
    const untilPromise = until()
    untilPromise.then(resolve).catch(reject)
    if (timeout !== Infinity) setTimeout(() => {
      if (untilPromise.cancel)
        untilPromise.cancel()
      reject()
    }, timeout)
  }).catch(reason => {
    if (reason instanceof Error)
      throw reason
    else
      return repeatRetryUntilTimeout(repeat, until, timeout, retryLimit, currentLimit + 1)
  })
}

const debounce = (
  func,
  ms,
  trailing = false
) => {
  let onTimeout = false
  let trailingArgs = null
  const handleTimeout = () => {
    onTimeout = false
    if (trailing && trailingArgs)
      func(...trailingArgs)
    trailingArgs = null
  }
  const debounced = (...args) => {
    if (onTimeout) {
      if (trailing)
        trailingArgs = args
    }
    else {
      onTimeout = true
      setTimeout(handleTimeout, ms)
      return func(...args)
    }
  }
  return debounced
}

const unbitmap_k = (value, bitmap) => Object.fromEntries(
  Object.entries(bitmap).filter(v => value & +v[0])
)
const unbitmap_v = (value, bitmap) => Object.fromEntries(
  Object.entries(bitmap).filter(v => value & +v[1])
)

const toFixed = presc => (strings, ...values) => {
  let str = String(strings[0])
  for (let i = 0; i < values.length; i++) {
    const val = values[i].toFixed(presc)
    str += (val.startsWith('-') ? "" : " ") + val + strings[i + 1]
  }
  return str
}

const ansi = (value, ...codes) => {
  let str = ''
  const escs = codes.map(v => `\x1b[${v}m`)
  if (escs.length === 1)
    escs.push('\x1b[0m')
  const n = escs.length - 1
  for (let i = 0; i < n; i++)
    str += escs[0]
  str += value + escs[n]
  return str
}

const paramsJoin = (...paramsObjs) => {
  const params = Object.assign({}, ...paramsObjs)
  const paramsStr = []
  const pushURIComponent = (key, val) => paramsStr.push(
    encodeURIComponent(key) + '=' + encodeURIComponent(JSON.stringify(val)))
  for (const key in params)
    if (params[key] === undefined)
      continue
    else if (params[key] instanceof Error)
      pushURIComponent(key, params[key].stack)
    else
      pushURIComponent(key, params[key])
  return paramsStr.join('&')
}

async function getFiles(dir, acc = []) {
  const dirents = await fs.promises.readdir(dir, { withFileTypes: true })
  await Promise.all(dirents.map(dirent => {
    const name = path.join(dir, dirent.name)
    if (dirent.isDirectory())
      return getFiles(name, acc)
    else
      acc.push(name)
  }))
  return acc
}

const fsExists = filename => {
  try {
    fs.statSync(filename)
    return true
  } catch (err) {
    return false
  }
}

module.exports = {
  log,
  parseJson,
  paseUrl,
  shallowEqual,
  shallowEqualAll,
  once,
  subscribe,
  subscribe_once,
  repeatRetryUntilTimeout,
  debounce,
  unbitmap_k,
  unbitmap_v,
  toFixed,
  ansi,
  paramsJoin,
  getFiles,
  fsExists,
}