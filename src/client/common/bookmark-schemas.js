import { z } from './zod'

const sshTunnelSchema = z.object({
  sshTunnel: z.enum(['forwardRemoteToLocal', 'forwardLocalToRemote', 'dynamicForward']).describe('Tunnel type'),
  sshTunnelLocalHost: z.string().optional().describe('Local host'),
  sshTunnelLocalPort: z.number().optional().describe('Local port'),
  sshTunnelRemoteHost: z.string().optional().describe('Remote host'),
  sshTunnelRemotePort: z.number().optional().describe('Remote port'),
  name: z.string().optional().describe('Tunnel name')
})

const connectionHoppingSchema = z.object({
  host: z.string().describe('Host address'),
  port: z.number().optional().describe('Port number'),
  username: z.string().optional().describe('Username'),
  password: z.string().optional().describe('Password'),
  privateKey: z.string().optional().describe('Private key'),
  passphrase: z.string().optional().describe('Passphrase'),
  certificate: z.string().optional().describe('Certificate'),
  authType: z.string().optional().describe('Auth type')
})

export const sshBookmarkSchema = {
  title: z.string().describe('Bookmark title'),
  host: z.string().describe('SSH host address'),
  port: z.number().optional().describe('SSH port (default 22)'),
  username: z.string().optional().describe('SSH username'),
  password: z.string().optional().describe('SSH password'),
  description: z.string().optional().describe('Bookmark description'),
  startDirectoryRemote: z.string().optional().describe('Remote starting directory'),
  startDirectoryLocal: z.string().optional().describe('Local starting directory'),
  proxy: z.string().optional().describe('Proxy address'),
  authType: z.enum(['password', 'privateKey']).optional().describe('Authentication type'),
  privateKey: z.string().optional().describe('Private key content or path'),
  passphrase: z.string().optional().describe('Private key passphrase'),
  certificate: z.string().optional().describe('Certificate content'),
  enableSsh: z.boolean().optional().describe('Enable SSH'),
  enableSftp: z.boolean().optional().describe('Enable SFTP'),
  useSshAgent: z.boolean().optional().describe('Use SSH agent'),
  sshAgent: z.string().optional().describe('SSH agent path'),
  serverHostKey: z.array(z.string()).optional().describe('Server host key algorithms'),
  cipher: z.array(z.string()).optional().describe('Cipher list'),
  compress: z.array(z.string()).optional().describe('Compression algorithms'),
  x11: z.boolean().optional().describe('Enable X11 forwarding'),
  term: z.string().optional().describe('Terminal type'),
  displayRaw: z.boolean().optional().describe('Display raw output'),
  encode: z.string().optional().describe('Charset'),
  envLang: z.string().optional().describe('Environment locale'),
  color: z.string().optional().describe('Tag color'),
  sshTunnels: z.array(sshTunnelSchema).optional().describe('SSH tunnel definitions'),
  connectionHoppings: z.array(connectionHoppingSchema).optional().describe('Connection hopping definitions')
}

export const bookmarkSchemas = {
  ssh: sshBookmarkSchema
}
