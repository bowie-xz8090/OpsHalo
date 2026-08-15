## Purpose

定义多轮 Agent 在终端光标附近如何透明呈现任务进度、工具动作、风险审批、证据和最终结论，同时保持终端操作流畅并支持下一轮对话。

## ADDED Requirements

### Requirement: 终端标签页显式选择 Shell 或 Agent 模式
当 Agent 功能开关启用时，系统 SHALL 在终端会话控制栏提供“Shell 模式 / Agent 模式”切换，并按标签页保存当前选择。新建或尚未选择模式的标签页 MUST 默认为 Shell 模式。Shell 模式 MUST 保持原始终端输入路径，不得拦截自然语言或启动 Agent；只有 Agent 模式可以将自然语言输入提交给 Agent Harness。功能开关关闭时 MUST 保持旧 Smart Shell 与终端行为兼容。

#### Scenario: Shell 模式保持原始命令行
- **GIVEN** 当前标签页选择 Shell 模式
- **WHEN** 用户输入任意文本并按 Enter
- **THEN** 文本 SHALL 原样发送到当前终端，不创建 Agent task，也不显示 Agent 时间线

#### Scenario: Agent 模式处理自然语言
- **GIVEN** Agent 功能开关已启用且当前标签页选择 Agent 模式
- **WHEN** 用户输入被识别为自然语言的问题并按 Enter
- **THEN** 系统 SHALL 创建绑定该标签页的 Agent task，并进入 Harness + ReAct 流程

#### Scenario: 各标签页独立保存模式
- **GIVEN** 用户在标签页 A 选择 Agent 模式而标签页 B 保持 Shell 模式
- **WHEN** 用户在两个标签页之间切换
- **THEN** 每个标签页 SHALL 恢复自己的模式，且模式选择不得跨标签页泄漏

#### Scenario: 活跃任务期间切回 Shell 模式
- **GIVEN** 当前标签页存在非终止 Agent task
- **WHEN** 用户切换到 Shell 模式
- **THEN** 系统 SHALL 先沿用安全取消链路停止该 task；若存在已开始的变更，仍须完成必要的后置验证，随后恢复原始终端输入

### Requirement: 光标提示面板展示紧凑任务时间线
系统 SHALL 在当前终端光标附近的 AI 提示面板中展示任务状态、当前步骤与预算、已用时间、当前动作和可折叠的历史步骤，并随会话状态实时更新。

#### Scenario: Agent 正在多轮探查
- **GIVEN** 任务处于第 3 个 ReAct 步骤且上限为 12
- **WHEN** 新的工具动作开始执行
- **THEN** 面板 SHALL 展示 `3/12`、动作名称、目标、已用时间和停止控制，历史步骤默认折叠

### Requirement: 提交后立即显示可感知的 AI 运行状态
用户在 Agent 模式提交自然语言后，系统 MUST 在本地立即渲染紧凑的运行占位，不得等待会话绑定、Provider 启动或首个模型响应后才显示。占位和后续状态 SHALL 持续显示已用时间、当前生命周期阶段和停止入口；后台仍在工作但尚无决策时不得呈现为空白或静止界面。

#### Scenario: Codex 首次规划耗时较长
- **GIVEN** 用户提交问题后 Codex App Server 需要数十秒准备线程并生成结构化决策
- **WHEN** Provider 尚未返回 `PlannerDecision`
- **THEN** 光标下方 SHALL 立即显示“AI 正在准备/思考”等动态状态、递增计时和停止按钮，并在连接、线程准备、生成决策等安全生命周期阶段到达时就地更新

#### Scenario: 创建任务前置检查失败
- **GIVEN** 会话绑定、AI 配置或 Provider 初始化失败
- **WHEN** `agent:start` 返回安全错误
- **THEN** 原位置占位 SHALL 转为可读失败卡并展示可恢复原因，不得只显示短暂 toast 后消失

