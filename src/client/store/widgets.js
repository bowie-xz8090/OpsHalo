/**
 * widgets related functions
 */

import deepCopy from 'json-deep-copy'

export default Store => {
  Store.prototype.runWidget = async (widgetId, config) => {
    // If this is MCP server widget, initialize MCP handler first
    if (widgetId === 'mcp-server') {
      window.store.initMcpHandler()
    }
    return window.pre.runGlobalAsync('runWidget', widgetId, config)
  }

  Store.prototype.runWidgetFunc = async (instanceId, funcName, ...args) => {
    return window.pre.runGlobalAsync('runWidgetFunc', instanceId, funcName, ...args)
  }

  Store.prototype.startAutoRunWidgets = async function () {
    const { store } = window
    const items = (store.autoRunWidgets || []).filter(item => item.widgetId === 'mcp-server')
    if (!items || !items.length) {
      return
    }
    for (const item of items) {
      try {
        const result = await store.runWidget(item.widgetId, deepCopy(item.config))
        if (result && result.instanceId) {
          const instance = {
            id: result.instanceId,
            title: `${result.widgetId} (${result.instanceId})`,
            widgetId: result.widgetId,
            serverInfo: result.serverInfo,
            config: item.config,
            autoRun: true,
            autoRunId: item.id
          }
          store.widgetInstances.push(instance)
        }
      } catch (err) {
        console.error(`Failed to autorun widget ${item.widgetId}:`, err)
      }
    }
  }
}
