/**
 * Mini edition pack slim helpers.
 * Drop unused native modules / build junk that UI feature-gate cannot remove.
 */

const { rm, echo } = require('shelljs')
const { resolve } = require('path')
const fs = require('fs')

/** Backend deps Mini edition does not need at runtime */
const MINI_EXCLUDE_DEPS = [
  // ~17MB native; SSH/SFTP Mini 不需要串口
  'serialport'
]

function applyMiniDepExcludes (pack) {
  for (const name of MINI_EXCLUDE_DEPS) {
    if (pack.dependencies && pack.dependencies[name]) {
      echo(`[mini-slim] drop dependency ${name}`)
      delete pack.dependencies[name]
    }
  }
  return pack
}

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
  // Keep Release/*.node|dll|exe and bin/, drop other Release clutter when safe
  const release = resolve(root, 'build/Release')
  if (fs.existsSync(release)) {
    for (const name of fs.readdirSync(release)) {
      const full = resolve(release, name)
      const keep = /\.(node|dll|exe)$/i.test(name) || name === 'obj'
      if (!keep && fs.statSync(full).isFile()) {
        // keep .node/.dll/.exe only
        if (!/\.(node|dll|exe)$/i.test(name)) {
          rm('-rf', full)
        }
      }
      if (name === 'obj' || name.endsWith('.tlog')) {
        rm('-rf', full)
      }
    }
  }
}

/** Remove Mini-unused frontend chunks / wasm after vite build */
function slimFrontendAssets (assetsDir = 'work/app/assets') {
  if (!fs.existsSync(assetsDir)) {
    return
  }
  echo('[mini-slim] removing unused frontend assets')
  const kill = [
    `${assetsDir}/assets/rdp_client_bg*.wasm`,
    `${assetsDir}/assets/rdp_client*.js`,
    `${assetsDir}/chunk/rfb-*`,
    `${assetsDir}/chunk/*vnc*`,
    `${assetsDir}/chunk/*rdp*`,
    `${assetsDir}/chunk/*spice*`,
    `${assetsDir}/chunk/*novnc*`
  ]
  for (const p of kill) {
    rm('-rf', p)
  }
}

/** Extra cleanup after yarn autoclean */
function slimInstalledModules (nm = 'work/app/node_modules') {
  if (!fs.existsSync(nm)) {
    return
  }
  echo('[mini-slim] removing excluded / heavy leftovers')
  const extra = [
    `${nm}/serialport`,
    `${nm}/@serialport`,
    `${nm}/cpu-features`,
    `${nm}/@types`
  ]
  for (const p of extra) {
    rm('-rf', p)
  }
  slimNodePty(`${nm}/node-pty`)
}

module.exports = {
  MINI_EXCLUDE_DEPS,
  applyMiniDepExcludes,
  slimNodePty,
  slimFrontendAssets,
  slimInstalledModules
}
