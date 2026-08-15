// Mini edition: SSH only (SFTP is part of SSH session)
import { connectionMap } from '../../../common/constants'
import { filterMiniSessionConfig } from '../../../common/mini-features'
import ssh from './ssh'

const sessionConfig = filterMiniSessionConfig({
  [connectionMap.ssh]: ssh
})

export default sessionConfig
