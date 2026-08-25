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
  slimNodePty(`${nm}/node-pty`)
}

function removeCommonJsRuntimeAlternates (nm) {
  const paths = [
    'pako/dist',
    '@electerm/electerm-themes/dist/index.mjs',
    '@xterm/headless/lib-headless/xterm-headless.mjs',
    '@xterm/headless/lib-headless/xterm-headless.mjs.map',
    'zod/index.js',
    'zod/locales',
    'zod/mini',
    'zod/v3',
    'zod/v4-mini',
    'zod/v4/mini'
  ]
  for (const relative of paths) fs.rmSync(resolve(nm, relative), { recursive: true, force: true })
  removeMatchingFiles(resolve(nm, 'zod/v4'), name => name.endsWith('.js'))
  echo('[mini-slim] removed unused ESM/browser alternates from CommonJS main-process dependencies')
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
  isNonRuntimePackageFile,
  NON_RUNTIME_DIRECTORIES
}
