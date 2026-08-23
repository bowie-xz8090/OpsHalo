/** Packaging helpers for native runtime modules. */

const { rm, echo } = require('shelljs')
const { resolve } = require('path')
const fs = require('fs')

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
  slimNodePty(`${nm}/node-pty`)
}

module.exports = {
  slimNodePty,
  slimInstalledModules
}
