## 1. 实施前验证与基线

- [x] 1.1 将开发/构建 Node.js engine 提升到 `>=20.19`，用官方 `@strands-agents/sdk` 建立最小 Electron 打包试验，固定通过验证的稳定版本并记录 ESM、Apache-2.0、产物体积和离线失败行为；不通过时保持 OpenAI Compatible Adapter 可运行
- [x] 1.2 盘点 `agent-tools.js`、SSH exec/PTY/SFTP、Smart Shell 和 MCP 的所有执行入口，形成可自动测试的“Agent 不得绕过 Tool Gateway”基线清单
- [x] 1.3 按设计建立 `<userData>/agent-runtime/v1` 独立版本化目录的最小原型，验证原子 rename、权限、gzip、配额扫描和崩溃恢复并记录 ADR
- [x] 1.4 增加默认关闭且有依赖关系的 `agentModeEnabled`、`agentMutationEnabled`、`agentExternalMcpEnabled` 设置占位，确保总开关关闭时旧 Smart Shell 行为不变
- [x] 1.5 为现有 Smart Shell、Agent 工具循环和 MCP 命令校验补充回归测试，确保后续迁移能识别兼容性变化
- [x] 1.6 核对详细设计中的模块树、IPC channel 和现有 CommonJS/ESM 边界，建立 G0-G5 phase gate 的自动验收入口

## 2. 核心协议与会话骨架

- [x] 2.1 按 Detailed Data Contracts 实现并校验 Session、Harness、Tool、Policy、Approval、Execution、Observation、Evidence、Error、Verification、FinalResult 和 `AgentEvent` 的版本化 Zod/JSON Schema
- [x] 2.2 实现 Agent Session 状态机、单写者 mailbox、纯 reducer + Effect Runner 及合法转换 guard，覆盖全部运行、等待、暂停和终止状态
- [x] 2.3 实现任务与 `tabId + connectionId + host fingerprint + username + cwd` 的会话绑定及恢复校验
- [x] 2.4 实现规范事件目录、严格递增 sequence、snapshotVersion、at-least-once 投递、200 条内 delta replay 和 sequence gap snapshot 恢复
- [x] 2.5 在 preload/main 实现 `agent:start/control/get-snapshot/get-evidence/delete-evidence/event` 专用 IPC、sender 所有权、大小/频率限制和安全错误 envelope
- [x] 2.6 实现 Session Store 的原子 snapshot、events NDJSON、7 天元数据保留、应用重启统一 paused 和旧批准失效
- [x] 2.7 增加 Schema、IPC、mailbox 和状态机单元/属性测试，覆盖非法转换、重复/缺口事件、旧 snapshot、标签切换、断线、重启恢复和取消竞态

## 3. Tool Registry 与统一 Tool Gateway

- [x] 3.1 实现 Tool Registry 及工具元数据校验，拒绝缺少模式、风险、敏感度、超时、取消或结果契约的注册项
- [x] 3.2 实现主进程 Tool Gateway 的会话验证、参数验证、目标归一化、策略调用、审批衔接、执行分发和审计钩子
- [x] 3.3 实现 main 到现有 Session Server 的 `session-execution-bridge`，以 task/invocation/session fingerprint 和短期 capability 包装 SSH exec、PTY、SFTP，不复制连接实现
- [x] 3.4 为现有内部/外部 MCP 入口增加 Gateway adapter，并让未知元数据工具默认 R2/S2/C2、未知可变性禁止自动执行
- [x] 3.5 阻断或迁移 `agent-tools.js` 等 Renderer 直接执行路径，使无有效网关决策/capability 的 Agent 请求在 Main 和 Session Server 两侧失败
- [x] 3.6 增加旁路安全回归测试，逐项证明内部 Agent、Smart Shell Agent 模式、SSH、PTY、SFTP 和 MCP 都无法绕过 Gateway

## 4. Policy Engine 与审批令牌

