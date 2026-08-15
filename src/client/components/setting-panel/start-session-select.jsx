import { Select, Empty } from 'antd'
import { useEffect } from 'react'
import HelpIcon from '../common/help-icon'

const e = window.translate

export default function StartSessionSelect (props) {
  const {
    workspaces = [],
    onStartSessions,
    onChangeStartSessions
  } = props

  useEffect(() => {
    // Clear legacy bookmark-array startup config
    if (Array.isArray(onStartSessions)) {
      onChangeStartSessions(undefined)
    }
  }, [onStartSessions, onChangeStartSessions])

  if (!workspaces.length) {
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={e('noWorkspaces')}
      />
    )
  }

  const value = typeof onStartSessions === 'string' ? onStartSessions : undefined

  return (
    <div>
      <div className='pd1b'>
        <HelpIcon link='https://github.com/electerm/electerm/wiki/Workspace-Feature' />
        {' '}{e('workspaces')}
      </div>
      <Select
        value={value}
        onChange={onChangeStartSessions}
        placeholder={e('workspaces')}
        style={{ width: '100%' }}
        allowClear
      >
        {workspaces.map(w => (
          <Select.Option key={w.id} value={w.id}>
            {w.name}
          </Select.Option>
        ))}
      </Select>
    </div>
  )
}
