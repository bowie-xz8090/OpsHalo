/**
 * Generic form renderer driven by config (flattened path)
 */
import React, { useEffect, useState, useRef } from 'react'
import { Form, Tabs } from 'antd'
import message from '../common/message'
import { renderFormItem } from './common/fields'
import SubmitButtons from './common/submit-buttons'
import { uniq } from 'lodash-es'
import {
  authTypeMap,
  settingMap,
  newBookmarkIdPrefix,
  defaultBookmarkGroupId
} from '../../common/constants'
import copy from 'json-deep-copy'
import generate from '../../common/uid'
import getInitItem from '../../common/init-setting-item'
import testCon from '../../common/test-connection'
import newTerm from '../../common/new-terminal'
import { isValidIP } from '../../common/is-ip'
import { action as manateAction } from 'manate'

export default function FormRenderer ({ config, props }) {
  const [form] = Form.useForm()
  const [ips, setIps] = useState([])
  const [testing, setTesting] = useState(false)
  const action = useRef('submit')

  let initError = null
  let initialValues = {}
  if (!config || typeof config.initValues !== 'function') {
    initError = '连接表单配置缺失，请刷新后重试'
  } else {
    try {
      initialValues = config.initValues(props) || {}
    } catch (err) {
      console.error('connection form initValues failed', err)
      initError = '连接表单初始化失败：' + String(err.message || err)
    }
  }
  const [authType, setAuthType] = useState(initialValues.authType || authTypeMap.password)

  useEffect(() => {
    if (!config || typeof config.initValues !== 'function') {
      return
    }
    try {
      const init = config.initValues(props)
      form.resetFields()
      form.setFieldsValue(init)
    } catch (err) {
      console.error('connection form reset failed', err)
    }
  }, [
    props.currentBookmarkGroupId,
    props.formData?.id,
    config?.key
  ])

  const updateBookmarkGroups = manateAction((bookmark, categoryId) => {
    const { store } = window
    let {
      bookmarkGroups
    } = store
    // Ensure groups are real objects (legacy bug stored JSON strings)
    bookmarkGroups = bookmarkGroups.map(bg => {
      if (typeof bg === 'string') {
        try {
          return JSON.parse(bg)
        } catch (e) {
          return null
        }
      }
      return bg
    }).filter(Boolean)
    store.bookmarkGroups = bookmarkGroups

    let index = bookmarkGroups.findIndex(
      bg => bg.id === categoryId
    )
    if (index < 0) {
      index = bookmarkGroups.findIndex(
        bg => bg.id === defaultBookmarkGroupId
      )
    }
    if (index < 0) {
      bookmarkGroups.push({
        title: 'default',
        id: defaultBookmarkGroupId,
        bookmarkIds: [],
        bookmarkGroupIds: []
      })
      index = bookmarkGroups.length - 1
    }
    const bid = bookmark.id
    const bg = bookmarkGroups[index]
    if (!Array.isArray(bg.bookmarkIds)) {
      bg.bookmarkIds = []
    }
    if (!bg.bookmarkIds.includes(bid)) {
      bg.bookmarkIds.unshift(bid)
    }
    bg.bookmarkIds = uniq(bg.bookmarkIds)
    bookmarkGroups.forEach((g, i) => {
      if (i === index || !Array.isArray(g.bookmarkIds)) {
        return
      }
      g.bookmarkIds = g.bookmarkIds.filter(
        id => id !== bid
      )
    })
  })

  const setNewItem = (settingItem = getInitItem([], settingMap.bookmarks)) => {
    const { store } = props
    store.setSettingItem(settingItem)
    if (store.connectionModalVisible) {
      store.connectionFormItem = settingItem
    }
  }

  const refreshBookmarksMap = () => {
    const { store } = window
    store.bookmarksMap = new Map(
      (store.bookmarks || []).map(d => [d.id, d])
    )
  }

  const submit = (evt, item, type = props.type) => {
    if (item.host) {
      item.host = item.host.trim()
    }
    const obj = item
    if (obj.connectionHoppings?.length) {
      obj.hasHopping = true
    }
    const { addItem, editItem } = props.store
    const categoryId = obj.category ||
      props.store.currentBookmarkGroupId ||
      defaultBookmarkGroupId
    delete obj.category
    const isNew = !obj.id || String(obj.id).startsWith(newBookmarkIdPrefix)
    if (!isNew) {
      const tar = copy(obj)
      delete tar.id
      editItem(obj.id, tar, settingMap.bookmarks)
      refreshBookmarksMap()
      updateBookmarkGroups(
        obj,
        categoryId
      )
      if (evt === 'saveAndCreateNew') {
        setNewItem()
      }
    } else {
      obj.id = generate()
      addItem(copy(obj), settingMap.bookmarks)
      refreshBookmarksMap()
      updateBookmarkGroups(
        obj,
        categoryId
      )
      // Keep default group expanded so the new connection is visible
      if (!props.store.expandedKeys.includes(categoryId)) {
        props.store.expandedKeys.push(categoryId)
      }
      if (evt === 'saveAndCreateNew') {
        setNewItem()
      } else if (!props.store.connectionModalVisible) {
        setNewItem(obj)
      }
    }
  }

  const test = async (update) => {
    let options = copy({
      ...props.formData,
      ...update
    })
    let msg = ''
    setTesting(true)
    options = window.store.applyProfileToTabs(options)
    const res = await testCon(options)
      .then(r => r)
      .catch((e) => {
        msg = e.message
        return false
      })
    setTesting(false)
    if (res) {
      message.success('connection ok')
    } else {
      const err = 'connection fails' +
        (msg ? `: ${msg}` : '')
      message.error(err)
    }
  }

  const onSelectProxy = (proxy, form) => {
    const obj = Object.keys(proxy)
      .reduce((prev, c) => {
        return {
          ...prev,
          [`proxy.${c}`]: proxy[c]
        }
      }, {})
    form.setFieldsValue(obj)
  }

  const handleSubmit = async (evt, res, isTest = false) => {
    if (res.enableSsh === false && res.enableSftp === false) {
      return message.warning('SSH and SFTP all disabled')
    }
    // Include unregistered initial values (e.g. category) from the form store
    const allValues = form.getFieldsValue(true)
    const formDataId = props.formData?.id
    const obj = {
      ...props.formData,
      ...allValues,
      ...res
    }
    // Never let empty/missing id wipe the new-bookmark prefix from formData
    if (!obj.id || obj.id === '') {
      obj.id = formDataId || (newBookmarkIdPrefix + ':' + Date.now())
    }
    if (!obj.type) {
      obj.type = 'ssh'
    }
    if (!obj.category) {
      obj.category = props.store.currentBookmarkGroupId || defaultBookmarkGroupId
    }
    if (!obj.terminalBackground?.terminalBackgroundImagePath) {
      delete obj.terminalBackground
    }
    if (isTest) {
      return test(obj)
    }
    if (evt && evt !== 'connect') {
      submit(evt, obj)
    }
    if (evt === 'save') {
      props.hide?.()
      return
    }
    if (evt !== 'save' && evt !== 'saveAndCreateNew') {
      window.store.currentLayoutBatch = window.openTabBatch || 0
      props.store.addTab({
        ...copy(obj),
        ...newTerm(true, true),
        batch: window.openTabBatch ?? window.store.currentLayoutBatch
      })
      delete window.openTabBatch
      props.hide()
    }
  }

  // Button handlers - exactly like original use-form-funcs
  const testConnection = () => {
    action.current = 'testConnection'
    form.submit()
  }

  const connect = () => {
    action.current = 'connect'
    form.submit()
  }

  const saveAndConnect = () => {
    action.current = 'submit'
    form.submit()
  }

  const handleFinish = (res) => {
    if (action.current === 'save') {
      handleSubmit('save', res, false)
    } else if (action.current === 'saveAndCreateNew') {
      handleSubmit('saveAndCreateNew', res, false)
    } else if (action.current === 'connect') {
      handleSubmit('connect', res, false)
    } else if (action.current === 'testConnection') {
      handleSubmit('test', res, true)
    } else {
      handleSubmit('submit', res, false)
    }
    action.current = 'submit'
  }

  const trim = (v) => {
    return (v || '').replace(/^\s+|\s+$/g, '')
  }
  const useIp = (form, ip) => {
    form.setFieldsValue({
      host: ip
    })
  }
  const onPaste = (e, form) => {
    const txt = e.clipboardData.getData('Text')
    // support name:passsword@host:23
    const arr = txt.match(/([^:@]+)(:[^:@]+)?@([^:@]+)(:\d+)?/)
    if (!arr) {
      return
    }
    const username = arr[1]
    const password = arr[2] ? arr[2].slice(1) : ''
    const host = arr[3]
    const port = arr[4] ? arr[4].slice(1) : ''
    const obj = {
      username,
      host
    }
    if (password) {
      obj.password = password
    }
    if (port) {
      obj.port = port
    }
    setTimeout(() => {
      form.setFieldsValue(obj)
    }, 20)
  }

  const onBlur = async (e) => {
    const value = e.target.value.trim()
    const { type } = props
    if (
      type !== settingMap.bookmarks ||
      !value ||
      isValidIP(value)
    ) {
      return
    }
    const ips = await window.pre.runGlobalAsync('lookup', value)
      .catch(err => {
        console.debug(err)
      })
    setIps(ips || [])
  }

  function onChangeAuthType (e) {
    const newAuthType = e.target.value
    setAuthType(newAuthType)
  }

  const ctxProps = {
    ...props,
    form,
    authType,
    ips,
    testing,
    loaddingSerials: props.loaddingSerials || false,
    trim,
    onSelectProxy,
    onChangeAuthType,
    handleBlur: onBlur,
    handlePaste: onPaste,
    useIp
  }

  if (initError) {
    return (
      <div className='pd2'>{initError}</div>
    )
  }

  const tabs = typeof config.tabs === 'function' ? (config.tabs() || []) : (config.tabs || [])
  let content = null

  if (tabs.length <= 1) {
    const fields = tabs.length === 1
      ? (tabs[0].fields || [])
      : (config.fields || [])
    content = (
      <div className='pd1x'>
        {fields.map((f, index) => renderFormItem(f, config.layout, form, ctxProps, index))}
      </div>
    )
  } else {
    const items = (tabs || []).map(tab => ({
      key: tab.key,
      label: tab.label,
      forceRender: true,
      children: (
        <div className='pd1x'>
          {(tab.fields || []).map((f, index) => renderFormItem(f, config.layout, form, ctxProps, index))}
        </div>
      )
    }))
    content = <Tabs items={items} />
  }
  const formName = `${config.key || 'ssh'}-form`
  return (
    <Form
      form={form}
      onFinish={handleFinish}
      initialValues={initialValues}
      name={formName}
    >
      {content}
      <SubmitButtons
        onConnect={connect}
        onSaveAndConnect={saveAndConnect}
        onTestConnection={testConnection}
      />
    </Form>
  )
}
