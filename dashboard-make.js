'use strict'

const fs = require('node:fs/promises')
const path = require('node:path')
const { getFiles } = require('./utils')

let babel
const transpile = (code, filename) => {
  if (!babel) babel = require('@babel/core')
  return babel.transform(code, { filename, ...config }).code
}

const config = {
  'plugins': [
    ['@babel/plugin-transform-react-jsx', {
      'pragma': 'preact.h',
      'pragmaFrag': 'preact.Fragment'
    }]
  ],
  generatorOpts: {
    retainLines: true,
    compact: false,
    minified: false,
    comments: true,
  }
}
const handleENOENT = err => {
  if (err.code === 'ENOENT')
    return { mtimeMs: -Infinity }
  else
    throw err
}

const jsxRegex = /\.(tsx?|jsx)?$/

async function needsRemake(fin) {
  const fout = fin.replace(jsxRegex, '.js')
  const [fin_stat, fout_stat] = await Promise.all([
    fs.stat(fin),
    fs.stat(fout).catch(handleENOENT)
  ])
  return [fin_stat.mtimeMs > fout_stat.mtimeMs, fout, fin]
}

async function buildSource(fin, fout) {
  const code_in = await fs.readFile(fin, 'utf8')
  const code_out = transpile(code_in, fin)
  await fs.writeFile(fout, code_out)
}

async function build() {
  const files = await getFiles('./dashboard-public')
  for (const file of files) {
    if (!jsxRegex.test(file)) continue
    const [remake, fileOut] = await needsRemake(file)
    if (!remake) continue
    await buildSource(file, fileOut)
    console.log('[dashboard-make]:', file)
  }
}

build().catch(console.log)