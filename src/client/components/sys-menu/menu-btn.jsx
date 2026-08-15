/**
 * btns
 */

import { PureComponent } from 'react'
import {
  Popover
} from 'antd'
import { shortcutDescExtend } from '../shortcuts/shortcut-handler.js'
import MenuRender from './sys-menu.jsx'
import { refsStatic } from '../common/ref.js'

const e = window.translate

class MenuBtn extends PureComponent {
  componentDidMount () {
    refsStatic.add('menu-btn', this)
  }

  addTab = () => {
    window.store.addTab()
  }

  openAbout = () => {
    window.store.openAbout()
  }

  openSetting = () => {
    window.store.openSetting()
  }

  openDevTools = () => {
    window.pre.runGlobalAsync('openDevTools')
  }

  minimize = () => {
    window.pre.runGlobalAsync('minimize')
  }

  maximize = () => {
    window.pre.runGlobalAsync('maximize')
  }

  reload = () => {
    window.location.reload()
  }

  restart = () => {
    window.store.restart()
  }

  close = () => {
    window.store.exit()
  }

  renderContext = () => {
    const items = []
    if (window.store.hasNodePty) {
      items.push({
        func: 'addTab',
        icon: 'RightSquareFilled',
        text: e('newTab'),
        subText: this.getShortcut('app_newTab')
      })
    }
    items.push(
      {
        noCloseMenu: true,
        icon: 'ClockCircleOutlined',
        text: e('history'),
        submenu: 'History'
      },
      {
        noCloseMenu: true,
        icon: 'BarsOutlined',
        text: e('sessions'),
        submenu: 'Tabs'
      },
      {
        icon: 'AppstoreOutlined',
        text: e('layout'),
        submenu: 'Layout'
      },
      {
        func: 'openAbout',
        icon: 'InfoCircleOutlined',
        text: e('about')
      },
      {
        func: 'openSetting',
        icon: 'SettingOutlined',
        text: e('settings')
      },
      {
        func: 'openDevTools',
        icon: 'LeftSquareFilled',
        text: e('toggledevtools')
      },
      {
        module: 'Zoom'
      },
      {
        func: 'minimize',
        icon: 'SwitcherFilled',
        text: e('minimize')
      },
      {
        func: 'maximize',
        icon: 'LayoutFilled',
        text: e('maximize')
      },
      {
        func: 'reload',
        icon: 'ReloadOutlined',
        text: e('reload')
      },
      {
        func: 'restart',
        icon: 'RedoOutlined',
        text: e('restart')
      },
      {
        func: 'close',
        icon: 'CloseOutlined',
        text: e('close')
      }
    )
    return items
  }

  renderMenu () {
    const { store } = window
    const rprops = {
      items: this.renderContext(),
      tabs: store.getTabs(),
      config: store.config,
      history: store.history
    }
    return (
      <MenuRender {...rprops} />
    )
  }

  render () {
    const pops = {
      className: 'menu-control',
      onMouseDown: evt => evt.preventDefault(),
      onClick: this.openMenu,
      title: e('menu')
    }
    const popProps = {
      content: this.renderMenu(),
      // open: this.state.opened,
      placement: 'right',
      trigger: ['click']
    }
    return (
      <Popover {...popProps}>
        <div
          {...pops}
        >
          <span className='menu-logo'>OH</span>
        </div>
      </Popover>
    )
  }
}

export default shortcutDescExtend(MenuBtn)
