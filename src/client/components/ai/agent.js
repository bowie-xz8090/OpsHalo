function updateChatEntry (chatEntry, updates) {
  const index = window.store.aiChatHistory.findIndex(i => i.id === chatEntry.id)
  if (index !== -1) {
    Object.assign(window.store.aiChatHistory[index], updates)
    window.store.aiChatHistory = [...window.store.aiChatHistory]
  }
}

export async function runAgentLoop (chatEntry, config, abortRef, setIsStreaming) {
  setIsStreaming(true)
  try {
    if (abortRef?.current) return
    const response = await window.store.startAgentSession({
      schemaVersion: 1,
      clientRequestId: `chat_${crypto.randomUUID()}`,
      tabId: window.store.activeTabId,
      prompt: chatEntry.prompt,
      mode: 'diagnose',
      conversationId: chatEntry.id,
      uiLocale: config.languageAI || 'zh-CN'
    })
    updateChatEntry(chatEntry, {
      response: `任务已切换到当前终端的安全 Agent 面板执行（任务 ${response.taskId}）。中间探查、审批和最终结论会显示在光标下方。`
    })
  } catch (error) {
    updateChatEntry(chatEntry, { response: `**Error:** ${error.message}` })
  } finally {
    setIsStreaming(false)
  }
}
