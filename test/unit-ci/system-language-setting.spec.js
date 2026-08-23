const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

test('system language remains visible at the top of common settings', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../src/client/components/setting-panel/setting-common.jsx'), 'utf8')
  const renderStart = source.indexOf("<h2>{e('settings')}</h2>")
  const languageControl = source.indexOf("<span className='inline-title mg1r'>{e('language')}</span>", renderStart)
  const proxySettings = source.indexOf('{this.renderProxy()}', renderStart)

  assert.notEqual(renderStart, -1)
  assert.notEqual(languageControl, -1)
  assert.notEqual(proxySettings, -1)
  assert.equal(languageControl < proxySettings, true)
  assert.equal(source.match(/\{e\('language'\)\}<\/span>/g)?.length, 1)
  assert.match(source, /onChange=\{this\.handleChangeLang\}/)
})
