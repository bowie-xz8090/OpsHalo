/**
 * preload
 */

const { ipcRenderer, contextBridge, webFrame, webUtils } = require('electron')

async function invokeAgent (channel, request) {
  const response = await ipcRenderer.invoke(channel, request)
  if (!response?.ok) {
    const error = new Error(response?.error?.safeMessage || 'Agent request failed')
    Object.assign(error, response?.error || {})
    throw error
  }
  return response.data
}

contextBridge.exposeInMainWorld(
  'api', {
    getZoomFactor: () => webFrame.getZoomFactor(),
    setZoomFactor: (nl) => webFrame.setZoomFactor(nl),
    getPathForFile: (file) => {
      try {
        return webUtils.getPathForFile(file)
      } catch (error) {
        console.warn('webUtils.getPathForFile failed:', error)
        return null
      }
    },
    openDialog: (opts) => {
      return ipcRenderer.invoke('show-open-dialog-sync', opts)
    },
    saveDialog: (opts) => {
      return ipcRenderer.invoke('show-save-dialog', opts)
    },
    ipcOnEvent: (event, cb) => {
      ipcRenderer.on(event, cb)
    },
    ipcOffEvent: (event, cb) => {
      ipcRenderer.removeListener(event, cb)
    },
    runGlobalAsync: (name, ...args) => {
      return ipcRenderer.invoke('async', {
        name,
        args
      })
    },
    runSync: (name, ...args) => {
      return ipcRenderer.sendSync('sync-func', {
        name,
        args
      })
    },
    sendMcpResponse: (response) => {
      ipcRenderer.send('mcp-response', response)
    },
    agent: {
      start: request => invokeAgent('agent:start', request),
      control: request => invokeAgent('agent:control', request),
      getSnapshot: request => invokeAgent('agent:get-snapshot', request),
      getEvidence: request => invokeAgent('agent:get-evidence', request),
      deleteEvidence: request => invokeAgent('agent:delete-evidence', request),
      onEvent: (callback) => {
        const handler = (event, payload) => callback(payload)
        ipcRenderer.on('agent:event', handler)
        return () => ipcRenderer.removeListener('agent:event', handler)
      }
    },
    codex: {
      listAccounts: request => invokeAgent('codex:list-accounts', request || { schemaVersion: 1 }),
      startLogin: request => invokeAgent('codex:start-login', request),
      cancelLogin: request => invokeAgent('codex:cancel-login', request),
      refreshAccount: request => invokeAgent('codex:refresh-account', request),
      selectAccount: request => invokeAgent('codex:select-account', request),
      logout: request => invokeAgent('codex:logout', request),
      removeAccount: request => invokeAgent('codex:remove-account', request),
      onEvent: callback => {
        const handler = (event, payload) => callback(payload)
        ipcRenderer.on('codex:account-event', handler)
        return () => ipcRenderer.removeListener('codex:account-event', handler)
      }
    },
    onWebviewAuthRequest: (cb) => {
      const handler = (event, data) => cb(data)
      ipcRenderer.on('webview-auth-request', handler)
      return () => ipcRenderer.removeListener('webview-auth-request', handler)
    },
    sendWebviewAuthResponse: (response) => {
      ipcRenderer.send('webview-auth-response', response)
    }
  }
)