- [x] 4.1 实现 R0-R5、S0-S3、C0-C3 风险数据模型、工具风险下限和只升不降的合并算法
- [x] 4.2 实现 Linux Shell 静态分析与保守回退，覆盖管道、重定向、命令替换、sudo、网络外发、未知命令、持续 follow 和交互程序
- [x] 4.3 实现默认策略：仅有界 R0/R1 + S0/S1 + C0/C1 自动执行，网络只读确认，R3/R4 逐次确认，R5 永久阻断
- [x] 4.4 实现绑定 task、invocation、session fingerprint、intent SHA-256、策略版本和有效期的 HMAC 内存 capability，保证一次消费、暂停/重启失效和防重放/偷换
- [x] 4.5 实现“批准一次”“策略允许时本任务完全匹配授权”“拒绝”“取消任务”决策及任务结束自动失效
- [x] 4.6 实现由 NormalizedIntent/PolicyDecision 确定性生成的 ApprovalDisplay；Shell 修改只创建新 intent 并重新评估，R5 不显示批准入口
- [x] 4.7 增加策略表驱动和 capability 攻击测试，覆盖允许、升级、确认、拒绝、过期、重放、参数/会话/策略变化、task scope 与 R5 阻断

## 5. Execution Runtime、超时与取消

- [x] 5.1 为 SSH exec、PTY、SFTP、MCP 和 background 建立统一 ExecutionResult、执行 receipt、progress/finished 事件与结构化错误契约
- [x] 5.2 将停止按钮和 `Ctrl+C` 统一到同一 cancel effect，把 AbortSignal 贯穿 Session、Harness、Gateway、执行队列和各执行器，并实现温和取消、宽限期和 channel 隔离
- [x] 5.3 按工具类别实施 5/10/15/30/60/120 秒默认与最大超时，以及 5 分钟任务和已批准 15 分钟长任务上限
- [x] 5.4 检测 TTY、密码、分页器、编辑器和持续交互，暂停自动循环并转交用户控制，禁止 Agent 自动输入凭据
- [x] 5.5 实现 invocation ledger 和幂等 receipt：只读仅可在未 started 时传输重试一次，所有变更 at-most-once 且批准不能自动复用
- [x] 5.6 对断线、超时或取消后远端进程状态未知的情况返回 `unknown/unconfirmed` 并增加只读验证，不把 channel 断开误报为进程已结束
- [x] 5.7 增加执行集成测试，覆盖退出码、stderr、部分输出、超时、取消、断线重连一次、重复 invocation、变更未知状态、交互转交和 channel 隔离

## 6. Observation Pipeline 与 Evidence Store

- [x] 6.1 实现 stdout/stderr 分流、32 KiB head + 64 KiB tail、256 KiB 内存上限、2 MiB/invocation 捕获上限、ANSI/控制字符清理、流式编码和二进制保护
- [x] 6.2 实现内置密钥/令牌/私钥/授权头/连接串脱敏器及用户扩展敏感模式，确保发送模型和本地落盘前均处理
- [x] 6.3 实现工具专用解析、错误/统计/事实提取、首尾采样和默认 6 KiB/硬上限 8 KiB 的 Observation Reducer
- [x] 6.4 在 `<userData>/agent-runtime/v1` 实现 gzip Evidence、manifest、SHA-256、`evidence://` 引用、10 MiB/task、24 小时 TTL、LRU、立即清理和删除后引用状态
- [x] 6.5 实现 25/10/25/25/15 上下文分配、80% 压缩、90% 强制 Reduce、事实/假设/矛盾账本和 progress/action fingerprint
- [x] 6.6 将所有工具输出标记为不可信数据并增加提示注入防护，确保输出文本无法改变策略或直接触发工具
- [x] 6.7 实现可选无工具权限摘要器，并强制每条新增陈述关联样本/evidence offset；无引用内容不得进入 FactRecord
- [x] 6.8 增加 Observation/Evidence/Context 测试，覆盖超长日志、超长单行、ANSI、非 UTF-8、二进制、秘密、脱敏失败、提示注入、部分数据、配额、TTL、清理和 context exhaustion

## 7. Harness 适配与 ReAct 编排

- [x] 7.1 实现最小 `AgentHarness.runTurn(input, signal)` 端口及流式事件/用量/结构化错误映射
- [x] 7.2 使用锁定版本 `@strands-agents/sdk` 实现 Strands Harness Adapter，首选 structured-output 单决策模式，将 stream/output/hook 映射到 HarnessEvent；只有契约测试证明 callback 前可 yield 时才启用代理工具，且始终禁止 SDK 自带 Shell/File/HTTP/MCP 执行工具
- [x] 7.3 将现有 OpenAI 兼容模型配置包装为 OpenAI Compatible Adapter，保持现有聊天与 Smart Shell 配置兼容
- [x] 7.4 实现 Strict JSON Adapter、有限结构修复和无法稳定结构化时的建议模式降级
- [x] 7.5 实现主 ReAct Planner 的事实账本、信息缺口、单动作决策、预期观察和完成判据更新
- [x] 7.6 实现 12 步/20 硬上限、8 个自动只读、5 分钟、重复 2 次、连续错误 3 次、context 80/90% 阈值以及模型/输出预算
- [x] 7.7 实现七层 Prompt Builder、UNTRUSTED_OBSERVATION 数据边界、一次结构修复、同 provider 500/1500ms 临时错误重试和禁止跨 provider 自动回退
- [x] 7.8 增加 Harness 契约和模型模拟测试，覆盖 Strands 单决策边界、原生 tool-calling、严格 JSON、无效结构、提示注入、取消、用量超限、provider 错误和安全降级

