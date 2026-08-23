const path = require('path')

const immutableCacheControl = 'public, max-age=31536000, immutable'
const revalidateCacheControl = 'no-cache'

function cacheControlForAsset (filePath, testMode = false) {
  if (testMode) return 'no-store'
  const normalizedPath = String(filePath || '').split(path.sep).join('/')
  return /\/chunk\/[^/]+-[A-Za-z0-9_-]{8}\.(?:css|js)$/.test(normalizedPath)
    ? immutableCacheControl
    : revalidateCacheControl
}

module.exports = (app) => {
  const express = require('express')
  const { isTest } = require('../common/runtime-constants')

  return new Promise((resolve) => {
    const assetsPath = path.resolve(__dirname, '../assets')
    const conf = {
      cacheControl: false,
      etag: !isTest,
      lastModified: !isTest,
      maxAge: 0,
      setHeaders: (res, filePath) => {
        res.setHeader('Cache-Control', cacheControlForAsset(filePath, isTest))
      }
    }

    // Handle _temp_*.css files - return empty CSS to prevent MIME type errors
    app.use((req, res, next) => {
      if (req.url.startsWith('/css/_temp_') && req.url.endsWith('.css')) {
        res.setHeader('Content-Type', 'text/css')
        res.send('')
        return
      }
      next()
    })

    app.use(
      express.static(assetsPath, conf)
    )
  })
}

module.exports.cacheControlForAsset = cacheControlForAsset
