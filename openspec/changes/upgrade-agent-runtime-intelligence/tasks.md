## 1. 基线、指标与契约冻结

- [x] 1.1 为当前 OpenAI Compatible、Codex Subscription 和 Strands 路径记录首个状态、首个模型响应、首个执行结果、总耗时和模型回合基线。
- [x] 1.2 为当前真实 SSH bridge、Execution Runtime、Observation、CompletionEvaluator 和 Agent overlay 建立回归测试，固定现有安全行为。
- [x] 1.3 定义 `ProviderEvent`、V2 `AgentEvent`、`AgentProviderSession`、`ExecutionChunk`、`FactCandidate`、`CompletionDecision` 和 `FinalResponseDraft` 的 Zod/TypeScript schema。
- [x] 1.4 增加 schema version、事件去重、snapshot 缺口恢复和旧 Renderer 忽略未知事件的契约测试。
- [x] 1.5 增加 task latency recorder；验证默认不记录目标、命令、主机名、输出、prompt、response 或凭据。

## 2. Provider 流式传输

- [x] 2.1 实现 OpenAI Compatible SSE/stream parser，覆盖 UTF-8 跨 chunk、注释/keepalive、`[DONE]`、文本 delta、tool argument delta、usage 和错误帧。
- [x] 2.2 将 OpenAI Compatible adapter 改为 `AsyncIterable<ProviderEvent>`，保留现有 strict JSON wire decode 和一次结构修复边界。
- [x] 2.3 为 Codex App Server turn notifications 建立相同 ProviderEvent 映射，过滤 reasoning item 和原始 provider payload。
- [x] 2.4 为 Strands adapter 增加流式/阶段适配；不支持可靠 delta 时发送预定义 phase，而非伪文本。
- [x] 2.5 实现跨 chunk secret redaction、文本事件节流和 Renderer 背压合并。
- [x] 2.6 覆盖首 delta 超时、中途断流、partial tool arguments、取消、invalid schema、context error 和安全日志测试。

## 3. Task-scoped Provider Session

- [x] 3.1 实现 `ProviderSessionManager` 和生命周期清理，确保每个 task 同时最多一个 Planner turn。
- [x] 3.2 OpenAI Compatible 会话复用 adapter/client 和已编译能力快照，不依赖服务端隐式状态。
- [x] 3.3 Codex 路径缓存账号读取、每 task 复用一个 thread，并显式传入 model/reasoning 配置。
- [x] 3.4 Strands 路径每 task 复用 Agent，不在每个 ReAct 回合重复 `createAgent()`。
- [x] 3.5 实现同后端 session 一次重建、WorkingMemory 最小重放和不跨后端回退。
- [x] 3.6 增加完成、失败、取消、空闲过期、应用退出和 crash recovery 清理测试，验证凭据/原始 transcript 不持久化。

## 4. 真实执行输出与有界只读并发

- [x] 4.1 扩展 SSH/PTY execution bridge，提供 stdout/stderr chunk、序号、首字节时间和 AbortSignal。
- [x] 4.2 在 Execution Runtime 中实现增量解码、ANSI/控制字符处理、跨 chunk 脱敏、字节统计和 Evidence streaming writer。
- [x] 4.3 用 `execution.output_progress` 替换伪输出心跳；无输出计时事件必须标记 `source=timer`。
- [x] 4.4 为 Tool Definition 增加 `parallelSafe`，实现最多 3 个动作的 `ReadProbeBundle` 调度和确定性归并。
- [x] 4.5 验证每个 bundle action 独立经过 Gateway/Policy/Budget/Audit，任何 mutation/interactive/unknown action 均强制串行。
- [x] 4.6 覆盖大输出、无换行、二进制/非法 UTF-8、stderr-only、背压、取消、binding mismatch、部分失败和未知远端状态测试。

## 5. 增量 Observation 与 Grounded Final Response

