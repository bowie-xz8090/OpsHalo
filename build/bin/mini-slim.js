/** Packaging helpers for native runtime modules. */

const { rm, echo } = require('shelljs')
const { resolve } = require('path')
const fs = require('fs')

const NON_RUNTIME_DIRECTORIES = new Set([
  '__tests__', 'test', 'tests', 'docs', 'doc', 'example', 'examples',
  'coverage', '.nyc_output', 'bench', 'benchmarks', 'fixtures'
])

/** Remove node-pty compile intermediates; keep only runtime binaries */
function slimNodePty (root = 'work/app/node_modules/node-pty') {
  if (!fs.existsSync(root)) {
    return
  }
  echo('[mini-slim] cleaning node-pty build junk')
  const patterns = [
    `${root}/build/**/*.iobj`,
    `${root}/build/**/*.ipdb`,
    `${root}/build/**/*.tlog`,
    `${root}/build/**/*.pdb`,
    `${root}/build/**/obj`,
    `${root}/src`,
    `${root}/deps`,
    `${root}/scripts`,
    `${root}/typings`,
    `${root}/lib/*.test.js`,
    `${root}/lib/*.test.js.map`,
    `${root}/binding.gyp`,
    `${root}/*.md`
  ]
  for (const p of patterns) {
    rm('-rf', p)
  }
  // node-pty resolves the extensionless spawn-helper at runtime on Unix.
  const release = resolve(root, 'build/Release')
  if (fs.existsSync(release)) {
    for (const name of fs.readdirSync(release)) {
      const full = resolve(release, name)
      const keep = /\.(node|dll|exe)$/i.test(name) || name === 'spawn-helper'
      if (!keep && fs.statSync(full).isFile()) {
        rm('-rf', full)
      }
      if (name === 'obj' || name.endsWith('.tlog')) {
        rm('-rf', full)
      }
    }
  }
}

/** Extra cleanup after yarn autoclean */
function slimInstalledModules (nm = 'work/app/node_modules') {
  if (!fs.existsSync(nm)) {
    return
  }
  echo('[mini-slim] removing packaging-only leftovers')
  const extra = [
    `${nm}/cpu-features`,
    `${nm}/@types`
  ]
  for (const p of extra) {
    rm('-rf', p)
  }
  removeNonRuntimePackageFiles(nm)
  removeCommonJsRuntimeAlternates(nm)
  slimCommonJsCryptoRuntime(nm)
  slimZodLocales(nm)
  slimNodePty(`${nm}/node-pty`)
}

function removeCommonJsRuntimeAlternates (nm) {
  const paths = [
    'pako/dist',
    '@electerm/electerm-locales/dist/esm',
    '@electerm/electerm-themes/dist/index.mjs',
    '@electerm/electerm-themes/dist/themes',
    '@noble/ciphers/esm',
    '@noble/curves/esm',
    '@noble/curves/node_modules/@noble/hashes/esm',
    '@noble/hashes/esm',
    '@noble/hashes/src',
    '@xterm/headless/lib-headless/xterm-headless.mjs',
    '@xterm/headless/lib-headless/xterm-headless.mjs.map',
    'sm-crypto-v2/dist/index.mjs',
    'sm-crypto-v2/dist/index.umd.js',
    'sm-crypto-v2/miniprogram_dist',
    'sm-crypto-v2/node_modules/@noble/hashes/esm',
    'tar/dist/esm',
    'trzsz2/dist/browser',
    'trzsz2/dist/esm',
    'zod/index.js',
    'zod/locales',
    'zod/mini',
    'zod/v3',
    'zod/v4-mini',
    'zod/v4/mini'
  ]
  for (const relative of paths) fs.rmSync(resolve(nm, relative), { recursive: true, force: true })
  removeUnusedFontListEntries(nm)
  removeMatchingFiles(resolve(nm, 'zod/v4'), name => name.endsWith('.js'))
  echo('[mini-slim] removed unused ESM/browser alternates from CommonJS main-process dependencies')
}