### Requirement: 默认会话流隐藏内部协议事件
系统 SHALL 把 `session.created`、`session.state_changed`、`budget.updated` 等内部协议事件用于状态投影，而不得将它们逐条作为用户步骤显示。默认会话流 SHALL 只展示面向用户的当前活动、实际工具动作、关键观察、审批、验证、错误和最终结论；已完成历史探查默认折叠并可按需展开。

#### Scenario: 新任务开始规划
- **GIVEN** Main 已依次发出创建、状态变化和预算事件
- **WHEN** Renderer 投影新任务
- **THEN** 用户 SHALL 只看到一条动态“AI 正在思考”状态，不得看到按序号排列的内部事件名称

#### Scenario: 工具动作完成后继续规划
- **GIVEN** 一个只读动作已经产生观察并进入下一轮规划
- **WHEN** 当前活动发生变化
- **THEN** 面板 SHALL 突出当前活动，把已完成动作收进“已完成步骤”折叠区，且不得重复显示同一 invocation 的 proposed/policy/execution/observation 行

### Requirement: 命令确认采用就地紧凑决策卡
需要用户确认的 Shell 或工具动作 SHALL 在当前活动下方使用紧凑卡片展示风险等级和完整命令/参数。Shell 卡片的正常决策入口 SHALL 收敛为“执行、修改、拒绝”；主机、目录、影响、超时、前置检查、验证和回滚 SHALL 保持可查看，但可收纳在风险详情中以降低首屏信息密度。R5 仍不得显示执行入口，Enter/Escape 仍不得误批准。

#### Scenario: Shell 动作等待确认
- **GIVEN** Policy 返回 `require_approval` 且动作是 `shell.exec`
- **WHEN** 审批卡出现
- **THEN** 用户 SHALL 在同一卡片首屏看到风险等级、完整命令以及执行、修改、拒绝按钮，并可展开查看主机影响与验证详情

### Requirement: 展示决策摘要而非隐藏思维链
系统 SHALL 向用户展示简短的计划、信息缺口、选取动作的可审计原因和预期观察，但 MUST NOT 展示或持久化模型的隐藏逐步思维链。

#### Scenario: Planner 选择检查容器日志
- **GIVEN** 已知容器运行但健康检查失败
- **WHEN** Planner 选择有限日志查询
- **THEN** 面板 SHALL 显示类似“检查最近错误以验证健康检查失败原因”的决策摘要，而不是模型内部完整推理文本

### Requirement: 审批卡支持知情决策
当动作需要批准时，面板 MUST 突出风险等级、完整命令或工具参数、主机、用户、目录、影响、超时、验证和回滚信息。Shell 动作 SHALL 只提供执行、修改和拒绝三类正常决策；停止整个 Agent 由面板顶栏停止/关闭控制承担，不在命令审批卡中混入额外任务级授权。

#### Scenario: 用户查看高风险操作
- **GIVEN** R4 动作进入 `AwaitApproval`
- **WHEN** 审批卡展开
- **THEN** 用户 SHALL 能在不离开当前终端的情况下查看完整动作与风险，并明确选择批准或拒绝

#### Scenario: 避免键盘误批准
- **GIVEN** 审批卡刚刚出现且用户没有主动聚焦批准按钮
- **WHEN** 用户按 Enter 或 Escape
- **THEN** 系统 SHALL NOT 把该按键解释为批准；Escape 只能关闭详情或未提交草稿，不能停止任务或批准动作

#### Scenario: 修改待审批 Shell 命令
- **GIVEN** 用户正在查看 `shell.exec` 的审批卡
- **WHEN** 用户修改并保存命令文本
- **THEN** 系统 SHALL 使旧审批失效、重新执行风险检查，并在新审批完成前禁止执行修改后的命令

### Requirement: 原始证据按需查看
系统 SHALL 默认显示 Observation 摘要和关键样本，并允许用户通过 Evidence Reference 展开本地保存的清洗后证据、截断信息和执行元数据；默认视图不得被长文本淹没。

#### Scenario: 日志结果被截断
- **GIVEN** Observation 仅显示关键错误样本且标记截断
- **WHEN** 用户点击查看详情
- **THEN** 面板 SHALL 显示可用的本地证据、总量与省略量，而不会把完整内容自动插回模型上下文

