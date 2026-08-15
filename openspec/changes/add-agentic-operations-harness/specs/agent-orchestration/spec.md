## Purpose

定义 OpsHalo 如何将自然语言运维任务组织为可暂停、可恢复、可审计且有明确停止条件的多轮 ReAct 会话，并在不同模型能力下保持一致的安全行为。

## ADDED Requirements

### Requirement: Agent 任务绑定当前终端会话
系统 SHALL 将每个 Agent 任务绑定到创建任务时的标签页、连接标识、远端主机、登录用户和工作目录，未经用户明确发起的新任务不得自动跨主机或跨标签页执行。

#### Scenario: 当前会话被切换
- **GIVEN** Agent 任务已绑定主机 A 的标签页
- **WHEN** 用户切换到主机 B 或关闭原标签页
- **THEN** 系统 SHALL 暂停原任务并禁止把待执行动作发送到主机 B

### Requirement: 使用显式 ReAct 状态机
系统 MUST 使用可观测状态机管理 `Intake`、`Planning`、`PolicyCheck`、`Execute`、`AwaitApproval`、`Observe`、`Reduce`、`Evaluate`、`Verify` 和终止状态，任何工具调用都必须由合法状态转换触发。

#### Scenario: 只读探查完成一轮
- **GIVEN** Planner 生成了通过策略检查的有界只读动作
- **WHEN** 工具执行并返回 Observation
- **THEN** 系统 SHALL 依次进入 `Observe`、`Reduce`、`Evaluate`，再决定继续探查、验证或终止

### Requirement: Planner 输出结构化决策
系统 SHALL 要求 Planner 每轮返回结构化决策，至少包含目标状态、计划摘要、已知事实、缺失信息、单个下一动作、动作预期、完成判据和面向用户的决策摘要；无效结构不得直接触发执行。

#### Scenario: 模型返回无法解析的动作
- **GIVEN** 模型响应缺少工具名、参数或目标状态
- **WHEN** Harness 无法按约定模式校验响应
- **THEN** 系统 SHALL 在有限次数内请求结构修复，仍失败则降级为建议模式并停止自动执行

#### Scenario: Strands 连续返回无效结构
- **GIVEN** Strands 首次返回的 structured output 无法通过 PlannerDecision 校验
- **WHEN** 同一 Agent 的一次结构修复仍未得到有效决策
- **THEN** Harness SHALL 返回不含 ToolIntent 的安全建议决策、保留已确认事实与信息缺口并停止自动执行，不得将其升级为服务器或会话故障

### Requirement: 根据证据动态重规划
系统 SHALL 在每次 Observation 后更新已确认事实、待验证假设和信息缺口，并仅选择能够缩小信息缺口或验证完成判据的下一动作。

#### Scenario: 原命令在目标环境不可用
- **GIVEN** 工具返回 `command_not_found` 且任务仍有未解决的信息缺口
- **WHEN** 注册表中存在等价的结构化工具或平台兼容替代方案
- **THEN** 系统 SHALL 更新计划并尝试替代探查，且不得自动安装缺失软件

### Requirement: 单目标只读查询可走确定性快速通道
系统 SHALL 对高置信、单目标、已注册结构化只读工具可以完整回答的自然语言查询使用 Fast Query Lane；该通道仍必须经过 Tool Gateway、Policy、预算、Observation 和 Evidence，且不得生成通用 Shell、网络外发、交互或变更动作。诊断、原因分析、变更、目标歧义或低置信请求必须回到 Harness Planner。

#### Scenario: 查询 Docker 中的 nginx
- **GIVEN** 用户只要求列出 Docker 中名称或镜像匹配 nginx 的容器
- **WHEN** Router 能安全提取过滤词并匹配 `docker.list`
- **THEN** 系统 SHALL 执行一次有界只读工具并由结构化结果直接完成，不得为了总结再强制调用模型

#### Scenario: 排查 nginx 容器反复重启
- **GIVEN** 用户要求分析 nginx 容器反复重启的原因
- **WHEN** 输入同时包含诊断语义和容器目标
- **THEN** Router SHALL 拒绝快速完成并交给 Adaptive ReAct，后续根据容器状态、日志和配置证据动态规划

### Requirement: Planner 传输协议必须兼容 Provider 的 Schema 子集
系统 SHALL 将内部 PlannerDecision 与 Provider wire schema 分离。Provider wire 不得依赖任意键对象；动作参数和验证计划以有界 JSON 字符串传输并在本地解码、严格校验。所有 Harness Adapter SHALL 使用同一 wire/decode 语义，Provider Schema 不兼容不得被误报为服务器或上下文错误。