function slimCommonJsCryptoRuntime (nm) {
  keepJavaScriptFiles(resolve(nm, '@noble/ciphers'), new Set([
    '_polyval.js',
    'utils.js'
  ]))
  keepJavaScriptFiles(resolve(nm, '@noble/curves'), new Set([
    'utils.js',
    'abstract/curve.js',
    'abstract/modular.js',
    'abstract/utils.js',
    'abstract/weierstrass.js'
  ]))
  for (const root of [
    resolve(nm, '@noble/curves/node_modules/@noble/hashes'),
    resolve(nm, 'sm-crypto-v2/node_modules/@noble/hashes')
  ]) {
    keepJavaScriptFiles(root, new Set(['cryptoNode.js', 'hkdf.js', 'hmac.js', 'utils.js']))
  }
  keepJavaScriptFiles(resolve(nm, 'tweetnacl'), new Set(['nacl-fast.js']))
  echo('[mini-slim] kept only the CommonJS crypto files loaded by SSH SM2 and TweetNaCl')
}

function slimZodLocales (nm) {
  const localeImport = 'exports.locales = __importStar(require("../locales/index.cjs"));'
  const importers = [
    resolve(nm, 'zod/v4/classic/external.cjs'),
    resolve(nm, 'zod/v4/core/index.cjs')
  ]
  if (!fs.existsSync(importers[0])) return
  for (const importer of importers) {
    const source = fs.readFileSync(importer, 'utf8')
    const replacement = 'exports.locales = Object.freeze({});'
    if (!source.includes(localeImport) && !source.includes(replacement)) {
      throw new Error(`Unsupported Zod runtime layout: eager locale import was not found in ${importer}`)
    }
    fs.writeFileSync(importer, source.replace(localeImport, replacement))
  }
  const locales = resolve(nm, 'zod/v4/locales')
  removeMatchingFiles(locales, name => name.endsWith('.cjs') && name !== 'en.cjs')
  echo('[mini-slim] kept the default English Zod locale without eagerly packaging unused translations')
}

function keepJavaScriptFiles (root, keep) {
  if (!fs.existsSync(root)) return
  function visit (current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = resolve(current, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') continue
        visit(absolute)
        continue
      }
      if (!entry.isFile() || !/\.[cm]?js$/i.test(entry.name)) continue
      const relative = require('path').relative(root, absolute).split(require('path').sep).join('/')
      if (!keep.has(relative)) fs.rmSync(absolute, { force: true })
    }
  }
  visit(root)
}

function removeUnusedFontListEntries (nm) {
  const fontList = resolve(nm, 'font-list')
  fs.rmSync(resolve(fontList, 'demo.js'), { force: true })
  const currentPlatform = process.platform
  for (const platform of ['darwin', 'linux', 'win32']) {
    if (platform !== currentPlatform) fs.rmSync(resolve(fontList, 'libs', platform), { recursive: true, force: true })
  }
  fs.rmSync(resolve(fontList, 'libs', 'darwin', 'fontlist.m'), { force: true })
}

function removeMatchingFiles (root, predicate) {
  let entries = []
  try { entries = fs.readdirSync(root, { withFileTypes: true }) } catch (_) { return }
  for (const entry of entries) {
    const absolute = resolve(root, entry.name)
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) removeMatchingFiles(absolute, predicate)
    else if (entry.isFile() && predicate(entry.name)) fs.rmSync(absolute, { force: true })
  }
}

function removeNonRuntimePackageFiles (root) {
  let removedFiles = 0
  let removedDirectories = 0
  function visit (current) {
    let entries = []
    try { entries = fs.readdirSync(current, { withFileTypes: true }) } catch (_) { return }
    for (const entry of entries) {
      const absolute = resolve(current, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        if (NON_RUNTIME_DIRECTORIES.has(entry.name)) {
          fs.rmSync(absolute, { recursive: true, force: true })
          removedDirectories++
        } else {
          visit(absolute)
        }
        continue
      }
      if (!entry.isFile() || !isNonRuntimePackageFile(entry.name)) continue
      fs.rmSync(absolute, { force: true })
      removedFiles++
    }
  }
  visit(root)
  echo(`[mini-slim] removed ${removedFiles} metadata files and ${removedDirectories} non-runtime directories`)
  return { removedFiles, removedDirectories }
}

function isNonRuntimePackageFile (name) {
  if (/^(?:licen[cs]e|copying|notice)(?:\.|$)/i.test(name)) return false
  return /(?:\.d\.(?:ts|cts|mts)|\.(?:[cm]?js|ts|css)\.map|\.md)$/i.test(name)
}

module.exports = {
  slimNodePty,
  slimInstalledModules,
  removeNonRuntimePackageFiles,
  removeCommonJsRuntimeAlternates,
  slimCommonJsCryptoRuntime,
  slimZodLocales,
  keepJavaScriptFiles,
  removeUnusedFontListEntries,
  isNonRuntimePackageFile,
  NON_RUNTIME_DIRECTORIES
}
