import {
  Form,
  Input,
  Button,
  AutoComplete,
  Alert,
  Space,
  Switch,
  Select,
  Segmented,
  InputNumber,
  Collapse
} from 'antd'
import { useEffect, useState } from 'react'
import Link from '../common/external-link'
import AiCache from './ai-cache'
import Password from '../common/password'
import AiHistory, { addHistoryItem } from './ai-history'
import message from '../common/message'
import { getAIPresets } from './ai-config-props'
import { appendMandatoryGuardrails } from './ai-guardrails'
import CodexAccountOverview from './codex-accounts/codex-account-overview'

const STORAGE_KEY_CONFIG = 'ai_config_history'
const EVENT_NAME_CONFIG = 'ai-config-history-update'

const AGENT_DEFAULTS = {
  agentGroundedSynthesisEnabled: true,
  agentFastModel: '',
  agentMaxContextTokens: 32000,
  agentMaxOutputTokens: 2048,
  agentModelTimeoutMs: 30000,
  agentSynthesisTimeoutMs: 15000,
  agentStreamingEnabled: true,
  agentReasoningEffort: 'medium',
  agentStructuredMode: 'native-tools',
  agentTemperature: 0.2,
  agentPromptCacheEnabled: true,
  agentSkillsEnabled: true,
  agentSkillDirectories: '',
  agentKnowledgeEnabled: false,
  agentKnowledgeSources: '',
  agentKnowledgeEmbeddingMode: 'off'
}

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

const CAPABILITY_FIELDS = new Set([
  'aiBackendType', 'baseURLAI', 'apiPathAI', 'modelAI', 'codexProfileId',
  'agentFastModel', 'agentPlannerModel', 'agentMaxContextTokens', 'agentMaxOutputTokens',
  'agentModelTimeoutMs', 'agentStreamingEnabled', 'agentStructuredMode',
  'agentReasoningEffort', 'agentTemperature', 'agentPromptCacheEnabled'
])

