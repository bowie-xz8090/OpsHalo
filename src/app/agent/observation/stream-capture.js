const crypto = require('crypto')
const { defaults } = require('../config')

function boundedCapture (input, options = {}) {
  const maxBytes = options.maxBytes || defaults.maxRawCaptureBytes
  const headBytes = options.headBytes || defaults.captureHeadBytes
  const tailBytes = options.tailBytes || defaults.captureTailBytes
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(String(input || ''), 'utf8')
  const totalBytes = buffer.length
  const binary = binaryRatio(buffer) > 0.15
  const keepLimit = Math.min(maxBytes, defaults.maxCaptureMemoryBytes)
  const kept = totalBytes <= keepLimit
    ? buffer
    : Buffer.concat([
      buffer.subarray(0, Math.min(headBytes, buffer.length)),
      buffer.subarray(Math.max(Math.min(headBytes, buffer.length), buffer.length - tailBytes))
    ])
  return {
    text: binary ? '' : kept.toString('utf8'),
    binary,
    totalBytes,
    capturedBytes: kept.length,
    omittedBytes: Math.max(0, totalBytes - kept.length),
    truncated: kept.length < totalBytes,
    sha256: crypto.createHash('sha256').update(buffer).digest('hex')
  }
}

function binaryRatio (buffer) {
  if (!buffer.length) return 0
  let binary = 0
  const sample = buffer.subarray(0, Math.min(buffer.length, 64 * 1024))
  for (const byte of sample) {
    if (byte === 0 || (byte < 9 || (byte > 13 && byte < 32))) binary++
  }
  return binary / sample.length
}

module.exports = { boundedCapture, binaryRatio }
