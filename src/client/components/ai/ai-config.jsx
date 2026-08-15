import {
  Form,
  Input,
  Button,
  AutoComplete,
  Alert,
  Space,
  Dropdown,
  Switch,
  Select,
  Segmented
} from 'antd'
import { useEffect, useState } from 'react'
import { DownOutlined } from '@ant-design/icons'
import Link from '../common/external-link'
import AiCache from './ai-cache'
import {
  aiConfigWikiLink
} from '../../common/constants'
import Password from '../common/password'
import AiHistory, { addHistoryItem } from './ai-history'
import message from '../common/message'
import { getAIPresets } from './ai-config-props'
import { appendMandatoryGuardrails } from './ai-guardrails'
import CodexAccountOverview from './codex-accounts/codex-account-overview'

const STORAGE_KEY_CONFIG = 'ai_config_history'
const EVENT_NAME_CONFIG = 'ai-config-history-update'

const e = window.translate
const defaultRoles = [
  {
    value: 'Terminal expert, provide commands for different OS, explain usage briefly, use markdown format'
  },
  {
    value: '终端专家,提供不同系统下命令,简要解释用法,用markdown格式'
  }
]

const proxyOptions = [
  { value: 'socks5://127.0.0.1:1080' },
  { value: 'http://127.0.0.1:8080' },
  { value: 'https://proxy.example.com:3128' }
]

const authHeaderOptions = [
  { value: 'Authorization: Bearer' },
  { value: 'x-api-key' },
  { value: 'api-key' },
  { value: 'Authorization: Api-Key' },
  { value: 'Authorization' }
]