#### Scenario: Provider 不接受 propertyNames
- **GIVEN** 内部 ToolIntent 参数是动态 JSON 对象且 Provider 结构化输出不支持 `propertyNames`
- **WHEN** Harness 构造 Planner 请求
- **THEN** wire schema SHALL 使用 `argumentsJson`，响应在本地通过 JSON、PlannerDecision 和 Tool Registry 三层校验后才可产生动作

### Requirement: Harness 错误必须按明确证据分类
系统 MUST 优先使用 Provider 的 code、type 和 HTTP 状态分类错误，并使用互斥精确模式补充。Schema 报错文本中出现的普通 `context` 字样不得触发 `context_exhausted`；只有明确的 context-length/token-limit 代码或文本才可使用该类别。

#### Scenario: Schema 错误包含 In context
- **GIVEN** Provider 返回 `invalid_json_schema` 且消息包含 `In context=('properties', ...)`
- **WHEN** Harness 归一化错误
- **THEN** 系统 SHALL 返回 `invalid_model_output`/schema incompatibility，而不是 `context_exhausted`

### Requirement: 强制执行任务预算
系统 MUST 同时执行步骤、时间、自动只读动作、重复动作、连续错误、模型调用和输出量预算；默认最多 12 个 ReAct 步骤、5 分钟、8 个自动只读动作、同一动作重复 2 次和连续错误 3 次，硬上限不得超过 20 个步骤。

#### Scenario: 达到默认步骤预算
- **GIVEN** 任务已经执行 12 个 ReAct 步骤且用户未扩展预算
- **WHEN** Planner 再次请求工具动作
- **THEN** 系统 SHALL 拒绝继续自动执行，并以 `inconclusive` 或 `need_user` 状态总结已有证据和缺失信息

### Requirement: 检测无进展循环
系统 MUST 基于规范化工具名、参数、目标资源、错误类别和新增事实检测重复动作与无进展循环，达到阈值后不得继续重复执行。

#### Scenario: 相同失败动作重复出现
- **GIVEN** 同一规范化动作已连续两次返回等价错误且没有新增事实
- **WHEN** Planner 第三次提出该动作
- **THEN** 系统 SHALL 阻止该动作并要求切换策略、请求用户信息或以证据不足结束

### Requirement: 明确终止语义
系统 SHALL 仅以 `complete`、`inconclusive`、`need_user`、`blocked`、`failed`、`cancelled` 之一终止或暂停等待，并为状态提供证据摘要和原因；信息不足时不得使用 `complete`。

#### Scenario: 证据不足但预算已耗尽
- **GIVEN** 关键假设仍未验证且没有足够证据形成结论
- **WHEN** 任务预算耗尽
- **THEN** 系统 SHALL 返回 `inconclusive`，列出已确认内容、未确认内容和建议的下一次探查

### Requirement: 支持暂停、取消和受控恢复
系统 MUST 允许用户在任意非原子执行阶段暂停或取消任务，并将取消信号传播到 Harness、队列和执行器；恢复时必须重新确认会话身份、预算和待审批动作是否仍有效。

#### Scenario: 用户在长日志查询中取消
- **GIVEN** Agent 正在执行可取消的日志工具
- **WHEN** 用户点击停止
- **THEN** 系统 SHALL 中止执行、停止后续模型调用、保留已获得证据并将任务标记为 `cancelled`

#### Scenario: Ctrl+C 触发统一取消链路
- **GIVEN** Agent 正在模型生成、排队工具、自动探查、等待审批或执行工具
- **WHEN** UI 将无文本选择的 `Ctrl+C` 映射为任务取消
- **THEN** Session Manager SHALL 使用与停止按钮相同的取消链路，停止新动作并将 AbortSignal 传播到 Harness、Gateway 和可取消执行器

#### Scenario: 应用在任务中途重启
- **GIVEN** Agent 任务处于非终止状态且已有持久化快照
- **WHEN** OpsHalo 重启并重新加载该任务
- **THEN** 系统 SHALL 将任务恢复为 `paused`，废弃旧审批和执行能力，且仅在用户主动恢复并重新校验会话后继续规划

#### Scenario: 用户在 Agent 活跃时手工操作终端
- **GIVEN** Agent 正在规划、探查或等待审批
- **WHEN** 用户确认要向同一终端发送手工输入
- **THEN** 系统 SHALL 先暂停 Agent、使待审批动作失效，并在后续恢复时重新探查可能变化的环境

### Requirement: 按模型能力安全降级
系统 SHALL 通过统一 Harness 接口支持 Strands 和现有 OpenAI 兼容模型；不支持工具调用的模型可使用严格 JSON 动作协议，无法稳定满足结构约束的模型只能提供命令建议。

