# OpsHalo 安全运维 Agent

## 使用方式

在 AI 配置中启用“Agent 能力”并重启应用。终端会话控制栏随后显示“Shell模式 / Agent模式”，每个标签页默认且独立保持 Shell 模式：所有输入原样走命令行，不会被 AI 拦截。需要排障时，在当前标签页切到 Agent 模式，再于终端提示符输入自然语言并回车；光标下方会显示任务计划、每一步动作、风险、已脱敏观察、证据和最终结论。Agent 模式中的明确 Shell 命令仍按原终端路径执行。

AI 配置可在原有 OpenAI Compatible/API Key 和 Codex Subscription 之间互斥选择；未选中的配置会保留但不会同时运行，也不会在故障时跨类型回退。Codex OAuth、多账号、额度与本地清理说明见 [`agent-codex-subscription.md`](agent-codex-subscription.md)。

活跃任务期间切回 Shell 模式会调用与“停止”相同的安全取消链。若变更已经开始，界面会先等待必要的只读后置验证完成，再恢复 Shell 输入；模式切换不会绕过验证。

Agent 一次只提出一个动作，执行结果报错时会把结构化错误和有限输出带回下一轮规划。达到 12 个 ReAct steps、8 个自动只读动作、连续 3 次错误、同等动作重复 2 次、5 分钟或 90% 上下文阈值时会停止，不会强行给出成功结论。硬上限始终为 20 步；显式批准的后台任务最多延长到任务创建后 15 分钟。

## 暂停和中断

“停止”按钮与 `Ctrl+C` 使用同一个取消链。优先级固定为：

1. 有文本选择时复制；
2. 用户已接管 PTY 时把 SIGINT 交给终端；
3. Agent 或 legacy Smart Shell 正在调用 AI 时中断 AI、队列和当前隔离执行 channel；
4. 其他情况保留终端原有 `Ctrl+C`。

若中断发生在变更动作中，界面会立即进入“正在中断”状态，Runtime 对隔离 channel 发出取消信号，但不会丢弃该动作。系统会收集 `cancelled/timeout/unknown` receipt，并在安全点完成预声明的只读后置验证后才结束任务。手工输入触发的暂停不会强制打断进行中的变更；Renderer 会等待变更与验证到达 paused 后再发送缓冲输入。

手工向终端输入内容会先暂停 Agent，再发送已缓冲的输入；切换标签页也会暂停。恢复任务时会重新核对 tab、connection、session pid、主机、用户和 cwd，旧审批不会复用。

## 审批

审批卡会显示 R/S/C 等级、完整命令或参数、主机、用户、cwd、资源、权限/交互信号、超时、前置检查、后置验证和回滚说明。Enter 不会默认批准。

- “批准一次”只绑定当前 task、invocation、session fingerprint、intent SHA-256、策略版本和有效期。
- “本任务允许完全相同操作”只在策略允许时出现，参数或会话变化会失效。
- Shell 命令可修改；修改会创建新 invocation 并重新做 Schema、风险、策略和前置检查。
- R5 永久阻断；R4 默认阻断，只有本地 runtime policy 显式开放后才能逐次批准。
- 交互/密码/编辑器/分页器不会自动执行，批准后转为人工接管，Agent 不读取或输入凭据。

## 变更与完成条件

任何变更（包括隐藏在 `shell.exec` 中的重启、写重定向等）必须在审批前声明验证计划，至少包含一个有界只读后置检查。系统记录 execution receipt 和 ChangeRecord，并强制执行检查。退出码为 0 但检查失败、检查证据不足或远端状态未知时，结果只能是 failed、partial 或 inconclusive；回滚只作为新提案出现，并重新审批和验证。

## Feature flags

- `agentModeEnabled`：Agent 能力总开关，默认 false；开启后仍需在具体标签页选择 Agent 模式。
- `agentMutationEnabled`：变更能力，依赖总开关，默认 false。
- `agentExternalMcpEnabled`：外部 MCP Agent 工具，依赖总开关，默认 false。
- `agentCompatibleFallbackEnabled`：Strands 兼容错误时使用同 Provider 兼容适配器，默认 false。

配置变更后需重启 Main runtime。

Agent 模式开启时，旧 MCP Widget 的 terminal、background、SFTP 和 ZMODEM Renderer 执行入口会 fail closed；外部 MCP 工具必须通过 Runtime 注册并取得 task-bound Gateway capability。关闭 Agent 总开关时旧 MCP 路径保持原行为。
