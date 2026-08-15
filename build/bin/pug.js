// build html
/**
 * build common files with react module in it
 */
const fs = require('fs')
const pug = require('pug')
const { resolve } = require('path')
const pack = require('../../package.json')
const deepCopy = require('json-deep-copy')

const entryPug = resolve(
  __dirname,
  '../../src/client/views/index.pug'
)
const targetFilePath = resolve(
  __dirname,
  '../../work/app/assets/index.html'
)
const targetPackagePath = resolve(
  __dirname,
  '../../work/app/package.json'
)
const pugContent = fs.readFileSync(entryPug, 'utf-8')
const defaultAIPreset = null

// const AIDisclamer = 'AI-generated terminal commands can be inaccurate or unsafe, be careful'

const data = {
  version: pack.version,
  siteName: pack.productName || pack.name,
  isDev: false,
  defaultAIPreset
}
const htmlContent = pug.render(pugContent, {
  filename: entryPug,
  ...data,
  _global: deepCopy(data)
})
fs.writeFileSync(targetFilePath, htmlContent, 'utf8')

// The renderer boot script reads the runtime package version before loading
// opshalo-<version>.js. Keep an existing test/staging app in sync so a normal
// `npm run compile` cannot silently load the previous versioned bundle.
if (fs.existsSync(targetPackagePath)) {
  const targetPackage = JSON.parse(fs.readFileSync(targetPackagePath, 'utf8'))
  targetPackage.version = pack.version
  fs.writeFileSync(targetPackagePath, JSON.stringify(targetPackage, null, 2))
}
