'use strict'

const { readFileSync } = require('node:fs')
const crypto = require('node:crypto')
const keys = require('./keys.json')
const pack = require('./package.json')

let sn = 'unknown'
let lk = 'none'
let vf = 0
let vt = Infinity
let pv = pack.version

try {
  sn = readFileSync('/sys/firmware/devicetree/base/serial-number', 'utf-8').trim().replace('\0', '')
} catch (err) {}

if (require.main === module) {
  vf = +(process.argv[2] || Infinity)
  vt = +(process.argv[3] || 0)
  if (process.argv[4]) {
    sn = process.argv[4].trim()
  }
  const nk = crypto.createHmac('sha256', keys.sc)
    .update(String(vf))
    .update(String(vt))
    .update(sn)
    .digest('hex')
  console.log(`${pv}:${nk}:${vf}:${vt}`)
  console.error({ lk:nk, vt, vf, sn, sc: keys.sc, pv })
} else {
  let lkd = 'nofile'
  try {
    lkd = readFileSync(JSON.parse('"\\u002e\\u002f\\u004c\\u0049\\u0043\\u0045\\u004e\\u0053\\u0045\\u005f\\u004b\\u0045\\u0059"'), 'utf-8').trim()
    ;([pv, lk, vf, vt] = lkd.split(':'));
    vf = +vf
    vt = +vt
  } catch (err) {}
  const hex = crypto.createHmac('sha256', keys.sc)
    .update(String(vf))
    .update(String(vt))
    .update(sn)
    .digest('hex')
  
  const exp = vt <= Date.now()
  const ntr = vf >= Date.now()
  const ok = !!(sn && lk && lk === hex)
  const sw = ok && !exp && !ntr
  module.exports = { ok, vt, vf, exp, ntr, sw }
}