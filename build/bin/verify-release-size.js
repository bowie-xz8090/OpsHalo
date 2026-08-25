const fs = require('fs')
const path = require('path')

const MIB = 1024 * 1024
const LIMITS = Object.freeze({
  windowsInstaller: 90 * MIB,
  windowsTarball: 120 * MIB,
  macDmg: 95 * MIB,
  linuxPackage: 85 * MIB,
  linuxTarball: 105 * MIB
})

function classifyArtifact (name) {
  if (/-win-[^-]+-installer\.exe$/i.test(name)) return ['Windows installer', LIMITS.windowsInstaller, true]
  if (/-win-[^.]+\.tar\.gz$/i.test(name)) return ['Windows tarball', LIMITS.windowsTarball, false]
  if (/-mac-[^.]+\.dmg$/i.test(name)) return ['macOS DMG', LIMITS.macDmg, false]
  if (/-linux-[^.]+\.(?:deb|rpm|AppImage)$/i.test(name)) return ['Linux package', LIMITS.linuxPackage, false]
  if (/-linux-[^.]+\.tar\.gz$/i.test(name)) return ['Linux tarball', LIMITS.linuxTarball, false]
  return undefined
}

function verifyReleaseSizes (artifactRoot) {
  const files = walkFiles(artifactRoot)
  const checked = []
  const violations = []
  for (const file of files) {
    const classification = classifyArtifact(path.basename(file))
    if (!classification) continue
    const [type, limit, inclusive] = classification
    const bytes = fs.statSync(file).size
    checked.push({ file, type, bytes, limit, inclusive })
    if (inclusive ? bytes > limit : bytes >= limit) {
      violations.push(`${path.basename(file)}: ${formatMiB(bytes)} ${inclusive ? '>' : '>='} ${formatMiB(limit)}`)
    }
  }
  if (!checked.length) throw new Error(`No release artifacts found in ${artifactRoot}`)
  if (violations.length) throw new Error(`Release size gate failed:\n${violations.join('\n')}`)
  return checked
}

function walkFiles (root) {
  const stat = fs.statSync(root)
  if (stat.isFile()) return [root]
  const files = []
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name)
    if (entry.isDirectory()) files.push(...walkFiles(absolute))
    else if (entry.isFile()) files.push(absolute)
  }
  return files
}

function formatMiB (bytes) {
  return `${(bytes / MIB).toFixed(1)} MiB`
}

if (require.main === module) {
  const root = path.resolve(process.argv[2] || path.join(__dirname, '../../dist'))
  const checked = verifyReleaseSizes(root)
  checked.forEach(item => console.log(`${item.type}: ${path.basename(item.file)} ${formatMiB(item.bytes)} ${item.inclusive ? '<=' : '<'} ${formatMiB(item.limit)}`))
}

module.exports = { LIMITS, classifyArtifact, verifyReleaseSizes, formatMiB }