#### Scenario: 模型不支持原生工具调用
- **GIVEN** 已配置模型不声明原生 tool-calling 能力
- **WHEN** 用户开启 Agent 模式
- **THEN** 系统 SHALL 先验证其结构化 JSON 输出能力，通过后才允许进入受策略约束的自动只读模式

### Requirement: AI 后端类型必须显式选择且互斥
系统 SHALL 保留现有 OpenAI Compatible/API Key 配置，并增加通过官方 Codex App Server 使用 ChatGPT/Codex 订阅账号的后端类型；用户必须显式选择当前生效类型，任一时刻只能启用一个。切换类型 SHALL 保留非当前类型的已保存配置，但系统 MUST NOT 同时调用两个类型、跨类型自动回退或把订阅登录态转换为普通 API Key 调用。

#### Scenario: 用户选择 Codex Subscription
- **GIVEN** 用户已分别保存 API Key 配置和一个已授权 Codex 账号
- **WHEN** 用户将当前 AI 类型切换为 `Codex Subscription`
- **THEN** 后续新建 Agent task SHALL 只使用所选 Codex profile 的 App Server，且不得同时调用或自动回退到 API Key Provider

#### Scenario: 当前类型不可用
- **GIVEN** 当前选择的 Codex App Server 不可启动或登录已失效
- **WHEN** 用户发起 Agent task
- **THEN** 系统 SHALL 返回可恢复的配置错误并引导重新授权或手工切换类型，不得静默使用已保存的 API Key

### Requirement: Codex 订阅账号使用官方认证生命周期
系统 SHALL 仅通过官方 Codex App Server 发起浏览器 OAuth 或设备码登录，并通过其账号与额度接口读取脱敏账号状态。每个账号 SHALL 使用隔离 profile，切换账号不得改写用户全局 Codex 登录文件；账号切换时已有非终止任务必须先安全取消或完成，不能在同一任务中途更换推理身份。

#### Scenario: 添加 Codex 订阅账号
- **GIVEN** 用户选择添加 Codex 账号
- **WHEN** 官方登录流程完成
- **THEN** 系统 SHALL 保存 profile 标识和脱敏账号摘要、显示套餐与额度状态，并不得在 Renderer、普通日志或模型上下文中暴露 OAuth Token

#### Scenario: 活跃任务期间切换账号
- **GIVEN** 当前 Codex profile 正在执行非终止 Agent task
- **WHEN** 用户选择另一个 Codex profile
- **THEN** 系统 SHALL 阻止立即切换并要求先通过统一取消与必要验证链路结束当前任务

### Requirement: Codex App Server 中断接入统一取消链
系统 MUST 将活跃 Codex turn 的停止操作映射为 App Server `turn/interrupt`，并同时撤销后续本地 effect；中断成功、超时或进程退出都必须归一化为现有 Harness/Session 取消语义。

#### Scenario: Ctrl+C 中断 Codex turn
- **GIVEN** 当前 Agent task 正在等待 Codex App Server 生成或工具决策
- **WHEN** 用户在无文本选择且非人工接管状态按下 `Ctrl+C`
- **THEN** 系统 SHALL 调用与停止按钮相同的取消链、向 App Server 发送 `turn/interrupt`，并禁止该 turn 继续提交新的 ToolIntent

### Requirement: Codex App Server 随发行包独立交付
系统 SHALL 在每个受支持的发行平台和架构中固定并内置对应的官方 Codex App Server 原生可执行文件及必要辅助资源。正常安装后的账号授权、账号读取和 Agent turn MUST NOT 依赖目标机器预装 Codex CLI、Node.js、Volta 或 Codex Desktop，也不得在内置文件缺失时静默回退到 PATH 上的未知版本。用户显式配置的绝对可执行路径 MAY 作为高级诊断覆盖项。

#### Scenario: 干净 Windows 环境安装
- **GIVEN** Windows x64 机器没有安装 Codex CLI、Node.js、Volta 或 Codex Desktop
- **WHEN** 用户安装 OpsHalo、完成 Codex Subscription 授权并启动 Agent task
- **THEN** 系统 SHALL 从安装包资源目录启动内置 App Server，并完成 initialize、账号读取和 turn 生命周期

#### Scenario: 内置 App Server 资源损坏
- **GIVEN** 用户没有配置高级自定义路径且安装目录中的内置 App Server 文件缺失
- **WHEN** 系统尝试创建 Codex Agent task
- **THEN** 系统 SHALL 显示可恢复的安装完整性错误并停止，不得调用 PATH 中的其他 `codex` 或跨后端回退