### Requirement: 最终结果区分结论和不确定性
最终面板 SHALL 展示结论、关键证据、已执行操作、验证结果、未解决问题和终止原因；`inconclusive`、`blocked`、`partial` 与 `complete` 必须有可区分的视觉和文字状态。

#### Scenario: 任务以证据不足结束
- **GIVEN** 任务因日志缺失返回 `inconclusive`
- **WHEN** 最终面板渲染
- **THEN** 面板 SHALL 明确显示已确认事实、缺失证据和建议下一步，而不是使用成功样式

#### Scenario: Planner 信息缺口由自动探查解决
- **GIVEN** Planner 已记录容器列表等信息缺口且当前没有用户审批或实质歧义
- **WHEN** Agent 正在继续有界只读探查或任务已经进入终止态
- **THEN** 运行态 SHALL 将其表述为“正在继续探查”而非“需要用户确认”，终止态 SHALL 只在最终结果中展示未解决项，不得在上方重复制造待用户输入的假象

### Requirement: 自然语言仅从 Shell 光标输入
AI 分析面板 MUST NOT 提供普通自然语言 textarea 或密码输入框。模型能直接回答或继续有界只读探查时 SHALL 直接输出结果；仅当用户请求存在会改变动作目标或安全结果的实质歧义时，当前轮次才可以 `inconclusive` 结束并展示需要确认的问题，用户在下一轮从 Shell 光标继续输入。系统 SHALL 复用当前已认证的 SSH 会话，不得再次询问服务器登录密码；sudo、TTY 或凭据交互只能在具体动作完成风险展示并获得批准后转交当前终端。

#### Scenario: 用户发送问候
- **GIVEN** 用户在 Agent 模式输入“你好”且没有提出服务器操作目标
- **WHEN** Planner 生成结果
- **THEN** 系统 SHALL 直接用用户语言回答并结束本轮，不得显示补充信息输入框或询问服务器密码

#### Scenario: 操作目标存在实质歧义
- **GIVEN** 用户要求重启“服务”但服务器存在多个候选且选择错误会造成影响
- **WHEN** 只读探查仍无法安全确定目标
- **THEN** 系统 SHALL 以 `inconclusive` 输出已知信息和最小确认问题，释放 Shell 光标供下一轮输入，面板中不得嵌入文本输入框

### Requirement: 用户可随时停止并接管
系统 MUST 在执行和等待状态提供可访问的停止控制，并允许用户使用 `Ctrl+C` 中断活跃 AI 任务；遇到交互式命令、密码提示或需要人工判断时，面板 SHALL 暂停 Agent 并允许用户接管终端或取消动作。

#### Scenario: Ctrl+C 中断活跃 AI 任务
- **GIVEN** 当前标签页存在活跃 AI Agent 或仍在生成中的 Smart Shell 请求、没有文本选择且未进入人工 PTY 接管
- **WHEN** 用户按下 `Ctrl+C`
- **THEN** 系统 SHALL 取消当前 AI 任务、传播取消信号并消费该按键，不能同时把同一次 `Ctrl+C` 发送到远端终端

#### Scenario: Ctrl+C 保留复制行为
- **GIVEN** 用户在终端或 AI 面板中选中了可复制文本
- **WHEN** 用户按下 `Ctrl+C`
- **THEN** 系统 SHALL 执行复制而不取消 AI 任务，也不向远端发送 SIGINT

#### Scenario: 人工接管时 Ctrl+C 发送远端中断
- **GIVEN** Agent 已暂停且用户明确进入人工 PTY 接管
- **WHEN** 用户按下 `Ctrl+C` 且没有文本选择
- **THEN** 系统 SHALL 将 `Ctrl+C` 作为终端 SIGINT 发送给远端交互进程，而不是再次取消已暂停的 Agent

#### Scenario: 命令进入交互模式
- **GIVEN** 执行器检测到编辑器或密码提示
- **WHEN** Agent 无权自动输入
- **THEN** 面板 SHALL 显示“需要用户接管”，停止自动循环并保留恢复或结束任务的选择

