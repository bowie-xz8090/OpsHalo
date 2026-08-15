import { packInfo } from '../../common/constants'
import { Tag } from 'antd'
import './logo.styl'

export default function LogoElem () {
  return (
    <h1 className='logo-elem mg3y font50'>
      <span className='opshalo-wordmark'>OpsHalo</span>
      <Tag color='#08c' variant='solid'>{packInfo.version}</Tag>
    </h1>
  )
}
