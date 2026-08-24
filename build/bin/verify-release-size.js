const fs = require('fs')
const path = require('path')

const MIB = 1024 * 1024
const LIMITS = Object.freeze({
  windowsInstaller: 100 * MIB,
  macDmg: 130 * MIB,
  linuxPackage: 130 * MIB,
  tarball: 160 * MIB
})

function classifyArtifact (name) {
  if (/installer\.exe$/i.test(name)) return ['Windows installer', LIMITS.windowsInstaller]
  if (/\.dmg$/i.test(name)) return ['macOS DMG', LIMITS.macDmg]
  if (/\.(?:deb|rpm|AppImage)$/i.test(name)) return ['Linux package', LIMITS.linuxPackage]
  if (/\.tar\.gz$/i.test(name)) return ['compressed tarball', LIMITS.tarball]
  return undefined
}

function verifyReleaseSizes (artifactRoot) {
  const files = walkFiles(artifactRoot)
  const checked = []
  const violations = []
  for (const file of files) {
    const classification = classifyArtifact(path.basename(file))
    if (!classification) continue
    const [type, limit] = classification
    const bytes = fs.statSync(file).size
    checked.push({ file, type, bytes, limit })
    if (bytes >= limit) violations.push(`${path.basename(file)}: ${formatMiB(bytes)} >= ${formatMiB(limit)}`)
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
  checked.forEach(item => console.log(`${item.type}: ${path.basename(item.file)} ${formatMiB(item.bytes)} < ${formatMiB(item.limit)}`))
}

module.exports = { LIMITS, classifyArtifact, verifyReleaseSizes, formatMiB }