- [x] 5.1 实现 JSON、表格、key-value、日志、命令错误和普通文本的 generic parser registry。
- [x] 5.2 生成带 `EvidenceRange` 和 confidence 的 FactCandidate，并阻止 heuristic fact 单独满足关键完成判据。
- [x] 5.3 将可选 Observation summarizer 接入主运行时；限制输入预算，要求输出 fact/evidence 引用且无工具权限。
- [x] 5.4 重构 WorkingMemory reconciler，按 fact id 去重、消解已满足 missing information、保留验证和不确定性。
- [x] 5.5 将 CompletionEvaluator 改为只输出 `CompletionDecision`，不负责自然语言润色。
- [x] 5.6 实现 GroundedFinalSynthesizer、claim-to-fact validator、一次结构修复和确定性 fallback。
- [x] 5.7 更新 Agent UI，流式显示安全文本并将结论、证据、不确定性、下一动作与工具卡分离。
- [x] 5.8 覆盖零事实、零匹配、部分成功、证据冲突、总结超时、引用不存在、夸大结论和已有证据后 Provider 故障测试。

## 6. 模型 Profiles 与能力探测

- [x] 6.1 增加 Fast/Planner/Summarizer profile schema、单模型继承和旧设置迁移；Verifier 保持确定性。
- [x] 6.2 在设置页增加 context、max output、turn timeout、streaming、structured mode、reasoning、temperature 和 cache 控件及校验。
- [x] 6.3 实现无服务器权限的 capability probe：认证、stream、schema、错误分类、取消和声明限制。
- [x] 6.4 生成 `automatic/limited/unavailable` 报告，展示失败项和调整建议；配置 hash 变化后使报告失效。
- [x] 6.5 任务 snapshot 固定 backend/profile/model/capability report，运行中设置变化只影响新任务。
- [x] 6.6 验证 API Key/Codex Subscription 互斥、无跨计费路径回退、探测不触发 SSH/MCP/SFTP 和敏感日志不泄漏。

## 7. Skills 与本地知识库

- [x] 7.1 实现 built-in/user-local Skill manifest、目录边界、大小限制、版本和来源校验。
- [x] 7.2 实现候选 Skill metadata 路由和按需正文加载，限制每轮 Skill 数量和 token 预算。
- [x] 7.3 验证 Skill 中命令和越权指令不能绕过 Tool Registry、Policy、Approval 或单主机 binding。
- [x] 7.4 实现用户显式添加/删除本地知识源、secret scan、分块、版本和本地 FTS 索引。
- [x] 7.5 可选实现本地/显式 embedding provider 和 keyword/vector RRF；默认保持全文检索且不静默调用云服务。
- [x] 7.6 在 prompt、UI 和 FinalResponse 中传递 KnowledgeCitation，并要求服务器当前状态由实时 Evidence 验证。
- [x] 7.7 覆盖路径越界、符号链接、超大文件、提示注入、过期来源、损坏索引、删除清理和无知识回退测试。

## 8. 输入路由、可访问性与会话体验

