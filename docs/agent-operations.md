# OpsHalo 安全运维 Agent

## 使用方式

在 AI 配置中启用“终端 Agent”并保存。终端会话控制栏会显示“Shell模式 / Agent模式”，每个标签页默认且独立保持 Shell 模式：所有输入原样走命令行，不会被 AI 拦截。需要排障时，在当前标签页切到 Agent 模式，再于终端提示符输入自然语言并回车；光标下方会显示任务计划、每一步动作、风险、已脱敏观察、证据和最终结论。Agent 模式中的明确 Shell 命令仍按原终端路径执行。

设置保存会等待主进程持久化完成。没有运行中任务时，新配置立即用于下一任务；有任务正在规划、执行或等待安全检查时，该任务继续使用创建时固定的 backend、profile、model 和能力报告，新配置会在任务暂停或结束后生效。完整退出和重新启动不会要求重复开启已保存的 Agent 开关或重新选择当前账号。

AI 配置可在原有 OpenAI Compatible/API Key 和 Codex Subscription 之间互斥选择；未选中的配置会保留但不会同时运行，也不会在故障时跨类型回退。Codex OAuth、多账号、额度与本地清理说明见 [`agent-codex-subscription.md`](agent-codex-subscription.md)。

活跃任务期间切回 Shell 模式会调用与“停止”相同的安全取消链。若变更已经开始，界面会先等待必要的只读后置验证完成，再恢复 Shell 输入；模式切换不会绕过验证。

Agent 一次只提出一个动作，执行结果报错时会把结构化错误和有限输出带回下一轮规划。达到 12 个 ReAct steps、8 个自动只读动作、连续 3 次错误、同等动作重复 2 次、5 分钟或 90% 上下文阈值时会停止，不会强行给出成功结论。硬上限始终为 20 步；显式批准的后台任务最多延长到任务创建后 15 分钟。

Agent 卡片是 xterm scrollback 中的嵌入元素，不是浮动窗口。已执行步骤冻结在原命令附近；命令、完整 stdout/stderr 和新 Shell 提示符由终端原样显示；下一步卡片出现在最新提示符下方。长卡片不使用内部纵向滚动条，历史内容统一通过终端滚动条查看。

## 模型配置建议

| 配置 | 建议 | 影响 |
| --- | --- | --- |
| Planner | 使用支持稳定流式输出和结构化工具调用的主模型 | 决定动作规划质量和首响应时间 |
| Fast | 可选；留空时不创建独立 Fast profile | 用于后续可安全分流的轻量任务 |
| Summarizer | 通常留空继承 Planner；也可指定同一 OpenAI-compatible 计费路径下的模型 | 只接收有界、已脱敏 Observation，无工具权限 |
| Context | 从 32K 起，根据 Provider 声明上限调整 | 预留输出与安全空间，达到阈值会压缩或停止 |
| Max output | 1024-4096 通常足够，默认 2048 | 过小可能截断结构化结果，过大增加延迟和费用 |
| Turn timeout | 15-60 秒，默认 30 秒 | 超时只终止当前 Provider 回合，不代表远端变更状态 |
| Structured mode | 优先 native tools；不可靠时选 JSON | 两种模式都要通过相同 schema 和一次修复边界 |
| Reasoning | 默认 medium | 高档位可能提高耗时；UI 不展示隐藏推理 |
| Temperature | 运维任务建议 0-0.3 | 降低动作与结构波动 |

“测试并保存”会执行无服务器工具权限的 capability probe，只验证认证、流式结束、schema、错误分类、本地取消和声明限制，不会触发 SSH、SFTP 或 MCP。报告为 `自动可用 / 能力有限 / 不可用`；模型配置 hash 变化后旧报告立即失效。

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
- Runtime V2 按 `agentProviderStreamingV2`、`agentExecutionOutputProgressV2`、`agentPersistentProviderSessionV2`、`agentGroundedFinalSynthesisV2`、`agentReadProbeBundleV2`、`agentModelProfilesV2`、`agentSkillsV2`、`agentKnowledgeBaseV2` 的顺序灰度。

V2 开关是内部发布/回滚控制，不是权限开关。后一步依赖前一步；任一安全 gate 失败会关闭相关开关及其后续开关。Tool Gateway、Policy、Approval、脱敏、Evidence、Verification 和 capability probe 始终开启，不受灰度开关影响。

Agent 模式开启时，旧 MCP Widget 的 terminal、background、SFTP 和 ZMODEM Renderer 执行入口会 fail closed；外部 MCP 工具必须通过 Runtime 注册并取得 task-bound Gateway capability。关闭 Agent 总开关时旧 MCP 路径保持原行为。

## Skill 与本地知识

用户 Skill 目录必须是绝对路径。目录本身或其一级子目录包含 `skill.json`，示例：

```json
{
  "id": "inspect-my-service",
  "version": "1.0.0",
  "title": "Inspect my service",
  "description": "Read-only checks for the service",
  "triggers": ["my-service", "故障"],
  "allowedToolCategories": ["service", "process", "network"],
  "resources": ["instructions.md"]
}
```

`id` 和 `version` 只允许字母、数字、点、下划线和短横线；manifest 最大 64 KiB，最多 10 个 `.md/.txt/.json/.yaml/.yml` 资源，每个资源最大 128 KiB。符号链接、路径越界和不支持的格式会被拒绝。用户 Skill 按不可信提示处理，其中写入的命令或“忽略审批”文本不会获得执行权限。

本地知识源也必须由用户显式添加绝对路径，支持单文件或目录中的 `.md/.txt/.json/.yaml/.yml` 文件。单文件最大 1 MiB，总读取上限 10 MiB，最多 5000 个 chunk。默认使用离线全文检索；只有显式选择“本地混合检索”才会生成本地 hash vector 并与关键词结果做 RRF，不调用云 embedding。引用显示来源路径与行号；源文件变化后旧引用标记为过期，远端服务器现状仍必须用实时命令 Evidence 验证。

## 已知限制

- Agent 当前只绑定当前标签页的一台 Linux SSH 主机；本地 PowerShell、多主机编排和云资源 API 不在本期范围。
- OpenAI-compatible 路径依赖 Provider 正确实现 SSE 结束、结构化 tool call 或 JSON；兼容层只允许一次结构修复。
- Codex Subscription 依赖已授权账号与 Codex App Server 通知流，不会在故障时自动切换到 API Key。
- Strands 的流式细节取决于 SDK 和具体模型；无法提供可靠文本 delta 时只显示预定义阶段状态。
- Agent 不读取交互式密码、sudo 提示、编辑器或分页器；这类操作必须批准后交给当前终端人工处理。
