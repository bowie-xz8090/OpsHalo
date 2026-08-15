import { Button, Spin } from 'antd'
import { auto } from 'manate/react'
import LogoElem from '../common/logo-elem.jsx'
import ConnectionList from '../sidebar/connection-list'
import './no-session.styl'

export default auto(function NoSessionPanel ({ height, batch }) {
  const { store } = window
  const dataReady = store.configLoaded && !store.initLoadingData
  const props = {
    style: {
      height: height + 'px'
    }
  }

  const handleNewConnection = () => {
    window.openTabBatch = batch
    window.store.openConnectionModal()
  }

  const handleClick = () => {
    window.openTabBatch = batch
  }

  return (
    <div className='no-sessions electerm-logo-bg' {...props}>
      <div className='no-session-btns'>
        <Button
          type='primary'
          onClick={handleNewConnection}
          className='add-new-tab-btn'
          disabled={!dataReady}
        >
          新建连接
        </Button>
      </div>
      <div className='no-session-logo'>
        <LogoElem />
      </div>
      <div className='no-session-history' onClick={handleClick}>
        <div className='no-session-connections'>
          {
            dataReady
              ? (
                <>
                  <div className='pd1y pd2x bold'>连接列表</div>
                  <ConnectionList store={store} autoFocus batch={batch} />
                </>
                )
              : (
                <div className='no-session-connections-loading'>
                  <Spin description='正在加载连接列表…' />
                </div>
                )
          }
        </div>
      </div>
    </div>
  )
})
