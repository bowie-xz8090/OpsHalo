const fs = require('fs')
const { resolve } = require('path')
const { cp, mkdir, echo } = require('shelljs')

const imgsGlob = resolve(
  __dirname,
  '../../node_modules/@electerm/electerm-resource/res/imgs/*'
)
const trayDir = resolve(
  __dirname,
  '../../node_modules/@electerm/electerm-resource/tray-icons'
)
const iconsFrom = resolve(
  __dirname,
  '../../node_modules/electerm-icons/icons'
)
const imagesTo = resolve(
  __dirname,
  '../../work/app/assets/images/'
)
const iconsTo = resolve(
  __dirname,
  '../../work/app/assets/icons'
)

mkdir('-p', imagesTo)
cp(imgsGlob, imagesTo)

// Newer @electerm/electerm-resource may omit tray-icons; fall back to app icon.
if (fs.existsSync(trayDir)) {
  cp(resolve(trayDir, '*'), imagesTo)
} else {
  echo('[copy] tray-icons missing in electerm-resource, using electerm-round as tray')
  const round = resolve(imagesTo, 'electerm-round-128x128.png')
  const tray = resolve(imagesTo, 'electerm-tray.png')
  if (fs.existsSync(round)) {
    cp(round, tray)
  }
}

if (fs.existsSync(iconsFrom)) {
  cp('-r', iconsFrom, iconsTo)
}
