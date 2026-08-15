/**
 * Config-driven connection form (SSH mini edition)
 */
import { PureComponent } from 'react'
import {
  settingMap,
  connectionMap,
  newBookmarkIdPrefix
} from '../../common/constants'
import { createTitleWithTag } from '../../common/create-title'
import { LoadingOutlined, BookOutlined } from '@ant-design/icons'
import renderForm from './render-form'
import './bookmark-form.styl'

export default class BookmarkIndex2 extends PureComponent {
  constructor (props) {
    super(props)
    this.state = {
      ready: false,
      bookmarkType: connectionMap.ssh
    }
  }

  componentDidMount () {
    this.timer = setTimeout(() => {
      this.setState({ ready: true })
    }, 75)
  }

  componentWillUnmount () {
    clearTimeout(this.timer)
  }

  renderTitle (formData, isNew) {
    if (isNew) return null
    return (
      <b className='mg1x'>
        {createTitleWithTag(formData)}
      </b>
    )
  }

  renderForm () {
    return renderForm(this.state.bookmarkType, this.props)
  }

  render () {
    const { formData } = this.props
    const { id = '' } = formData
    const { type } = this.props
    if (type !== settingMap.bookmarks) return null
    const { ready } = this.state
    if (!ready) {
      return (
        <div className='pd3 aligncenter'>
          <LoadingOutlined />
        </div>
      )
    }
    const isNew = id.startsWith(newBookmarkIdPrefix)
    return (
      <div className='form-wrap pd1x'>
        <div className='form-title pd1t pd1x pd2b bold'>
          <BookOutlined className='mg1r' />
          <span>
            {isNew ? '新建连接' : '编辑连接'}
          </span>
          {this.renderTitle(formData, isNew)}
        </div>
        {this.renderForm()}
      </div>
    )
  }
}