## 8. 结构化服务器探查工具

- [x] 8.1 按 Detailed Tool Contract Catalog 实现 `session.describe`、`host.profile`、`process.list/detail` 和 `network.ports/connections` 的 Linux 有界输入/输出 Schema
- [x] 8.2 按目录规定的 path、depth、entry、byte、time、line 上限实现 `filesystem.list/stat/read_limited`、`service.status/logs` 和 `config.read_limited`
- [x] 8.3 按容器数量、日志窗口、采样次数/间隔上限实现 `docker.list/inspect/logs/stats` 与 `metrics.snapshot`，缺失设施返回可适配错误
- [x] 8.4 实现 `shell.exec` 兜底工具并强制静态分析、参数/输出/超时上限，保证结构化工具优先
- [x] 8.5 为每个工具登记结果解析器、错误映射、风险下限、敏感度、成本、审批规则和验证能力
- [x] 8.6 增加 Linux 发行版差异和缺失命令测试，验证 Agent 会选择替代探查而不会自动安装软件

## 9. 自适应错误处理、停止与验证

- [x] 9.1 实现 Detailed Data Contracts 中全部 AgentError 类别及 safe IPC 映射，包括 model/context/session/cancel/internal 错误
- [x] 9.2 实现基于工具、规范化参数、资源、错误和新增事实的循环/无进展检测及强制换策略或停止
- [x] 9.3 实现确定性 completion algorithm、证据充分性、矛盾检测、未验证变更阻断和 `complete/inconclusive/need_user/blocked/failed/cancelled/partial` 终止器
- [x] 9.4 实现变更前置检查、审批前验证计划、执行结果记录和强制只读后置验证闭环
- [x] 9.5 实现多目标 `partial` 结果、依赖动作暂停和需重新审批的回滚提案/回滚验证
- [x] 9.6 增加场景评估，覆盖命令缺失、权限不足、查询截断、相同错误、矛盾证据、信息不足、退出码零但验证失败和回滚拒绝

## 10. 光标 Agent 面板

- [x] 10.1 实现 Renderer `agent-session` store，对 AgentEvent 做 sequence 去重/缺口检测、snapshot 替换和本地折叠/证据选择状态管理
- [x] 10.2 将现有 Smart Shell overlay 扩展为 legacy/Agent 路由容器，实现光标上下定位、560-960px 宽度、60% 高度和小 viewport 底部 dock
- [x] 10.3 实现顶栏状态、步骤/自动只读预算、耗时、暂停/停止、计划摘要和默认折叠的 TimelineStepView
- [x] 10.4 实现只展示 plan/reason summary 的步骤卡，确保隐藏思维链和未脱敏 provider 数据不进入 Renderer state、DOM 或日志
- [x] 10.5 实现审批卡的完整 ApprovalDisplay、无默认 Enter 批准、R4/R5 按钮限制、10 分钟过期和 Shell 修改后重新检查
- [x] 10.6 实现普通补充信息、密码/TTY 人工接管、手工终端输入先暂停、approval stale 和接管后只读重新验证
- [x] 10.7 实现 64 KiB 分页 Evidence 详情、来源/哈希/脱敏/截断/过期元数据及单项/整任务清理控制
- [x] 10.8 实现 `complete/inconclusive/blocked/partial/failed/cancelled` 最终卡和 parentTask follow-up，仅继承事实/evidence/操作验证摘要
- [x] 10.9 实现共享 `resolveCtrlCAction` 键盘仲裁与单事件去重：文本选择复制优先、人工 PTY 接管发送 SIGINT、活跃 Agent/Smart Shell 调用 AI cancel、其余保留终端原行为
- [x] 10.10 在终端会话控制栏实现按 tab 隔离且默认 Shell 的“Shell 模式 / Agent 模式”选择器；Shell 模式不拦截输入，Agent 模式路由自然语言，活跃任务切回 Shell 复用安全取消/验证链路
- [x] 10.11 增加组件与 Playwright 测试，覆盖 wireframe A-D、模式选择按 tab 隔离及默认 Shell、sequence gap、响应布局、键盘/读屏、Ctrl+C 四种上下文和双监听去重、误批准防护、停止、接管、手工输入、证据分页和各终止状态
- [x] 10.12 将 Agent 面板改为当前活动优先的紧凑会话流：提交后本地即时思考占位、Provider 生命周期心跳、内部协议事件不生成步骤、同 invocation 合并、历史折叠、就地命令确认卡和原位错误反馈

