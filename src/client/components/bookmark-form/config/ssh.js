// SSH config — mini edition essentials
import { formItemLayout } from '../../../common/form-layout.js'
import { connectionMap, authTypeMap, defaultEnvLang } from '../../../common/constants.js'
import defaultSetting from '../../../common/default-setting.js'
import { createBaseInitValues, getTerminalDefaults, getSshDefaults, getTerminalBackgroundDefaults, getAuthTypeDefault } from '../common/init-values.js'
import { commonFields } from './common-fields.js'

const e = window.translate

const miniSshAuthFields = [
  commonFields.title,
  { ...commonFields.host, type: 'sshHostSelector' },
  commonFields.username,
  { type: 'sshAuthTypeSelector', name: 'authType', label: '' },
  { type: 'sshAuthSelector', name: '__auth__', label: '', formItemName: 'password' },
  commonFields.port,
  {
    type: 'switch',
    name: 'enableSftp',
    label: 'SFTP',
    valuePropName: 'checked'
  },
  commonFields.description,
  commonFields.type
]

const sshConfig = {
  key: connectionMap.ssh,
  type: connectionMap.ssh,
  initValues: (props) => {
    const { store } = props
    return createBaseInitValues(props, connectionMap.ssh, {
      port: 22,
      authType: authTypeMap.password,
      envLang: defaultEnvLang,
      enableSsh: true,
      enableSftp: true,
      sshTunnels: [],
      connectionHoppings: [],
      useSshAgent: true,
      sshAgent: '',
      serverHostKey: [],
      cipher: [],
      compress: [],
      ...getTerminalDefaults(store),
      ...getSshDefaults(),
      ...getTerminalBackgroundDefaults(defaultSetting),
      ...getAuthTypeDefault(props)
    })
  },
  layout: formItemLayout,
  tabs: () => [
    {
      key: 'auth',
      label: e('auth') || '连接',
      fields: miniSshAuthFields
    }
  ]
}
export default sshConfig