- [x] 8.1 保持 Shell/Agent 模式互斥，增加 `Shift+Enter` 强制 Agent 提交且不影响 Shell 原始输入。
- [x] 8.2 提交后 100 ms 内显示本地 accepted 状态，并将 provider phase、assistant delta、execution output 和 observation 绑定到稳定布局。
- [x] 8.3 Stop 同时取消 Provider turn、并发 read bundle 和当前执行；审批等待和 terminal handoff 使用原有受控语义。
- [x] 8.4 为 delta 高频更新增加屏幕阅读器降噪、键盘焦点、重连 snapshot 和长文本布局测试。
- [x] 8.5 验证 UI 不显示隐藏推理、原始 Provider payload、未脱敏输出或 partial tool arguments。
- [x] 8.6 将批准的 `shell.review_exec` 交给当前终端执行，完整命令输出只在 Shell 展示，不复制到 Agent 最终卡。
- [x] 8.7 支持 Observation 后在同一 task 中直接提出下一条受控命令，移除“继续检查”中间按钮和提前 complete 行为。
- [x] 8.8 下一轮审批锚定新提示符并为长输出预留可见空间；保持默认尺寸和手动拉伸能力。
- [x] 8.9 无后续动作时自动关闭 overlay，保留终端输出和可输入的新提示符。
- [x] 8.10 恢复通用设置首屏的系统界面语言入口，并验证其与 AI 回答语言配置相互独立。
- [x] 8.11 删除 Nginx/Docker 关键词固定路由和固定后续探查，不再跳过 Planner。
- [x] 8.12 用户可见远端读取统一由 Planner 生成 `shell.review_exec`，结构化读取不再绕过 Shell 确认。
- [x] 8.13 Shell 审批仅允许 `once`，每一条后续命令都重新确认。
- [x] 8.14 增加目标粒度约束：路径查询不得扩大为内容、语法、include、状态或端口检查。
- [x] 8.15 结构化动作失败后使用同模型简单命令降级并重新进入安全网关；彻底失败时显示可理解的 AI 配置错误。
- [x] 8.16 无法封装动作但已有 AI 可见回答时，脱敏后直接展示模型回答，不再显示内部“证据不足”状态文案。
- [x] 8.17 Enter 读取完整逻辑输入行（含光标右侧与 wrapped continuation），执行前移动到行尾并清除整行。
- [x] 8.18 Shell 后置验证逐条转成新提示符下方的可选审批卡，不再后台自动执行或触发 `react_steps_exhausted`。
- [x] 8.19 用户开始新输入时保留旧后续建议并允许多 task 卡片在终端历史中并存；终态隐藏重复 timeline，并移除“证据不足”等内部状态文案。
- [x] 8.20 Agent 接管输入时分离视觉终端历史与远端 readline 缓冲区，在卡片下方提供独立空提示符，防止新问题拼接上一轮自然语言。
- [x] 8.21 审批识别同时依据 `pendingApproval`，新输入不再暂停旧 task；版本升级到 1.0.14 以强制刷新 Electron 静态资源缓存。
- [x] 8.22 将成功的单行标量 Shell 输出转换为可引用 observed fact，避免用户名、版本号和单路径查询被误判为未完成。
- [x] 8.23 Planner 已完成且引用 observed fact 时，将模型遗漏的 pending criterion 绑定到真实 Evidence；无 fact、无引用或仍有缺失项时保持 fail-closed。
- [x] 8.24 恢复始终可见的 Shell/Agent 模式入口；未启用时引导 AI 配置；修复入口 bundle 强缓存并升级到 1.0.15，验证信息/AI 动态 chunk 不再加载旧 URL。
- [x] 8.25 修复历史 paused task 阻塞 Agent 配置同步；升级到 1.0.16，构建独立 macOS `OpsHalo.app` 并验证退出后重启不进入 Electron `default_app.asar`。
- [x] 8.26 将已执行建议冻结为原指令下方的只读步骤历史卡；活动分析窗口跟随最新 Shell 光标，下一审批锚定新提示符，并升级构建验证 macOS 应用。
- [x] 8.27 保留 Agent 卡片并改用 xterm marker/decoration 嵌入真实 scrollback；规划卡紧凑显示，审批后冻结历史卡，命令与后续卡按 buffer 顺序排列，并完成交互 E2E 与 macOS 真机验证。
- [x] 8.28 嵌入式审批与结果卡按实际内容高度扩展，移除卡内纵向滚动条，全部内容统一由终端 scrollback 查看，并完成长内容 E2E 与 macOS 成品验证。
- [x] 8.29 展开卡转入下一轮规划时冻结历史并新建两行紧凑卡；隔离 Electron E2E 与真实用户数据，验证 Agent 配置在完整退出和重启后保持启用，并升级到 1.0.19。
- [x] 8.30 执行后将已展示的完整审批详情原位收缩为两行内的只读步骤记录并回收多余占位，由 Shell 命令历史紧随其后；已消费审批的延迟或乱序 snapshot 不得在输出后复活旧卡或复制步骤记录；终态卡扩容后自动展示卡片开头并确保正文可通过终端滚动完整查看。
- [x] 8.31 移除终态结果卡中重复的“查看证据 / 清理证据 / 继续追问”操作，只保留已展开的分析内容和后续 Shell 输入入口。
- [x] 8.32 让直接查询的最终结论按原始目标返回精简值；Evidence 支持的唯一直接路径可抵抗无关完成警告；分析依据首次默认展开、后续展开或收起以及 decoration 延迟挂载时均动态重测卡片与 xterm 占位高度。
- [x] 8.33 修复执行后误删步骤历史的回归：完整审批卡在原 marker 收缩为两行内的“第 N 步已执行 · 操作目的”只读记录，Shell 命令与输出紧随其后；乱序旧审批既不能复活详情，也不能复制步骤记录，并升级、构建和启动 macOS 1.0.24。
- [x] 8.34 恢复批准后完整确认卡：原 marker 保留命令、风险、目标和说明，仅移除操作按钮；过滤不含 `finalResult` 的终态中间快照，避免第二步只显示“已结束”标题；完成 Electron 时序回归、版本升级、构建和 macOS 启动验证。

