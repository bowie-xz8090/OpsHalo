/**
 * Whether the AI feature is disabled globally.
 *
 * Set `window.et.disableAIFeature = true` before the application bundle runs
 * to hide every AI-related button / icon / setting menu in the UI.
 */
export const isAIDisabled = () => {
  return !!(window.et && window.et.disableAIFeature)
}
