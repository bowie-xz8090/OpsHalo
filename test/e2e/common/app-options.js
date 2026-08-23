const { resolve } = require('path')
const cwd = process.cwd()
const e2eDataPath = process.env.OPSHALO_E2E_DATA_PATH || resolve(cwd, '.opshalo-e2e-data')

module.exports = {
  env: {
    ...process.env,
    NODE_TEST: 'yes',
    DATA_PATH: e2eDataPath
  },
  args: [
    resolve(cwd, 'work/app'),
    '--disable-gpu',
    '--disable-dev-shm-usage'
  ]
}
