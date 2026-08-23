const bookmarkSchema = {
  ssh: {
    type: 'ssh',
    host: 'string (required) - hostname or IP address',
    port: 'number (default: 22) - SSH port',
    username: 'string - SSH username',
    password: 'string - password for authentication',
    privateKey: 'string - private key content or path for key-based auth',
    passphrase: 'string - passphrase for private key/certificate',
    certificate: 'string - certificate content',
    authType: 'string - password|privateKey',
    title: 'string - bookmark title',
    description: 'string - bookmark description',
    startDirectoryRemote: 'string - remote starting directory',
    startDirectoryLocal: 'string - local starting directory',
    enableSsh: 'boolean - enable SSH, default true',
    enableSftp: 'boolean - enable SFTP, default true',
    sshTunnels: 'array - SSH tunnel definitions',
    connectionHoppings: 'array - connection hopping definitions',
    useSshAgent: 'boolean - use SSH agent, default true',
    sshAgent: 'string - SSH agent path',
    serverHostKey: 'array - server host key algorithms',
    cipher: 'array - cipher list',
    compress: 'array - compression algorithms',
    runScripts: 'array - run scripts after connected',
    proxy: 'string - proxy address',
    x11: 'boolean - enable X11 forwarding',
    term: 'string - terminal type',
    displayRaw: 'boolean - display raw output',
    encode: 'string - charset',
    envLang: 'string - environment locale',
    setEnv: 'string - environment variables',
    color: 'string - tag color',
    interactiveValues: 'strings separated by newline'
  }
}

export function buildPrompt (description) {
  const lang = window.store.config.languageAI || window.store.getLangName()
  const fields = Object.entries(bookmarkSchema.ssh)
    .map(([key, value]) => `    ${key}: ${value}`)
    .join('\n')

  return `You are an SSH bookmark configuration generator. Generate JSON from the user's description.

Available fields:
  ssh:
${fields}

Rules:
1. Generate SSH bookmarks only, using type "ssh" and port 22 unless specified
2. Only include fields relevant to SSH
3. Always include a meaningful title if not specified
4. Respond ONLY with valid JSON, no markdown or explanations
5. Reply in ${lang}

User description: ${description}

Generate the bookmark JSON:`
}

export default bookmarkSchema
