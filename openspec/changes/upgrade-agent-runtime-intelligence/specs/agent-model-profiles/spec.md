## Purpose

定义 Agent 模型角色、配置字段、Provider 能力探测、任务快照、兼容等级和安全降级，使用户能够判断当前 AI 配置是否适合自动运维 Agent。

## ADDED Requirements

### Requirement: 系统界面语言和 AI 回答语言必须独立可配置

系统界面语言 SHALL 保留在通用设置首屏并控制应用 UI locale；AI 回答语言 SHALL 位于 AI 配置并只控制模型面向用户的回答语言。调整 Agent 模型配置、Harness 或 Provider preset MUST NOT 隐藏、覆盖或迁移系统界面语言。

#### Scenario: 用户配置 Agent 后切换系统语言

- **GIVEN** 用户已经保存 Provider、模型和 AI 回答语言
- **WHEN** 用户打开通用设置
- **THEN** 首屏可见系统界面语言选择器
- **WHEN** 用户切换系统界面语言并重载应用
- **THEN** 应用 UI 使用新语言
- **AND** Provider、模型及 AI 回答语言保持不变

### Requirement: Agent 模型必须按职责配置

系统 SHALL 支持 Fast、Planner 和 Summarizer 三类 model profile，并将 Verifier 保持为确定性代码。Planner MUST 配置；Fast 和 Summarizer MAY 显式配置，也 MAY 继承 Planner。

#### Scenario: 用户只有一个模型

- **GIVEN** 旧设置只包含一个可用模型
- **WHEN** 系统迁移到 V2 profile
- **THEN** 该模型成为 Planner
- **AND** Fast/Summarizer 默认继承 Planner
- **AND** 不要求用户重复输入凭据

### Requirement: Profile 必须声明运行限制

每个 profile MUST 声明 model、context window、max output tokens、turn timeout、streaming、structured mode 和 provider profile。Reasoning effort、temperature 和 prompt caching 若 Provider 支持 MAY 配置。系统 MUST 根据最终序列化请求校验 context 预算。

#### Scenario: 配置的输出预算超过 Provider 限制

- **GIVEN** 用户配置 8k 输出但能力报告只验证到 4k
- **WHEN** 保存设置或创建 task
- **THEN** 系统阻止不一致配置或将其明确收敛到 4k
- **AND** UI 显示限制来源

### Requirement: 保存配置时必须执行无工具能力探测

系统 SHALL 探测 endpoint/认证、流式完成、结构化 Planner 输出、错误分类、取消和声明限制。Probe MUST NOT 创建 ToolIntent、访问 SSH/SFTP/MCP、加载服务器 Evidence 或执行任何服务器命令。

#### Scenario: 模型能聊天但不能稳定输出结构动作

- **GIVEN** endpoint 能返回普通文本
- **AND** 最小 Planner schema 测试失败
- **WHEN** capability probe 完成
- **THEN** 配置等级为 limited
- **AND** 只能用于 suggestion mode，不得用固定查询模板冒充模型理解
- **AND** 不得进入模型驱动的自动执行循环

### Requirement: 能力报告必须与配置快照绑定

Capability Report MUST 包含 schema version、profile hash、探测时间、结果、失败原因和过期时间。Base URL、账号 profile、model、structured mode 或关键限制变化后，旧报告 MUST 失效。

#### Scenario: 用户更换模型 ID

- **GIVEN** 原模型拥有 automatic 报告
- **WHEN** 用户修改 profile 的 model id
- **THEN** 系统将能力状态标记为 unverified
- **AND** 新自动 Agent task 在完成探测前不得启动

### Requirement: 任务必须冻结模型和能力配置

task 创建时 MUST 固定 backend type、provider profile、各角色 model、reasoning、timeout、context 和 capability report id。运行中设置变化 MUST 只影响新 task。

#### Scenario: 任务运行时用户修改 Planner

- **GIVEN** task 正使用模型 A
- **WHEN** 用户将设置改为模型 B
- **THEN** 当前 task 继续使用冻结的模型 A 配置
- **AND** 新 task 使用模型 B 并要求对应 capability report

### Requirement: 已保存的 Agent 开关必须同步到主进程

Renderer 保存 Agent 配置后，主进程 SHALL 让新 task 使用最新 admission 与 policy。设置页 MUST 等待完整 AI 配置持久化成功后才显示“已保存”并关闭；应用重启后 MUST 恢复相同的后端、账号和 Agent 开关。应用重启后恢复出的历史 `paused` task MUST NOT 阻止配置刷新。若真正运行中的 task 要求延迟 policy 更新，系统 MUST 保存最新待应用配置，并在阻塞 task 进入 paused 或 terminal 后自动应用；系统 MUST NOT 让设置页长期显示已启用而新 task 返回 `AGENT_DISABLED`。

#### Scenario: 保存后立即重启

