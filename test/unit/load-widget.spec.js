const { test } = require('node:test')
const assert = require('node:assert/strict')
const { listWidgets, runWidget } = require('../../src/app/widgets/load-widget')

test('Mini exposes only the externally consumed MCP server widget', () => {
  assert.deepEqual(listWidgets().map(widget => widget.id), ['mcp-server'])
})

test('removed legacy widget ids are rejected without touching saved data', () => {
  for (const id of ['local-file-server', 'local-ftp-server', 'batch-op', 'rename']) {
    assert.throws(() => runWidget(id, {}), /Invalid widget ID/)
  }
})
