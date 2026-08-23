# Agent 故障排查

## Agent 未启动

确认 AI 配置完整并已开启“终端 Agent”。保存成功后新任务即可使用；正在运行的任务会继续使用启动时配置，待其暂停或结束后应用新配置。若完整退出后开关恢复为关闭，先确认启动的是独立 `OpsHalo.app`，而不是 `node_modules/electron` 的默认应用，并检查应用数据目录是否被清理或被 E2E 的临时 `DATA_PATH` 替代。

如果选择 Codex Subscription，还需至少有一个状态为 `authenticated` 的当前账号。App Server、OAuth、额度和账号切换问题见 [`agent-codex-subscription.md`](agent-codex-subscription.md)。Codex 后端失败不会自动改用已保存的 API Key。

## 分析结果显示“仍需确认”

展开“查看分析依据和待确认内容”，检查哪些命令输出不一致、被截断或尚未验证。Agent 会在信息不足、结果互相冲突、预算用尽或变更未验证时停止，不会显示内部 fact id、引用校验术语或“证据不足”等实现文案。缩小问题范围或提供非敏感补充信息后重新提问；不要粘贴密码、私钥或 token。

## 下一步卡片过高或历史消失

正式版本的 Agent 卡片必须嵌入 xterm scrollback：规划中只占紧凑状态行，结果出来后按完整内容扩展，不使用卡内纵向滚动条。历史卡固定在创建时的 buffer 行，通过终端滚动条查看。如果仍出现浮动、大片留白或越界隐藏，通常是旧静态 chunk 缓存或启动了旧 app bundle；在“信息”中核对版本，完整退出所有 OpsHalo/Electron 进程后从最新 `OpsHalo.app` 重启。

## 能力探测失败

`不可用`通常表示认证、网络或 Provider endpoint 失败；`能力有限`表示流式结束、结构化 schema、取消或声明 token 上限中至少一项未通过。探测不会执行服务器命令。先核对 backend、base URL、API path、model 和账号状态；修改任一 profile 配置后需要重新探测。不要通过同时配置另一计费路径来期待自动回退，API Key 与 Codex Subscription 始终互斥。

## 命令被阻断

审批卡会显示匹配规则。R5 不能批准；R4 默认关闭；mutation 与 external MCP 还分别依赖 feature flag。修改 Shell 命令后必须点击“重新检查风险”，旧审批不可用。

## Ctrl+C 后远端任务仍可能存在

系统先发送温和中断，再在宽限期后关闭当前 exec/SFTP channel，不关闭 SSH 会话。断线、超时或取消可能得到 `unknown/unconfirmed`，此时必须用只读检查确认实际状态，不能把 channel 关闭当成进程已结束。

## Strands 加载失败

确认发行目录包含 `@strands-agents/sdk`、`@modelcontextprotocol/sdk`、`@opentelemetry/api`、`openai` 和 `zod`。SDK 是 ESM，由 Main 动态导入。仅在确有 SDK 兼容问题且接受同 Provider 适配器时开启 `agentCompatibleFallbackEnabled`；网络不可达不会通过回退变成成功。

## 证据或任务占用空间

在最终卡或 Evidence Drawer 清理证据。自动清理周期和配额见 `agent-security-privacy.md`。任务 snapshot 元数据默认保留 7 天；Audit 默认 30 天/50 MiB。

## Skill 或知识源没有生效

检查路径是否为绝对路径、文件扩展名和大小是否受支持，并确认没有符号链接或路径越界。Skill 需要合法 `skill.json`；知识目录只读取当前目录中的支持文件。索引损坏会从显式来源重建。引用显示“来源已变化”时，重新保存设置或刷新配置以重建索引；不要把知识文档当作当前服务器状态，远端事实仍需命令验证。