#### Scenario: 用户主动在同一终端输入命令
- **GIVEN** Agent 仍处于活跃非终止状态
- **WHEN** 用户选择继续发送手工终端输入
- **THEN** 面板 SHALL 先提示环境可能变化并暂停 Agent，终端输入完成后要求重新校验会话再恢复

### Requirement: AI 面板可手动关闭
AI 面板 SHALL 在运行态和终止态都提供显式关闭按钮。关闭终止结果只影响本地显示；关闭活跃任务 MUST 先走与 `Ctrl+C` 相同的安全取消链路，已开始变更仍须完成所需后置验证，取消成功后再隐藏面板并把焦点还给 Shell 光标。

#### Scenario: 关闭正在思考的面板
- **GIVEN** Agent 正在等待 Provider 返回且没有已开始的变更
- **WHEN** 用户点击关闭
- **THEN** 系统 SHALL 取消 Provider 回合、隐藏面板并聚焦 Shell，后台不得继续无人可见地运行

### Requirement: 最终结果支持下一轮上下文对话
任务结束后，系统 SHALL 允许用户在同一光标输入区域继续提问，并只携带该任务的目标、确认事实、Evidence Reference、操作与验证摘要作为后续上下文。

#### Scenario: 用户追问已完成诊断
- **GIVEN** 上一任务已确认某容器因配置错误退出
- **WHEN** 用户追问“应该怎么修复”
- **THEN** 新一轮对话 SHALL 可引用已确认事实和证据，但不得自动继承已过期的变更审批

### Requirement: AI 设置支持互斥类型选择和 Codex 账号总览
AI 设置 SHALL 保留现有 OpenAI Compatible/API Key 配置界面，并提供 `OpenAI Compatible/API Key` 与 `Codex Subscription` 两种互斥类型。Codex 类型 SHALL 展示添加账号、授权状态、脱敏账号标识、套餐、额度与重置时间、当前账号、切换、重新授权和退出操作；不得提供 OAuth Token/JSON 导入入口。

#### Scenario: 保留非当前类型配置
- **GIVEN** 用户已保存现有 API Key 配置
- **WHEN** 用户切换到 Codex Subscription 并完成授权
- **THEN** 原 API Key 配置 SHALL 保留但不生效，界面 SHALL 清楚标记只有 Codex Subscription 为当前启用类型

#### Scenario: 升级后主配置意外回落为空白默认值
- **GIVEN** 同一 userData 中仍有受保护的有效 AI 配置历史或 Codex profile，但主配置的 API Key、Codex profile 和 Agent 开关意外全部回落为未配置默认值
- **WHEN** 新版本首次加载用户数据
- **THEN** 系统 SHALL 在开始配置持久化监听前从最近有效历史恢复 API Key 后端字段与对应 Agent 开关，并保留已有 Codex profile；恢复过程不得输出原始 API Key，且模式选择器 SHALL 随恢复后的开关重新出现

#### Scenario: 保存当前后端不覆盖非当前后端
- **GIVEN** API Key 与 Codex Subscription 两类配置均已保存
- **WHEN** 用户在设置页只修改并保存当前后端
- **THEN** 系统 SHALL 合并保存当前表单值且保留未挂载的另一后端字段，不得用 `undefined`、空字符串或默认值覆盖非当前配置

#### Scenario: OAuth 等待和取消
- **GIVEN** 用户发起官方 Codex 登录
- **WHEN** 系统正在等待浏览器回调或设备码确认
- **THEN** 设置页 SHALL 展示授权链接、当前状态、超时与取消操作，取消后不得留下“已授权”假状态

#### Scenario: 套餐或额度暂时不可读
- **GIVEN** 账号已登录但额度接口暂时失败
- **WHEN** 账号总览刷新
- **THEN** 系统 SHALL 保留已确认的登录状态、把额度显示为暂不可用并提供重试，不得将其误报为额度充足或账号失效