## 11. MCP 统一、审计与兼容迁移

- [x] 11.1 将现有 MCP 黑白名单和命令校验映射为统一 Policy Engine 的规则输入，定义冲突时取更严格结果
- [x] 11.2 让外部 MCP 工具注册时补全或保守推断安全元数据，未知可变性工具禁止自动执行
- [x] 11.3 实现 `<userData>/agent-runtime/v1/audit` 脱敏追加式 NDJSON、日轮转、30 天/50 MiB 清理，记录策略版本、参数摘要/哈希、用户决策、执行 receipt 和 Evidence Reference
- [x] 11.4 增加旧 Smart Shell、聊天和 MCP 的兼容适配，feature flag 关闭时保持现有用户路径不变
- [x] 11.5 增加内部/外部 MCP 同策略测试、审计完整性测试以及敏感原文不进入普通日志的隐私测试

## 12. 系统验收、灰度与文档

- [x] 12.1 建立代表性排障数据集与确定性假模型，度量任务完成、证据引用、无进展停止、误审批和验证失败识别
- [ ] 12.2 运行单元、集成、Playwright、StandardJS 和 Electron 打包测试，并记录各平台结果与已知差异
- [x] 12.3 按 G0-G5 逐门执行安全评审，证明 Renderer、旧 Agent 路径、Session Server、MCP、SFTP、capability、事件重放和工具输出提示注入均不能绕过策略
- [ ] 12.4 仅在 G0-G3 通过后开启 `agentModeEnabled` 的 R0/R1 灰度，收集非敏感的超时、错误分类、循环停止和审批拒绝统计
- [ ] 12.5 仅在 G4 通过后灰度 `agentMutationEnabled`，G5 通过后灰度 `agentExternalMcpEnabled`；R4/R5 维持严格策略并记录任何策略偏差
- [x] 12.6 编写用户文档、工具开发者注册指南、风险策略说明、隐私/证据清理说明和故障排查手册
- [ ] 12.7 完成规格逐项验收并更新所有已完成复选框；确认实现、测试与文档完成后才执行 OpenSpec 归档

## 13. Codex Subscription 与互斥 AI 后端

- [x] 13.1 扩展版本化设置与运行时校验，保留现有 OpenAI Compatible/API Key 字段，新增互斥 `aiBackendType` 和当前 Codex profile；迁移旧配置时默认选择原有类型且不删除任何已保存配置
- [x] 13.2 实现主进程 Codex profile store 与安全目录，账号元数据不含原始 Token，不改写全局 `~/.codex`，并覆盖权限失败、损坏、删除和并发切换测试
- [x] 13.3 实现 Codex App Server stdio JSON-RPC 生命周期、可执行文件发现、initialize、官方浏览器/设备码登录、account read/rate limits/logout、超时、崩溃恢复和脱敏错误映射
- [x] 13.4 实现 `CodexAppServerHarnessAdapter`，映射 thread/turn 流式事件、结构化 Planner 决策、用量、provider error 和 `turn/interrupt`，并确保失败不跨 AI 后端自动回退
- [x] 13.5 建立 App Server 到 electerm Tool Gateway 的受控工具桥，拒绝本机内置 Shell/File 执行并证明远程 SSH/SFTP/MCP 动作仍经过本地 Policy、Approval、Timeout、Observation 与 Audit
- [x] 13.6 在 preload/main 增加最小 Codex 账号 IPC，校验 sender、profile、请求大小和状态转换；Renderer 只能获得脱敏账号、套餐、额度和授权进度
- [x] 13.7 更新 AI 设置页，提供互斥的 API Key/Codex Subscription 类型选择、账号总览、浏览器/设备码授权、当前账号、额度刷新、切换、重新授权和退出，同时保留原有配置体验
- [x] 13.8 增加单元、集成和 UI 测试，覆盖旧配置迁移、互斥选择、登录取消/超时、额度失败、多账号切换、活跃任务阻断、App Server 崩溃、Ctrl+C 中断、凭据不泄漏和 Gateway 无旁路
- [x] 13.9 更新用户与开发文档，说明 Plus/Codex Subscription 与 OpenAI API 独立计费、官方登录依赖、账号数据位置、退出/清理和回滚方式
- [x] 13.10 固定并随发行包内置平台对应的官方 Codex App Server 原生二进制，默认禁止 PATH 回退；增加干净环境解析、ASAR 解包、真实 initialize/account/turn 和最终产物启动验证
- [x] 13.11 收敛终端交互：移除普通补充信息 textarea，问候/可回答问题直接完成，实质歧义以 `inconclusive` 结束并回到 Shell 光标；审批卡仅保留执行/修改/拒绝，面板支持安全关闭，且 Agent 不重复询问已登录 SSH 的凭据
- [x] 13.12 修复升级后的 AI 配置回归：当主配置意外回落为空白默认值时，从同一 userData 中受保护的最近 AI 配置历史恢复 API Key 配置和 Agent 开关；保留 Codex profile，保存任一后端时不得清空另一后端，并覆盖真实升级与 UI 回归测试
- [x] 13.13 修复设置刷新后 task-scoped policy version 与 SSH/SFTP 执行 capability 漂移；为 Strands/OpenAI 结构化输出增加一次修复和无动作建议模式降级；保留内部错误分类、隐藏终止态信息缺口、压缩失败卡，并增加真实 `docker.list -> observation -> complete` 与错误日志脱敏回归

