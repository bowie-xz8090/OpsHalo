import { auto } from 'manate/react'
import {
  Select,
  Dropdown
} from 'antd'
import { InfoCircleOutlined, TranslationOutlined, DoubleRightOutlined } from '@ant-design/icons'
import './footer.styl'
import { statusMap } from '../../common/constants'
import encodes from '../bookmark-form/common/encodes'
import { refs } from '../common/ref'

const {
  Option
} = Select

const e = window.translate

export default auto(function FooterEntry (props) {
  function handleInfoPanel () {
    window.store.openInfoPanel()
  }

  function handleSwitchEncoding (encode) {
    const term = refs.get('term-' + props.store.activeTabId)
    if (term) {
      term.switchEncoding(encode)
    }
  }

  function isLoading () {
    const { currentTab } = props.store
    if (!currentTab) {
      return true
    }
    const {
      status
    } = currentTab
    return status !== statusMap.success
  }

  function renderEncodingInfo () {
    const selectProps = {
      style: {
        minWidth: 30
      },
      placeholder: e('encode'),
      defaultValue: props.store.currentTab?.encode,
      onSelect: handleSwitchEncoding,
      size: 'small',
      popupMatchSelectWidth: false
    }
    if (props.store.isMobile) {
      const items = encodes.map(k => {
        return {
          key: k,
          label: k.toUpperCase(),
          onClick: () => handleSwitchEncoding(k)
        }
      })
      return (
        <div className='terminal-footer-unit terminal-footer-info'>
          <Dropdown
            menu={{ items }}
            placement='topRight'
            trigger={['click']}
          >
            <TranslationOutlined
              className='pointer font18 mobile-encode-trigger'
            />
          </Dropdown>
        </div>
      )
    }
    return (
      <div className='terminal-footer-unit terminal-footer-info'>
        <div className='fleft relative'>
          <Select
            {...selectProps}
          >
            {
              encodes.map(k => {
                return (
                  <Option key={k} value={k}>
                    {k.toUpperCase()}
                  </Option>
                )
              })
            }
          </Select>
        </div>
      </div>
    )
  }

  function renderInfoIcon () {
    const loading = isLoading()
    if (loading) {
      return null
    }
    return (
      <div className='terminal-footer-unit terminal-footer-info'>
        <InfoCircleOutlined
          onClick={handleInfoPanel}
          className='pointer font18 terminal-info-icon'
        />
      </div>
    )
  }

  function handleShowSidebar () {
    window.store.toggleLeftSideBar()
  }

  const {
    leftSidePanelWidth,
    leftSideBarWidth,
    openedSideBar,
    inActiveTerminal
  } = props.store
  const w = leftSideBarWidth + leftSidePanelWidth
  // icon bar hidden: show a control on the left of the footer to bring the
  // sidebar back
  const showSidebarIcon = leftSideBarWidth === 0
    ? (
      <div className='terminal-footer-unit terminal-footer-show-sidebar'>
        <DoubleRightOutlined
          className='pointer font18 show-sidebar-icon'
          onClick={handleShowSidebar}
        />
      </div>
      )
    : null
  const sideProps = openedSideBar
    ? {
        className: 'main-footer',
        style: {
          left: `${w}px`
        }
      }
    : {
        className: 'main-footer'
      }
  if (
    !inActiveTerminal
  ) {
    return (
      <div className='main-footer' {...sideProps}>
        {showSidebarIcon}
      </div>
    )
  }
  return (
    <div {...sideProps}>
      <div className='terminal-footer-flex'>
        {showSidebarIcon}
        {renderEncodingInfo()}
        {renderInfoIcon()}
      </div>
    </div>
  )
})
