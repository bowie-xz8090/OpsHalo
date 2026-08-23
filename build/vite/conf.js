import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { cwd, version } from './common.js'
import { resolve } from 'path'
import def from './def.js'

function buildInput () {
  return {
    opshalo: resolve(cwd, '../../src/client/entry/opshalo.jsx'),
    basic: resolve(cwd, '../../src/client/entry/basic.js'),
    worker: resolve(cwd, '../../src/client/entry/worker.js')
  }
}

function replaceWebAppPlugin () {
  return {
    name: 'replace-webapp',
    renderChunk (code) {
      const newCode = code.replace(/window\.et\.isWebApp/g, 'false')
      if (newCode !== code) {
        return { code: newCode, map: null }
      }
      return null
    }
  }
}

export default defineConfig({
  plugins: [
    react({ include: /\.(mdx|js|jsx|ts|tsx|mjs)$/ }),
    replaceWebAppPlugin()
  ],
  resolve: {
    alias: {
      'node:diagnostics_channel': resolve(cwd, './diagnostics-channel-stub.js'),
      diagnostics_channel: resolve(cwd, './diagnostics-channel-stub.js')
    }
  },
  define: def,
  publicDir: false,
  legacy: {
    inconsistentCjsInterop: true
  },
  root: resolve(cwd, '../..'),
  build: {
    target: 'esnext',
    cssCodeSplit: false,
    codeSplitting: false,
    emptyOutDir: true,
    outDir: resolve(cwd, '../../work/app/assets'),
    rollupOptions: {
      input: buildInput(),
      output: {
        format: 'esm',
        entryFileNames: `js/[name]-${version}.js`,
        chunkFileNames: `chunk/[name]-${version}-[hash].js`,
        dir: resolve(cwd, '../../work/app/assets'),
        assetFileNames: chunkInfo => {
          const { name } = chunkInfo
          if (/\.(png|jpe?g|gif|svg|webp|ico|bmp)$/i.test(name)) {
            return `images/${name}`
          } else if (name && name.endsWith('.css')) {
            return `css/style-${version}[extname]`
          } else {
            return 'assets/[name]-[hash][extname]'
          }
        }
      }
    }
  }
})