## 14. 生产可用 Agent Loop 恢复

- [x] 14.1 将 Strands、OpenAI Compatible、Strict JSON 和 Codex Planner 收敛到无任意键对象的 provider-safe wire schema，`argumentsJson/verificationPlanJson` 解码后再经内部 Zod 与 Tool Registry 校验
- [x] 14.2 重写 Harness 错误分类，优先解析 provider code/type/status，严格区分 schema/structure、context length、rate limit、transport、cancel 和内部错误；禁止裸 `context` 误判
- [x] 14.3 用最终序列化 Prompt 实现单轮 context 计量、输出预留、70/85% 两级压缩和最小 Prompt；累计 token usage 仅作成本统计
- [x] 14.4 实现目标相关 Tool Selector，每轮最多提供 8 个优先工具并覆盖目录缩减、必要兜底和错误适配测试
- [x] 14.5 实现可扩展 Fast Query Router，只允许高置信注册只读工具；首批覆盖 Docker、进程、端口、主机概况和指定服务状态，诊断/变更/歧义语义必须退出快速通道
- [x] 14.6 让 `docker.list/process.list` 等 query 参数实际生效，Observation 生成紧凑 resultView、匹配计数和短事实，并在成功后确定性消解对应信息缺口
- [x] 14.7 实现 Result Projector 与充分性路由：已回答的结构化查询不再强制二次模型调用；零匹配可完成，partial/error 进入重规划或证据不足，诊断与变更保持原验证门槛
- [x] 14.8 扩充错误、上下文、Schema、多工具、大结果、零匹配、成功后 Provider 故障、无进展、审批验证和 Ctrl+C 场景；断言 fast query 0 次模型/1 次工具与总延迟预算
- [x] 14.9a 运行 Agent、StandardJS、compile 和编译后 Electron UI 回归；记录完整测试结果，不得用打包成功代替运行验证
- [ ] 14.9b 在可安全复用的真实在线会话中运行 Provider + SSH 只读 smoke，并补齐 Windows/macOS/Linux 外部矩阵
- [x] 14.10 为明确的 Docker 容器 Nginx 配置查询增加确定性只读路径：精确提取容器名，经 Policy/Gateway 执行有界 `nginx -T`，脱敏、截断并由 Result Projector 直接完成；修改配置语义不得进入该路径
- [x] 14.11 为 Strands 单轮规划增加可取消的硬截止，禁止同一轮隐式重试；超时和未识别适配器错误必须明确声明未向服务器发送命令，并保留脱敏 provider code/type/status 供排障
- [x] 14.12 将 API Key 新配置默认 Harness 改为 OpenAI Compatible；对已保存为 Strands 的 DashScope endpoint 做确定性兼容选择，仍固定同一 provider/model/API Key，不跨 AI 后端回退；设置页将 Strands 标为实验性
