import {
  BookOutlined,
  InfoCircleOutlined,
  SettingOutlined,
  AimOutlined,
  MenuFoldOutlined,
  PlusCircleOutlined
} from '@ant-design/icons'
import MenuBtn from '../sys-menu/menu-btn'
import SideBarPanel from './sidebar-panel'
import SidePanel from './side-panel'
import {
  settingMap,
  modals
} from '../../common/constants'
import SideIcon from './side-icon'
import hasActiveInput from '../../common/has-active-input'
import './sidebar.styl'

const e = window.translate

export default function Sidebar (props) {
  const {
    height,
    settingTab,
    leftSidePanelWidth,
    leftSideBarWidth,
    pinned,
    openedSideBar,
    showModal,
    showInfoModal,
    sidebarPanelTab,
    zoom
  } = props

  const { store } = window

  const handleClickOutside = (event) => {
    if (store.pinned || hasActiveInput()) {
      return
    }
    const sidebarPanel = document.querySelector('.sidebar-panel')
    if (sidebarPanel && !sidebarPanel.contains(event.target)) {
      store.setOpenedSideBar('')
      document.removeEventListener('click', handleClickOutside)
    }
  }

  const handleClickBookmark = () => {
    if (showModal) {
      store.showModal = 0
    }
    if (pinned) {
      return
    }
    if (openedSideBar === 'bookmarks') {
      document.removeEventListener('click', handleClickOutside)
      store.setOpenedSideBar('')
    } else {
      setTimeout(() => {
        document.addEventListener('click', handleClickOutside)
      }, 0)
      store.setOpenedSideBar('bookmarks')
    }
  }

  const handleZoomReset = () => {
    store.onZoomReset()
  }

  const handleToggleSidebar = () => {
    store.toggleLeftSideBar()
  }

  const {
    onNewSsh,
    openSetting,
    openAbout,
    setLeftSidePanelWidth
  } = store
  const showSetting = showModal === modals.setting
  const settingActive = showSetting && settingTab === settingMap.setting
  const bookmarksActive = showSetting && settingTab === settingMap.bookmarks
  const sideProps = openedSideBar
    ? {
        className: 'sidebar-list',
        style: {
          width: `${leftSidePanelWidth}px`
        }
      }
    : {
        className: 'sidebar-list'
      }
  const sidebarProps = {
    className: `sidebar type-${openedSideBar || 'none'}${leftSideBarWidth === 0 ? ' collapsed' : ''}`,
    style: {
      width: leftSideBarWidth,
      height
    }
  }
  return (
    <div {...sidebarProps}>
      <div className='sidebar-bar btns'>
        <div className='control-icon-wrap'>
          <MenuBtn store={store} config={store.config} />
        </div>
        <SideIcon
          title='新建连接'
        >
          <PlusCircleOutlined
            className='font22 iblock control-icon'
            onClick={onNewSsh}
          />
        </SideIcon>
        <SideIcon
          title='连接列表'
          active={bookmarksActive || openedSideBar === 'bookmarks'}
        >
          <BookOutlined
            onClick={handleClickBookmark}
            className='font20 iblock control-icon'
          />
        </SideIcon>
        <SideIcon
          title={e(settingMap.setting)}
          active={settingActive}
        >
          <SettingOutlined className='iblock font20 control-icon' onClick={openSetting} />
        </SideIcon>
        <SideIcon
          title={e('about')}
          active={showInfoModal}
        >
          <InfoCircleOutlined
            className='iblock font16 control-icon open-about-icon'
            onClick={openAbout}
          />
        </SideIcon>
        <SideIcon
          title={e('hide')}
        >
          <MenuFoldOutlined
            className='iblock font16 control-icon hide-sidebar-icon'
            onClick={handleToggleSidebar}
          />
        </SideIcon>
        {
          Math.round((zoom ?? 1) * 100) !== 100
            ? (
              <SideIcon
                title={e('resetzoom')}
              >
                <AimOutlined
                  className='iblock font16 control-icon zoom-reset-icon'
                  onClick={handleZoomReset}
                />
              </SideIcon>
              )
            : null
        }
      </div>
      <SidePanel
        sideProps={sideProps}
        setLeftSidePanelWidth={setLeftSidePanelWidth}
        leftSidePanelWidth={leftSidePanelWidth}
        leftSideBarWidth={leftSideBarWidth}
      >
        <SideBarPanel
          pinned={pinned}
          sidebarPanelTab={sidebarPanelTab}
        />
      </SidePanel>
    </div>
  )
}
