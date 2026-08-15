class EvidenceCleaner {
  constructor (store, intervalMs = 60 * 60 * 1000) {
    this.store = store
    this.intervalMs = intervalMs
    this.timer = null
  }

  start () {
    if (this.timer) return
    this.timer = setInterval(() => this.store.cleanup(), this.intervalMs)
    if (this.timer.unref) this.timer.unref()
  }

  stop () {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }
}

module.exports = { EvidenceCleaner }