export default function AIConfigForm ({ initialValues, onSubmit, showAIConfig }) {
  const [form] = Form.useForm()
  const [testing, setTesting] = useState(false)
  const baseURLAI = Form.useWatch('baseURLAI', form)
  const agentModeEnabled = Form.useWatch('agentModeEnabled', form)
  const agentHarnessAdapter = Form.useWatch('agentHarnessAdapter', form)
  const aiBackendType = Form.useWatch('aiBackendType', form) || initialValues?.aiBackendType || 'openai_compatible'

  useEffect(() => {
    if (initialValues) {
      form.setFieldsValue({ aiBackendType: 'openai_compatible', ...initialValues })
    }
  }, [initialValues])

  useEffect(() => {
    if (agentHarnessAdapter === 'strands' && isDashScopeEndpoint(baseURLAI)) {
      form.setFieldValue('agentHarnessAdapter', 'openai_compatible')
    }
  }, [agentHarnessAdapter, baseURLAI])

  function filter () {
    return true
  }

  const handleSubmit = async (values) => {
    const normalized = {
      ...initialValues,
      ...values,
      aiBackendType: values.aiBackendType === 'codex_subscription' ? 'codex_subscription' : 'openai_compatible',
      agentMutationEnabled: values.agentModeEnabled && values.agentMutationEnabled,
      agentExternalMcpEnabled: values.agentModeEnabled && values.agentExternalMcpEnabled
    }
    onSubmit(normalized)
    if (normalized.aiBackendType === 'openai_compatible') addHistoryItem(STORAGE_KEY_CONFIG, normalized, EVENT_NAME_CONFIG)
  }

  const handleTest = async () => {
    try {
      const values = await form.validateFields()
      setTesting(true)
      if (values.aiBackendType === 'codex_subscription') {
        if (!values.codexProfileId) throw new Error('请先选择并授权一个 Codex 账号')
        const profile = await window.api.codex.refreshAccount({ schemaVersion: 1, profileId: values.codexProfileId })
        if (profile.authState !== 'authenticated') throw new Error('Codex 账号尚未完成授权')
        message.success('Codex Subscription 配置可用')
        return
      }
      const res = await window.pre.runGlobalAsync(
        'AIchat',
        'Hi',
        values.modelAI,
        appendMandatoryGuardrails(values.roleAI),
        values.baseURLAI,
        values.apiPathAI,
        values.apiKeyAI,
        values.proxyAI,
        false,
        values.authHeaderNameAI
      )
      if (res && res.error) {
        message.error(res.error)
      } else if (res && res.response) {
        message.success('AI config works!')
      } else {
        message.error('Unexpected response from AI API')
      }
    } catch (e) {
      if (e.message) {
        message.error(e.message)
      }
    } finally {
      setTesting(false)
    }
  }

  function handleSelectHistory (item) {
    if (item && typeof item === 'object') {
      form.setFieldsValue(item)
    }
  }

  function handleSelectPreset (preset) {
    const fields = ['nameAI', 'baseURLAI', 'apiPathAI', 'modelAI', 'authHeaderNameAI', 'modelAI', 'apiKeyAI']
    const values = { aiBackendType: 'openai_compatible' }
    fields.forEach(f => {
      if (preset[f] !== undefined) {
        values[f] = preset[f]
      }
    })
    form.setFieldsValue(values)
  }

  function renderPresetMenu () {
    const presets = getAIPresets()
    const items = presets.map(p => ({
      key: p.id,
      label: p.nameAI,
      onClick: () => handleSelectPreset(p)
    }))
    return (
      <Dropdown menu={{ items }} trigger={['click']}>
        <Button>
          {e('presets') || 'Presets'} <DownOutlined />
        </Button>
      </Dropdown>
    )
  }

  function renderHistoryItem (item) {
    if (!item || typeof item !== 'object') return { label: 'Unknown', title: 'Unknown' }
    const name = item.nameAI || ''
    const model = item.modelAI || 'Default Model'
    const rolePrefix = item.roleAI ? item.roleAI.substring(0, 15) + '...' : ''
    const label = name || `[${model}] ${rolePrefix}`
    const title = name
      ? `${name}\nModel: ${item.modelAI}\nURL: ${item.baseURLAI}`
      : `Model: ${item.modelAI}\nRole: ${item.roleAI}\nURL: ${item.baseURLAI}`
    return { label, title }
  }

  function renderApiKeyLabel () {
    if (baseURLAI === 'https://api.atlascloud.ai/v1') {
      return <span className='bold'>API Key (<Link to='https://www.atlascloud.ai/?utm_source=electerm_app&utm_medium=link&utm_campaign=electerm'>get API key from atlascloud</Link>)</span>
    }
    if (baseURLAI === 'https://ai.electerm.org/api/ai') {
      return <span className='bold'>API Key (<Link to='https://ai.electerm.org?utm=electerm'>get API key from ai.electerm.org(free)</Link>)</span>
    }
    return 'API Key'
  }

  if (!showAIConfig) {
    return null
  }
  const defaultLangs = window.store.getLangNames().map(l => ({ value: l }))
  return (
    <>
      <Alert
        title={
          <Link to={aiConfigWikiLink}>WIKI: {aiConfigWikiLink}</Link>
        }
        type='info'
        className='mg2t mg1b'
      />
      <Alert
        title={
          window.translate('aiWarn')
        }
        type='warning'
        className='mg2b'
      />
      {aiBackendType === 'openai_compatible' && (
        <>
          <div className='mg1b alignright'>
            {renderPresetMenu()}
          </div>
          <p>Full Url: {baseURLAI}{form.getFieldValue('apiPathAI')}</p>
        </>
      )}
      <Form
        form={form}
        onFinish={handleSubmit}
        initialValues={initialValues}
        layout='vertical'
        className='ai-config-form'
      >
        <Form.Item label='当前 AI 类型' name='aiBackendType' rules={[{ required: true }]}>
          <Segmented
            block
            options={[
              { value: 'openai_compatible', label: 'API Key / OpenAI Compatible' },
              { value: 'codex_subscription', label: 'ChatGPT / Codex Subscription' }
            ]}
          />
        </Form.Item>
        {aiBackendType === 'openai_compatible' && (
          <>
            <Form.Item label='Name' name='nameAI'>
              <Input placeholder='e.g. DeepSeek Relay, Local Ollama (optional)' />
            </Form.Item>
            <Form.Item label='API URL' required>
              <Space.Compact className='width-100'>
                <Form.Item
                  label='API URL'
                  name='baseURLAI'
                  noStyle
                  rules={[
                    { required: true, message: 'Please input or select API provider URL!' },
                    { type: 'url', message: 'Please enter a valid URL!' }
                  ]}
                >
                  <Input
                    placeholder='Enter API provider URL'
                    style={{ width: '75%' }}
                  />
                </Form.Item>
                <Form.Item
                  label='API PATH'
                  name='apiPathAI'
                  rules={[
                    { required: true, message: 'Please input API PATH' }
                  ]}
                  noStyle
                >
                  <Input
                    placeholder='/chat/completions'
                    style={{ width: '25%' }}
                  />
                </Form.Item>
              </Space.Compact>
            </Form.Item>
            <Form.Item label={e('modelAi')} name='modelAI' rules={[{ required: true, message: 'Please input or select a model!' }]}>
              <Input placeholder='Enter or select AI model' />
            </Form.Item>
          </>
        )}
        {aiBackendType === 'codex_subscription' && (
          <>
            <Form.Item
              label='高级：自定义 Codex App Server（可选）'
              name='codexAppServerExecutable'
              tooltip='默认使用安装包内置的固定版本；仅在高级诊断时填写可信的本机绝对路径。'
            >
              <Input placeholder='通常留空，使用安装包内置版本' />
            </Form.Item>
            <Form.Item name='codexProfileId' rules={[{ required: true, message: '请添加并选择一个 Codex 账号' }]}>
              <CodexAccountOverview />
            </Form.Item>
          </>
        )}
        <Alert
          type='info'
          showIcon
          className='mg2b'
          title='实验性 Agent Harness'
          description='开启 Agent 能力后，可在每个终端标签页选择 Shell模式或 Agent模式；Agent 可自动执行有界低风险只读探查，变更、敏感、网络和交互动作仍由主进程策略确认或阻断。'
        />
        <Form.Item label='启用 Agent 能力' name='agentModeEnabled' valuePropName='checked'>
          <Switch />
        </Form.Item>
        {aiBackendType === 'openai_compatible' && (
          <>
            <Form.Item label='Harness 适配器' name='agentHarnessAdapter'>
              <Select
                disabled={!agentModeEnabled} options={[
                  { value: 'openai_compatible', label: 'OpenAI Compatible（推荐）' },
                  { value: 'strands', label: 'Strands（实验性）', disabled: isDashScopeEndpoint(baseURLAI) },
                  { value: 'strict_json', label: 'Strict JSON 降级' }
                ]}
              />
            </Form.Item>
            {isDashScopeEndpoint(baseURLAI) && (
              <Alert type='info' showIcon className='mg2b' title='DashScope 使用 OpenAI Compatible Harness' description='仍使用当前配置的同一 API 地址、模型和 API Key，仅避开已知不兼容的 Strands 传输路径。' />
            )}
          </>
        )}
        {aiBackendType === 'codex_subscription' && (
          <Alert type='success' showIcon className='mg2b' title='Harness：官方 Codex App Server（固定）' description='目标服务器动作仍由 OpsHalo Tool Gateway 检查、审批、执行和验证。' />
        )}
        <Form.Item label='允许逐次审批的变更动作' name='agentMutationEnabled' valuePropName='checked'>
          <Switch disabled={!agentModeEnabled} />
        </Form.Item>
        <Form.Item label='允许外部 MCP Agent 工具' name='agentExternalMcpEnabled' valuePropName='checked'>
          <Switch disabled={!agentModeEnabled} />
        </Form.Item>
        {aiBackendType === 'openai_compatible' && (
          <Form.Item label='Strands 失败时回退到同供应商兼容适配器' name='agentCompatibleFallbackEnabled' valuePropName='checked'>
            <Switch disabled={!agentModeEnabled} />
          </Form.Item>
        )}

        {aiBackendType === 'openai_compatible' && (
          <>
            <Form.Item
              label={renderApiKeyLabel()}
              name='apiKeyAI'
            >
              <Password placeholder='Enter your API key' />
            </Form.Item>

            <Form.Item
              label='Auth Header'
              name='authHeaderNameAI'
              tooltip='Header format for API authentication. e.g. "Authorization: Bearer" sends "Authorization: Bearer <key>", "x-api-key" sends "x-api-key: <key>"'
            >
              <AutoComplete
                options={authHeaderOptions}
                filterOption={filter}
              >
                <Input placeholder='e.g. Authorization: Bearer' />
              </AutoComplete>
            </Form.Item>

            <Form.Item
              label={e('roleAI')}
              name='roleAI'
              rules={[{ required: true, message: 'Please input the AI role!' }]}
            >
              <AutoComplete options={defaultRoles} placement='topLeft'>
                <Input.TextArea
                  placeholder='Enter AI role/system prompt'
                  rows={1}
                />
              </AutoComplete>
            </Form.Item>

            <Form.Item
              label={e('language')}
              name='languageAI'
              rules={[{ required: true, message: 'Please input language' }]}
            >
              <AutoComplete options={defaultLangs} placement='topLeft'>
                <Input
                  placeholder={e('language')}
                />
              </AutoComplete>
            </Form.Item>

            <Form.Item
              label={e('proxy')}
              name='proxyAI'
              tooltip='Proxy for AI API requests (e.g., socks5://127.0.0.1:1080)'
            >
              <AutoComplete
                options={proxyOptions}
                filterOption={filter}
                allowClear
              >
                <Input placeholder='Enter proxy URL (optional)' />
              </AutoComplete>
            </Form.Item>
          </>
        )}

        <Form.Item>
          <Space>
            <Button type='primary' htmlType='submit'>
              {e('save')}
            </Button>
            <Button
              loading={testing}
              onClick={handleTest}
            >
              {e('testConnection')}
            </Button>
          </Space>
        </Form.Item>
      </Form>
      {aiBackendType === 'openai_compatible' && (
        <>
          <AiHistory
            storageKey={STORAGE_KEY_CONFIG}
            eventName={EVENT_NAME_CONFIG}
            onSelect={handleSelectHistory}
            renderItem={renderHistoryItem}
          />
          <AiCache />
        </>
      )}
    </>
  )
}

function isDashScopeEndpoint (value) {
  try {
    return /(?:^|\.)dashscope\.aliyuncs\.com$/i.test(new URL(String(value || '')).hostname)
  } catch (_) {
    return false
  }
}
