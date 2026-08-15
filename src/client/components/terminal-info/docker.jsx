import { Table, Tooltip } from 'antd'
import { ContainerOutlined } from '@ant-design/icons'

function renderText (value) {
  const text = value === 0 ? '0' : value || '-'
  return (
    <Tooltip title={text}>
      <div className='docker-info-cell'>{text}</div>
    </Tooltip>
  )
}

function renderDate (value) {
  if (!value || value.startsWith('0001-01-01')) {
    return '-'
  }
  const date = new Date(value)
  const text = Number.isNaN(date.getTime()) ? value : date.toLocaleString()
  return (
    <Tooltip title={value}>
      <div className='docker-info-cell'>{text}</div>
    </Tooltip>
  )
}

function renderId (value, record) {
  return (
    <Tooltip title={record.fullId || value}>
      <div className='docker-info-cell'>{value || '-'}</div>
    </Tooltip>
  )
}

const columns = [
  { title: 'Container name', dataIndex: 'name', width: 150, render: renderText },
  { title: 'Container ID', dataIndex: 'fullId', width: 180, render: renderId },
  { title: 'Image', dataIndex: 'image', width: 200, render: renderText },
  { title: 'Status', dataIndex: 'status', width: 130, render: renderText },
  { title: 'Ports', dataIndex: 'ports', width: 260, render: renderText },
  { title: 'CPU', dataIndex: 'cpu', width: 90, render: renderText },
  { title: 'Mem', dataIndex: 'mem', width: 90, render: renderText },
  { title: 'Created', dataIndex: 'created', width: 180, render: renderDate },
  { title: 'Last started', dataIndex: 'lastStarted', width: 180, render: renderDate },
  { title: 'Restart count', dataIndex: 'restartCount', width: 110, render: renderText },
  { title: 'Directory', dataIndex: 'workingDir', width: 260, render: renderText },
  { title: 'YML config', dataIndex: 'configFiles', width: 260, render: renderText }
]

export default function TerminalInfoDocker (props) {
  const { dockers, isRemote, terminalInfos } = props
  if (!isRemote || !terminalInfos.includes('dockers')) {
    return null
  }
  return (
    <div className='terminal-info-section terminal-info-dockers'>
      <div className='pd1y bold'><ContainerOutlined /> Dockers</div>
      <Table
        rowKey={record => record.fullId || record.name}
        dataSource={dockers}
        bordered
        columns={columns}
        size='small'
        pagination={false}
        scroll={{ x: 2090, y: 360 }}
      />
    </div>
  )
}
