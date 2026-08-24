import { Alert, Button, Card, Empty, Progress, Space, Tag, Typography } from 'antd'
import { useEffect, useState } from 'react'
import message from '../../common/message'

const terminalStates = ['authenticated', 'unauthenticated', 'error', 'expired']

export default function CodexAccountOverview ({ value, onChange, disabled }) {
  const codexApi = window.api?.codex
  const [accounts, setAccounts] = useState({ currentProfileId: null, profiles: [] })
  const [loading, setLoading] = useState(false)
  const [login, setLogin] = useState(null)
  const [runtime, setRuntime] = useState(null)
  const unavailable = disabled || !codexApi

  const load = async () => {
    if (!codexApi) return
    try {
      const result = await codexApi.listAccounts({ schemaVersion: 1 })
      setAccounts(result)
      if (!value && result.currentProfileId) onChange?.(result.currentProfileId)
    } catch (error) {
      message.error(error.safeMessage || error.message)
    }
  }

  useEffect(() => {
    load()
    if (!codexApi) return undefined
    codexApi.getRuntimeStatus?.().then(setRuntime).catch(error => message.error(error.safeMessage || error.message))
    const disposeAccount = codexApi.onEvent(event => {
      if (event?.accounts) setAccounts(event.accounts)
      const profile = event?.accounts?.profiles?.find(item => item.profileId === event.profileId)
      if (profile && terminalStates.includes(profile.authState)) setLogin(null)
    })
    const disposeRuntime = codexApi.onRuntimeEvent?.(setRuntime)
    return () => {
      disposeAccount?.()
      disposeRuntime?.()
    }
  }, [])

  const run = async action => {
    setLoading(true)
    try {
      return await action()
    } catch (error) {
      message.error(error.safeMessage || error.message)
    } finally {
      setLoading(false)
    }
  }

  const startLogin = (method, profile) => run(async () => {
    const result = await codexApi.startLogin({
      schemaVersion: 1,
      method,
      profileId: profile?.profileId,
      displayName: profile?.displayName || `Codex account ${accounts.profiles.length + 1}`
    })
    setLogin(result)
    onChange?.(result.profileId)
    await load()
    message.success(method === 'device_code' ? '已打开设备码授权页面' : '已在浏览器中打开 Codex 授权页面')
  })

  const select = profileId => run(async () => {
    const result = await codexApi.selectAccount({ schemaVersion: 1, profileId })
    setAccounts(result)
    onChange?.(profileId)
  })

  const refresh = profileId => run(async () => {
    await codexApi.refreshAccount({ schemaVersion: 1, profileId })
    await load()
  })

  const logout = profileId => run(async () => {
    await codexApi.logout({ schemaVersion: 1, profileId })
    await load()
  })

  const remove = profileId => run(async () => {
    const result = await codexApi.removeAccount({ schemaVersion: 1, profileId })
    setAccounts(result)
    if (value === profileId) onChange?.(result.currentProfileId || '')
  })

  const cancelLogin = () => run(async () => {
    await codexApi.cancelLogin({ schemaVersion: 1, profileId: login.profileId, loginId: login.loginId })
    setLogin(null)
    await load()
  })

  const cancelRuntime = async () => {
    try {
      setRuntime(await codexApi.cancelRuntimeDownload())
    } catch (error) {
      message.error(error.safeMessage || error.message)
    }
  }

  const runtimeBusy = runtime?.state === 'downloading' || runtime?.state === 'verifying'
  const runtimeSize = formatBytes(runtime?.totalBytes)
  const runtimePercent = runtime?.totalBytes > 0
    ? Math.min(100, Math.round((runtime.downloadedBytes / runtime.totalBytes) * 100))
    : 0
  const addButtonSuffix = runtime?.state === 'missing' || runtime?.state === 'failed'
    ? `（需下载 ${runtimeSize}）`
    : ''

  return (
    <div className='codex-account-overview'>
      <Alert
        type='info'
        showIcon
        className='mg1b'
        title='使用 ChatGPT / Codex 订阅账号'
        description='通过官方 Codex App Server 完成 OAuth。订阅额度与 OpenAI API Key 额度独立；OpsHalo 不导入或展示 id_token、refresh_token。'
      />
      {!codexApi && (
        <Alert type='error' showIcon className='mg1b' title='Codex App Server IPC 尚未就绪，请重启应用或重新安装当前版本。' />
      )}
      {runtime && runtime.state !== 'ready' && (
        <Alert
          type={runtime.state === 'failed' ? 'error' : 'info'}
          showIcon
          className='mg1b'
          title={runtimeTitle(runtime)}
          description={runtimeBusy
            ? (
              <Space direction='vertical' className='width-100' size='small'>
                {runtime.state === 'downloading' && (
                  <>
                    <Progress percent={runtimePercent} size='small' />
                    <Typography.Text type='secondary'>{formatBytes(runtime.downloadedBytes)} / {runtimeSize}</Typography.Text>
                  </>
                )}
                <Button size='small' danger disabled={runtime.state === 'verifying'} onClick={cancelRuntime}>取消下载</Button>
              </Space>
              )
            : runtime.error || `首次使用 Codex 需要下载 ${runtimeSize}，点击下方账号按钮后自动开始。`}
        />
      )}
      <Space wrap className='mg1b'>
        <Button type='primary' disabled={unavailable || runtimeBusy} loading={loading} onClick={() => startLogin('browser')}>浏览器 OAuth 添加账号{addButtonSuffix}</Button>
        <Button disabled={unavailable || runtimeBusy} loading={loading} onClick={() => startLogin('device_code')}>设备码添加账号{addButtonSuffix}</Button>
      </Space>
      {login && (
        <Alert
          type='warning'
          showIcon
          className='mg1b'
          title='等待 Codex 授权'
          description={(
            <Space direction='vertical'>
              {login.userCode && <Typography.Text copyable strong>设备码：{login.userCode}</Typography.Text>}
              <Typography.Text type='secondary'>已在系统浏览器中打开官方授权页面。完成后此处会自动刷新。</Typography.Text>
              <Button size='small' danger onClick={cancelLogin}>取消授权</Button>
            </Space>
          )}
        />
      )}
      {!accounts.profiles.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description='尚未添加 Codex 账号' />}
      <Space direction='vertical' className='width-100' size='middle'>
        {accounts.profiles.map(profile => {
          const current = value === profile.profileId
          const used = profile.rateLimits?.primary?.usedPercent
          return (
            <Card
              key={profile.profileId}
              size='small'
              title={(
                <Space wrap>
                  <span>{profile.maskedEmail || profile.displayName}</span>
                  {current && <Tag color='blue'>当前启用</Tag>}
                  <Tag color={profile.authState === 'authenticated' ? 'green' : profile.authState === 'authorizing' ? 'gold' : 'default'}>{profile.authState}</Tag>
                  {profile.planType && <Tag>{profile.planType}</Tag>}
                </Space>
              )}
            >
              {Number.isFinite(used)
                ? (
                  <div className='mg1b'>
                    <Typography.Text>Codex 窗口已用 {used}%</Typography.Text>
                    <Progress percent={used} size='small' status={used >= 100 ? 'exception' : 'normal'} />
                    {profile.rateLimits?.primary?.resetsAt && (
                      <Typography.Text type='secondary'>重置时间：{new Date(profile.rateLimits.primary.resetsAt * 1000).toLocaleString()}</Typography.Text>
                    )}
                  </div>
                  )
                : <Typography.Paragraph type='secondary'>额度信息暂不可用，可点击刷新重试。</Typography.Paragraph>}
              {profile.error && <Alert type='warning' showIcon className='mg1b' title={profile.error} />}
              <Space wrap>
                {!current && <Button size='small' disabled={unavailable || profile.authState !== 'authenticated'} onClick={() => select(profile.profileId)}>设为当前账号</Button>}
                <Button size='small' disabled={unavailable} onClick={() => refresh(profile.profileId)}>刷新账号/额度</Button>
                {profile.authState !== 'authorizing' && <Button size='small' disabled={unavailable} onClick={() => startLogin('browser', profile)}>重新授权</Button>}
                {profile.authState === 'authenticated' && <Button size='small' disabled={unavailable} onClick={() => logout(profile.profileId)}>退出登录</Button>}
                <Button size='small' danger disabled={unavailable} onClick={() => remove(profile.profileId)}>删除本地账号</Button>
              </Space>
            </Card>
          )
        })}
      </Space>
    </div>
  )
}

function runtimeTitle (runtime) {
  if (runtime.state === 'downloading') return '正在下载 Codex 运行时'
  if (runtime.state === 'verifying') return '正在校验并初始化 Codex 运行时'
  if (runtime.state === 'failed') return 'Codex 运行时安装失败，可再次点击账号按钮重试'
  return 'Codex 运行时尚未安装'
}

function formatBytes (bytes) {
  const value = Number(bytes || 0)
  if (value < 1024 * 1024) return `${Math.max(0, Math.round(value / 1024))} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}
