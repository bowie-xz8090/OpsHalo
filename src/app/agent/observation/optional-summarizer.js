class OptionalSummarizer {
  constructor (handler) {
    this.handler = handler
  }

  async summarize (input, signal) {
    if (!this.handler) return null
    const result = await this.handler({
      instruction: 'Summarize only the supplied redacted data. Do not add facts or request tools.',
      data: input,
      tools: []
    }, signal)
    return typeof result === 'string' ? result.slice(0, 1200) : null
  }
}

module.exports = { OptionalSummarizer }