- **GIVEN** 用户选择了已授权的 Codex Subscription 账号并开启终端 Agent
- **WHEN** 用户点击“仅保存”或“测试并保存”
- **THEN** 设置页 SHALL 在加密配置写入完成后才提示保存成功
- **AND** 应用立即重启后 SHALL 仍选择同一后端、账号并保持终端 Agent 开启

#### Scenario: 历史暂停任务与新配置同时存在

- **GIVEN** 应用启动时恢复了一个或多个历史 `paused` task
- **AND** 用户保存 `agentModeEnabled=true`
- **WHEN** 用户从当前终端创建新 Agent task
- **THEN** 新 task SHALL 通过 Agent admission
- **AND** 历史 paused task 保持暂停，不得被自动恢复或执行

#### Scenario: 运行中任务暂缓 policy 更新

- **GIVEN** 一个 Agent task 正在执行并冻结旧 policy
- **WHEN** 用户保存新的 Agent policy 配置
- **THEN** 当前 task 继续使用已冻结配置
- **AND** 主进程保存最新待应用配置
- **WHEN** 所有阻塞 task 进入 paused 或 terminal
- **THEN** 新 policy SHALL 自动应用于后续 task

### Requirement: AI 后端必须保持显式互斥

OpenAI Compatible/API Key 与 Codex Subscription SHALL 保持显式互斥。Provider 超时、限流、结构错误或 session 失效时，系统 MUST NOT 静默切换到另一个后端、账号、模型或计费路径。

#### Scenario: Codex Subscription 暂时不可用

- **GIVEN** task 固定使用 Codex Subscription
- **WHEN** App Server 返回认证失败
- **THEN** 系统报告当前后端不可用并停止新动作
- **AND** 不使用已保存的 API Key 继续任务

### Requirement: 活动 AI 后端必须与产品入口一致

系统 SHALL 只创建 OpenAI Compatible 或 Codex Subscription Provider。历史配置中的 `agentHarnessAdapter=strands` SHALL 在加载时确定性归一化为 `openai_compatible`，且迁移 MUST NOT 改变 AI 账号、当前账号选择、Agent 启用状态或其他有效设置。历史记录中的 `strands` 标识 MAY 被动读取，但新配置和新任务 MUST NOT 再写入该标识或加载 Strands 运行时。

#### Scenario: 旧 Strands 配置升级

- **GIVEN** 已保存配置包含 `agentHarnessAdapter=strands`、已启用 Agent 和已选择账号
- **WHEN** 1.0.27 加载并保存 AI 配置
- **THEN** 有效 Harness 使用 OpenAI Compatible
- **AND** 账号集合、当前账号和 Agent 开关保持不变
- **AND** 新写入配置不包含 Strands 选择

#### Scenario: 读取历史 Strands 记录

- **GIVEN** 历史 task 或指标记录包含 `providerType=strands`
- **WHEN** 1.0.27 展示或聚合该记录
- **THEN** 系统安全解析该只读标识
- **AND** 不导入 Strands SDK、不创建 Provider Session，也不执行历史动作

### Requirement: Provider 会话必须应用选择的模型参数

adapter MUST 将 task snapshot 中的 model、reasoning effort、timeout 和结构化输出模式传给 Provider。无法支持的字段 MUST 在 capability probe 或 task 创建时明确报告，MUST NOT 静默忽略关键安全字段。

#### Scenario: Codex profile 选择高 reasoning

- **GIVEN** capability report 声明该模型支持 high reasoning
- **WHEN** 创建 Codex task thread/turn
- **THEN** App Server 请求包含显式 model 和 high reasoning 配置
- **AND** 后续 turn 保持相同快照

### Requirement: 结构错误修复必须有界

Planner 输出结构无效时，系统 MAY 在同一 Provider Session 内进行一次结构修复。第二次失败 SHALL 降级为 suggestion/inconclusive，MUST NOT 执行任何部分动作。Transport、认证、context 和 timeout 错误 MUST NOT 被误送入结构修复。

#### Scenario: Provider 返回两次无效 JSON

- **GIVEN** 首次 Planner 输出无法解码
- **WHEN** 一次结构修复仍失败
- **THEN** task 不产生 ToolIntent
- **AND** UI 显示安全降级及可调整配置项

### Requirement: 配置界面必须给出适用性建议

设置页 SHALL 展示 automatic/limited/unavailable、已验证能力、失败项目、最近探测时间和推荐调整。建议 MUST 基于实际 probe 和预算，不得仅根据模型名称硬编码宣传性判断。

#### Scenario: context window 过小

- **GIVEN** 模型通过流式和 schema 测试但 context 不足以容纳最小 Planner prompt 与保留输出
- **WHEN** 系统生成报告
- **THEN** 报告说明最小需要量和当前可用量
- **AND** 自动 Agent 等级不可用
- **AND** 普通聊天设置仍可保留