## 9. 评测、真实 Smoke 与灰度

- [x] 9.1 将确定性场景扩展到至少 30 个，覆盖查询、诊断、普通 Shell、长日志、零匹配、冲突证据、知识引用和最终综合。
- [x] 9.2 增加至少 10 个失败/取消场景，覆盖断流、超时、无效结构、binding mismatch、权限不足、未知远端状态和知识索引损坏。
- [x] 9.3 增加延迟 gate：submit ack、首生命周期、Provider TTFT、执行首输出、final synthesis、总耗时和 P50/P95。
- [x] 9.4 增加安全 gate：未审批 mutation 数必须为 0，跨主机执行数必须为 0，敏感数据泄漏数必须为 0，partial decision 执行数必须为 0。
- [x] 9.5 为每个正式支持 Provider 执行真实流式契约 smoke，并在隔离 Linux SSH 主机执行只读任务 smoke。
- [x] 9.6 对比 V1/V2 的模型回合数、重复初始化、token、完成率、证据引用率、P50/P95 和用户取消率。
- [x] 9.7 按 feature flag 顺序灰度；任一安全 gate 失败立即关闭相关 flag，记录回滚验证。
- [x] 9.8 更新用户文档、模型配置建议、隐私/retention 说明、Skill/知识格式和已知 Provider 限制。
- [x] 9.9 在真实阿里云 Linux SSH 主机验证 `Nginx 主配置 -> conf.d -> 监听端口 -> 无弹窗结束` 的连续只读审批链路。

## 10. Mini 产品面清理

- [x] 10.1 从 Renderer 菜单、设置、快捷键、IPC、启动恢复和动态加载入口生成可达性清单，明确 SSH/SFTP、本地终端、AI、主题、同步与工作区的保留边界。
- [x] 10.2 删除不可达的 Telnet、Serial、FTP、RDP、VNC、SPICE、Web 会话 Renderer、表单、Session Server、构建 stub 和仅服务这些协议的代码。
- [x] 10.3 审计 Widget、Quick Command、Batch Operation、Profile 和 MCP 的真实消费者；保留 Agent/SSH/同步需要的共享部分，删除完全不可达的功能族。
- [x] 10.4 删除已移除功能的专用依赖、资源和历史测试，并保证旧书签、历史及同步载荷被安全忽略而不破坏回滚数据。
- [x] 10.5 增加产品面、旧数据加载、依赖树和编译产物测试，证明 Mini UI 与发行代码一致且不含已移除协议。

## 11. 完成与归档条件