export default function AIConfigForm ({ initialValues, onSubmit, showAIConfig }) {
  const [form] = Form.useForm()
  const [testing, setTesting] = useState(false)
  const [capabilityReport, setCapabilityReport] = useState(null)
  const [providerPresetId, setProviderPresetId] = useState('custom')
  const baseURLAI = Form.useWatch('baseURLAI', form)
  const agentModeEnabled = Form.useWatch('agentModeEnabled', form)
  const agentSkillsEnabled = Form.useWatch('agentSkillsEnabled', form)
  const agentKnowledgeEnabled = Form.useWatch('agentKnowledgeEnabled', form)
  const aiBackendType = Form.useWatch('aiBackendType', form) || initialValues?.aiBackendType || 'openai_compatible'

  useEffect(() => {
    if (initialValues) {
      const hydrated = { ...AGENT_DEFAULTS, aiBackendType: 'openai_compatible', ...initialValues }
      form.setFieldsValue(hydrated)
      setProviderPresetId(detectProviderPreset(hydrated.baseURLAI))
    }
  }, [initialValues])

  function filter () {
    return true
  }

  const handleSubmit = async (values) => {
    const safeInitialValues = { ...(initialValues || {}) }
    delete safeInitialValues.agentHarnessAdapter
    delete safeInitialValues.agentCompatibleFallbackEnabled
    const normalized = {
      ...safeInitialValues,
      ...values,
      aiBackendType: values.aiBackendType === 'codex_subscription' ? 'codex_subscription' : 'openai_compatible',
      agentMutationEnabled: values.agentModeEnabled && values.agentMutationEnabled,
      agentExternalMcpEnabled: values.agentModeEnabled && values.agentExternalMcpEnabled
    }
    try {
      await onSubmit(normalized)
      if (normalized.aiBackendType === 'openai_compatible') addHistoryItem(STORAGE_KEY_CONFIG, normalized, EVENT_NAME_CONFIG)
      return true
    } catch (error) {
      message.error(error?.safeMessage || error?.message || 'AI 配置保存失败，请重试')
      return false
    }
  }

  const handleTest = async () => {
    try {
      const values = await form.validateFields()
      setTesting(true)
      if (values.aiBackendType === 'codex_subscription') {
        if (!values.codexProfileId) throw new Error('请先选择并授权一个 Codex 账号')
        const profile = await window.api.codex.refreshAccount({ schemaVersion: 1, profileId: values.codexProfileId })
        if (profile.authState !== 'authenticated') throw new Error('Codex 账号尚未完成授权')
        if (!await handleSubmit(values)) return
        message.success('Codex Subscription 配置可用')
        return
      }
      if (values.agentModeEnabled) {
        const report = await window.pre.runGlobalAsync('probeAgentModel', values)
        setCapabilityReport(report)
        form.setFieldsValue({
          agentCapabilityLevel: report.level,
          agentCapabilityCheckedAt: report.checkedAt,
          agentCapabilityExpiresAt: report.expiresAt,
          agentCapabilityProfileHash: report.profileHash
        })
        if (report.level === 'automatic') message.success('Agent 模型流式与结构化能力验证通过')
        else if (report.level === 'limited') message.warning(report.message)
        else message.error(report.message)
        if (report.level !== 'unavailable') await handleSubmit({ ...values, agentCapabilityLevel: report.level, agentCapabilityCheckedAt: report.checkedAt, agentCapabilityExpiresAt: report.expiresAt, agentCapabilityProfileHash: report.profileHash })
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
        if (await handleSubmit(values)) message.success('AI config works!')
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
      setProviderPresetId(detectProviderPreset(item.baseURLAI))
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

  function handleProviderPreset (id) {
    setProviderPresetId(id)
    if (id === 'custom') return
    const preset = getAIPresets().find(item => item.id === id)
    if (preset) handleSelectPreset(preset)
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

  function renderEndpointFields () {
    return (
      <Form.Item label='接口地址' required>
        <Space.Compact className='width-100'>
          <Form.Item
            name='baseURLAI'
            noStyle
            rules={[
              { required: true, message: '请输入接口地址' },
              { type: 'url', message: '接口地址格式不正确' }
            ]}
          >
            <Input placeholder='https://example.com/v1' style={{ width: '75%' }} />
          </Form.Item>
          <Form.Item name='apiPathAI' noStyle rules={[{ required: true, message: '请输入 API 路径' }]}>
            <Input placeholder='/chat/completions' style={{ width: '25%' }} />
          </Form.Item>
        </Space.Compact>
      </Form.Item>
    )
  }

  function renderConnectionAdvanced (defaultLangs) {
    return (
      <>
        <Form.Item label='配置名称（可选）' name='nameAI'>
          <Input placeholder='例如：公司代理' />
        </Form.Item>
        {providerPresetId !== 'custom' && renderEndpointFields()}
        <Form.Item label='认证请求头' name='authHeaderNameAI'>
          <AutoComplete options={authHeaderOptions} filterOption={filter}>
            <Input placeholder='Authorization: Bearer' />
          </AutoComplete>
        </Form.Item>
        <Form.Item label='普通对话角色' name='roleAI' rules={[{ required: true, message: '请输入 AI 角色' }]}>
          <AutoComplete options={defaultRoles} placement='topLeft'>
            <Input.TextArea rows={2} />
          </AutoComplete>
        </Form.Item>
        <Form.Item label='回答语言' name='languageAI' rules={[{ required: true, message: '请选择回答语言' }]}>
          <AutoComplete options={defaultLangs} placement='topLeft'>
            <Input />
          </AutoComplete>
        </Form.Item>
        <Form.Item label='代理地址（可选）' name='proxyAI'>
          <AutoComplete options={proxyOptions} filterOption={filter} allowClear>
            <Input placeholder='socks5://127.0.0.1:1080' />
          </AutoComplete>
        </Form.Item>
      </>
    )
  }

  if (!showAIConfig) {
    return null
  }
  const defaultLangs = window.store.getLangNames().map(l => ({ value: l }))
  return (
    <>
      <Form
        form={form}
        onFinish={handleSubmit}
        initialValues={{ ...AGENT_DEFAULTS, ...initialValues }}
        layout='vertical'
        className='ai-config-form'
        onValuesChange={(changed) => {
          if (!Object.keys(changed).some(key => CAPABILITY_FIELDS.has(key))) return
          setCapabilityReport(null)
          form.setFieldsValue({ agentCapabilityLevel: '', agentCapabilityCheckedAt: '', agentCapabilityExpiresAt: '', agentCapabilityProfileHash: '' })
        }}
      >
        <Form.Item label='接入方式' name='aiBackendType' rules={[{ required: true }]}>
          <Segmented
            block
            options={[
              { value: 'openai_compatible', label: 'API Key' },
              { value: 'codex_subscription', label: 'ChatGPT / Codex 账号' }
            ]}
          />
        </Form.Item>
        {aiBackendType === 'openai_compatible' && (
          <>
            <Form.Item label='AI 服务商'>
              <Select
                value={providerPresetId}
                onChange={handleProviderPreset}
                options={[
                  ...getAIPresets().map(item => ({ value: item.id, label: item.nameAI })),
                  { value: 'custom', label: '自定义 OpenAI 兼容接口' }
                ]}
              />
            </Form.Item>
            {providerPresetId === 'custom' && renderEndpointFields()}
            <Form.Item label='模型' name='modelAI' rules={[{ required: true, message: '请输入模型名称' }]}>
              <Input placeholder='例如 qwen-plus' />
            </Form.Item>
            <Form.Item label={renderApiKeyLabel()} name='apiKeyAI' rules={[{ required: true, message: '请输入 API Key' }]}>
              <Password placeholder='API Key 仅保存在本机加密存储中' />
            </Form.Item>
          </>
        )}
        {aiBackendType === 'codex_subscription' && (
          <>
            <Form.Item
              label='高级：自定义 Codex App Server（可选）'
              name='codexAppServerExecutable'
              tooltip='通常留空，优先使用兼容的本机 Codex；未检测到时按需下载固定版本。仅在高级诊断时填写可信的本机绝对路径。'
            >
              <Input placeholder='通常留空，自动检测或按需下载' />
            </Form.Item>
            <Form.Item name='codexProfileId' rules={[{ required: true, message: '请添加并选择一个 Codex 账号' }]}>
              <CodexAccountOverview />
            </Form.Item>
          </>
        )}
        <Form.Item label='终端 Agent' name='agentModeEnabled' valuePropName='checked'>
          <Switch />
        </Form.Item>
        <Form.Item name='agentCapabilityLevel' hidden><Input /></Form.Item>
        <Form.Item name='agentCapabilityCheckedAt' hidden><Input /></Form.Item>
        <Form.Item name='agentCapabilityExpiresAt' hidden><Input /></Form.Item>
        <Form.Item name='agentCapabilityProfileHash' hidden><Input /></Form.Item>
        {capabilityReport && (
          <Alert
            type={capabilityReport.level === 'automatic' ? 'success' : capabilityReport.level === 'limited' ? 'warning' : 'error'}
            showIcon
            className='mg2b'
            title={`Agent 状态：${capabilityLevelLabel(capabilityReport.level)}`}
            description={[
              capabilityReport.message,
              Number.isFinite(capabilityReport.firstDeltaMs) ? `首次响应 ${capabilityReport.firstDeltaMs}ms。` : '',
              ...(capabilityReport.failures || []),
              ...(capabilityReport.recommendations || [])
            ].filter(Boolean).join(' ')}
          />
        )}
        <Form.Item label='允许执行变更（每次确认）' name='agentMutationEnabled' valuePropName='checked'>
          <Switch disabled={!agentModeEnabled} />
        </Form.Item>
        <Form.Item>
          <Space>
            <Button
              type='primary'
              loading={testing}
              onClick={handleTest}
            >
              测试并保存
            </Button>
            <Button htmlType='submit'>
              仅保存
            </Button>
          </Space>
        </Form.Item>
        <Collapse
          className='mg2b'
          items={[
            {
              key: 'agent',
              label: 'Agent 高级设置',
              children: (
                <>
                  <Form.Item label='快速模型（可选）' name='agentFastModel'>
                    <Input disabled={!agentModeEnabled} placeholder='留空，由规划模型处理短任务' />
                  </Form.Item>
                  <Form.Item label='规划模型（可选）' name='agentPlannerModel'>
                    <Input disabled={!agentModeEnabled} placeholder='留空，使用上面的模型' />
                  </Form.Item>
                  <Form.Item label='总结模型（可选）' name='agentSummarizerModel'>
                    <Input disabled={!agentModeEnabled} placeholder='留空，使用规划模型' />
                  </Form.Item>
                  <Space wrap className='width-100 mg1b'>
                    <Form.Item label='上下文 Tokens' name='agentMaxContextTokens'>
                      <InputNumber disabled={!agentModeEnabled} min={4096} max={1000000} step={4096} />
                    </Form.Item>
                    <Form.Item label='最大输出 Tokens' name='agentMaxOutputTokens'>
                      <InputNumber disabled={!agentModeEnabled} min={512} max={32768} step={512} />
                    </Form.Item>
                    <Form.Item label='规划超时（秒）' name='agentModelTimeoutMs' getValueProps={millisecondsToSeconds} normalize={secondsToMilliseconds}>
                      <InputNumber disabled={!agentModeEnabled} min={5} max={60} />
                    </Form.Item>
                    <Form.Item label='总结超时（秒）' name='agentSynthesisTimeoutMs' getValueProps={millisecondsToSeconds} normalize={secondsToMilliseconds}>
                      <InputNumber disabled={!agentModeEnabled} min={5} max={60} />
                    </Form.Item>
                    <Form.Item label='Temperature' name='agentTemperature'>
                      <InputNumber disabled={!agentModeEnabled} min={0} max={2} step={0.1} precision={1} />
                    </Form.Item>
                  </Space>
                  <Form.Item label='响应传输' name='agentStreamingEnabled' valuePropName='checked'>
                    <Switch disabled={!agentModeEnabled} checkedChildren='流式' unCheckedChildren='非流式' />
                  </Form.Item>
                  <Form.Item label='结构化模式' name='agentStructuredMode'>
                    <Select
                      disabled={!agentModeEnabled}
                      options={[
                        { value: 'native-tools', label: '原生工具调用' },
                        { value: 'json', label: '严格 JSON' }
                      ]}
                    />
                  </Form.Item>
                  <Form.Item label='推理强度' name='agentReasoningEffort'>
                    <Select
                      disabled={!agentModeEnabled}
                      options={[
                        { value: 'minimal', label: '最快' },
                        { value: 'low', label: '较快' },
                        { value: 'medium', label: '均衡' },
                        { value: 'high', label: '深入' }
                      ]}
                    />
                  </Form.Item>
                  <Form.Item label='证据化总结' name='agentGroundedSynthesisEnabled' valuePropName='checked'>
                    <Switch disabled={!agentModeEnabled} />
                  </Form.Item>
                  <Form.Item label='允许 Provider 提示缓存' name='agentPromptCacheEnabled' valuePropName='checked'>
                    <Switch disabled={!agentModeEnabled} />
                  </Form.Item>
                  <Form.Item label='外部 MCP 工具' name='agentExternalMcpEnabled' valuePropName='checked'>
                    <Switch disabled={!agentModeEnabled} />
                  </Form.Item>
                </>
              )
            },
            {
              key: 'knowledge',
              label: 'Skills 与本地知识库（可选）',
              children: (
                <>
                  <Form.Item label='启用 Skills' name='agentSkillsEnabled' valuePropName='checked'>
                    <Switch disabled={!agentModeEnabled} />
                  </Form.Item>
                  {agentSkillsEnabled && (
                    <Form.Item label='自定义 Skill 目录' name='agentSkillDirectories' tooltip='每行一个绝对路径；不填写时仍使用内置运维 Skills。'>
                      <Input.TextArea disabled={!agentModeEnabled} rows={2} placeholder='/Users/me/.opshalo/skills' />
                    </Form.Item>
                  )}
                  <Form.Item label='启用本地知识库' name='agentKnowledgeEnabled' valuePropName='checked'>
                    <Switch disabled={!agentModeEnabled} />
                  </Form.Item>
                  {agentKnowledgeEnabled && (
                    <>
                      <Form.Item label='知识文件或目录' name='agentKnowledgeSources' tooltip='每行一个绝对路径。'>
                        <Input.TextArea disabled={!agentModeEnabled} rows={3} placeholder='/Users/me/runbooks' />
                      </Form.Item>
                      <Form.Item label='检索方式' name='agentKnowledgeEmbeddingMode'>
                        <Segmented
                          disabled={!agentModeEnabled}
                          options={[
                            { value: 'off', label: '全文检索' },
                            { value: 'local', label: '本地混合检索' }
                          ]}
                        />
                      </Form.Item>
                    </>
                  )}
                </>
              )
            },
            ...(aiBackendType === 'openai_compatible'
              ? [{
                  key: 'connection',
                  label: '连接高级设置',
                  children: renderConnectionAdvanced(defaultLangs)
                }]
              : [])
          ]}
        />
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

function detectProviderPreset (baseURL) {
  const normalized = String(baseURL || '').replace(/\/+$/, '')
  const matched = getAIPresets().find(item => String(item.baseURLAI || '').replace(/\/+$/, '') === normalized)
  return matched?.id || 'custom'
}

function capabilityLevelLabel (level) {
  if (level === 'automatic') return '可自动执行'
  if (level === 'limited') return '仅建议模式'
  return '不可用'
}

function millisecondsToSeconds (value) {
  const milliseconds = Number(value)
  return { value: Number.isFinite(milliseconds) ? Math.round(milliseconds / 1000) : undefined }
}

function secondsToMilliseconds (value) {
  const seconds = Number(value)
  return Number.isFinite(seconds) ? Math.round(seconds * 1000) : undefined
}
