const CODEX_RUNTIME_VERSION = '0.147.0'
const REGISTRY_ROOT = 'https://registry.npmjs.org/@openai/codex/-'

const CODEX_RUNTIME_MANIFEST = Object.freeze({
  'darwin:arm64': runtimeEntry({
    suffix: 'darwin-arm64',
    integrity: 'sha512-BEUVkiOW7kLcRyrMLfAr/h9wF8sRVJyZDy6OHtVn6QGDXiv3BvAZVTY1Pu9xF7KdIdkYXbp4uayN0aDQQaAUJw==',
    packedBytes: 111199052,
    unpackedBytes: 274777843,
    triple: 'aarch64-apple-darwin',
    executableName: 'codex'
  }),
  'darwin:x64': runtimeEntry({
    suffix: 'darwin-x64',
    integrity: 'sha512-Tb8McE5SvJIH0Vs5R6sq7u+quiC931yan2KOOl6km1OdZ82+Wi7eF5XrSFPs5CF7xCgoIK4Vs+byMbT5hN+ZUw==',
    packedBytes: 118685907,
    unpackedBytes: 295757038,
    triple: 'x86_64-apple-darwin',
    executableName: 'codex'
  }),
  'linux:arm64': runtimeEntry({
    suffix: 'linux-arm64',
    integrity: 'sha512-SLC1JXw2TYfr/c3HhrJubyyLelq7vTOLWVmiThFA+z0+WgzCPmaseJ/kzDD3Gge/TO7fCnnj7UcPmC0d2c8XAg==',
    packedBytes: 115088941,
    unpackedBytes: 275125895,
    triple: 'aarch64-unknown-linux-musl',
    executableName: 'codex'
  }),
  'linux:x64': runtimeEntry({
    suffix: 'linux-x64',
    integrity: 'sha512-0W9MBxPpWW0cSkNqrTDN2jR7rzzT7oNMhQY5446lT2Lw5cz5yhDTck4Va9rjkQEm+HlFzP/dmEMSZbXfJsINmw==',
    packedBytes: 122020574,
    unpackedBytes: 314801778,
    triple: 'x86_64-unknown-linux-musl',
    executableName: 'codex'
  }),
  'win32:arm64': runtimeEntry({
    suffix: 'win32-arm64',
    integrity: 'sha512-e2ZstJ8zT8Rm1nvR7CUVO+Gr3cTChE41+VfOzGhynzDXEoW0wfbjUQbc2bWbh1arG94LMm4y3dqBtUIbSrfeGA==',
    packedBytes: 123164609,
    unpackedBytes: 317159585,
    triple: 'aarch64-pc-windows-msvc',
    executableName: 'codex.exe'
  }),
  'win32:x64': runtimeEntry({
    suffix: 'win32-x64',
    integrity: 'sha512-oT7Ss5fAPf2fiWE9QNURqZcQGAAawSVxmIUdgPzckq4KFZAM+pRz9JbM4Rr498CjtbNgTOjWvDJ+DXvIBSfOPA==',
    packedBytes: 131782993,
    unpackedBytes: 370445980,
    triple: 'x86_64-pc-windows-msvc',
    executableName: 'codex.exe'
  })
})

function runtimeEntry ({ suffix, integrity, packedBytes, unpackedBytes, triple, executableName }) {
  return Object.freeze({
    version: CODEX_RUNTIME_VERSION,
    url: `${REGISTRY_ROOT}/codex-${CODEX_RUNTIME_VERSION}-${suffix}.tgz`,
    integrity,
    packedBytes,
    unpackedBytes,
    triple,
    executableName,
    executableRelativePath: `vendor/${triple}/bin/${executableName}`
  })
}

function getCodexRuntimeEntry (platform = process.platform, arch = process.arch) {
  return CODEX_RUNTIME_MANIFEST[`${platform}:${arch}`]
}

module.exports = {
  CODEX_RUNTIME_VERSION,
  CODEX_RUNTIME_MANIFEST,
  getCodexRuntimeEntry
}