- [x] 11.1 所有 capability scenarios 均有自动化测试映射和通过记录。
- [x] 11.2 Linux/macOS/Windows Electron 构建通过，Codex App Server 和 OpenAI-compatible 流式路径完成打包 smoke。
- [x] 11.3 产品代码中不存在旧的 Agent 直接 SSH/MCP/SFTP 执行旁路，也不存在 Provider 原始流进入 Renderer 的路径。
- [x] 11.4 真实 smoke、性能报告、安全报告、许可证 clean-room 审查和 migration rollback 记录齐全。
- [ ] 11.5 用户明确验收后更新任务状态并归档；仅完成规格不得勾选本清单。

## 12. Codex 运行时按需下载与 1.0.26 瘦身

- [x] 12.1 增加 Codex 0.147.0 固定平台清单和主进程运行时管理器，覆盖 Electron 网络栈下载、并发合并、取消、Range/ETag 续传、大小与 SHA-512 校验、安全解压、双 smoke、原子安装和旧版清理。
- [x] 12.2 将运行时解析接入 Codex App Server；按自定义路径、OpsHalo 缓存、通过双重 smoke 的本机 Codex、固定下载的顺序解析；Agent 运行不后台下载，下载失败或取消不改变账号、当前选择或 Agent 状态，也不创建残留账号。
- [x] 12.3 增加受限 runtime IPC/preload 接口和 AI 配置页状态、大小、进度、取消、失败重试与自动继续授权交互，不向 Renderer 暴露路径、URL、校验值或进程能力。
- [x] 12.4 从生产依赖和 `asarUnpack` 移除 Codex，升级到 1.0.26；成品扫描明确拒绝 Codex npm 包与原生二进制。
- [x] 12.5 增加平台映射、并发、进度、取消、续传、Range 回退、断流、损坏恢复、超限、恶意路径、原子安装、旧版保留/清理和账号状态保持测试。
- [x] 12.6 GitHub Actions 各平台执行固定官方运行时完整性/App Server 初始化 smoke，并对 Windows、macOS、Linux 成品执行体积门禁和 SHA256SUMS 发布校验。
- [ ] 12.7 构建并发布 v1.0.26 多平台小包，验证真实 OAuth 下载后的规划流程；v1.0.25 作为最后一个内置 Codex 的离线版本保留。

## 13. Electron 稳妥瘦身与 1.0.27 发布

- [x] 13.1 从 AI 配置页、默认配置和有效配置写入中移除隐藏 Strands 选择；旧 `agentHarnessAdapter=strands` 确定性迁移为 `openai_compatible`，并保持账号、当前选择与 Agent 开关。
- [x] 13.2 删除 Strands Harness adapter 及其专用运行时路径，移除 `@strands-agents/sdk`、`openai`、`@modelcontextprotocol/sdk`、`@opentelemetry/api`、AWS/Smithy 和项目未使用的顶层 `jsonwebtoken` 声明；保留同步组件实际使用的 JWT 传递依赖。
- [x] 13.3 扩展生产依赖清理、`afterPack` 与独立成品扫描，拒绝已移除依赖、Strands adapter 和 Codex 原生二进制，并强制 `app.asar <= 18 MiB`。
- [x] 13.4 增加旧 Strands 配置迁移、账号状态保持、OpenAI Compatible/Codex Subscription 规划、依赖禁入和平台体积门禁测试。
- [x] 13.5 升级到 1.0.27，执行完整单元、Agent、AI 配置、SSH/SFTP、终端 WebGL、打包启动和 OpenSpec 验证；不得裁剪 GPU、SwiftShader、ffmpeg、语言运行支持或用户可见功能。
- [ ] 13.6 通过 GitHub Actions 发布 v1.0.27 全平台安装包与 `SHA256SUMS.txt`，满足 Windows installer `<= 90 MiB`、Windows tar.gz `< 120 MiB`、macOS DMG `< 95 MiB`、Linux包 `< 85 MiB`、Linux tar.gz `< 105 MiB`；`11.5` 与真实 OAuth 验收继续保持未勾选。
