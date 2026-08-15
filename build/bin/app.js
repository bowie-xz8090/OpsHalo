const { exec } = require('shelljs')
const os = require('os')
const path = require('path')
const platform = os.platform()
console.log('platform:', platform)
// Isolate dev data from installed electerm (shared AppData + safeStorage mismatch)
const dataPath = path.resolve(__dirname, '../../.opshalo-dev-data')
const cmd = platform.startsWith('win')
  ? `node_modules\\.bin\\cross-env NODE_ENV=development DATA_PATH="${dataPath}" node_modules\\.bin\\electron  -r dotenv/config src\\app\\app`
  : `node_modules/.bin/cross-env NODE_ENV=development DATA_PATH="${dataPath}" node_modules/.bin/electron -r dotenv/config src/app/app`
exec(cmd)
