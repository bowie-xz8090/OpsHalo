# Agent 故障排查

## Agent 未启动

确认 AI 配置完整、`agentModeEnabled` 已开启并重启应用。总开关关闭时仍使用旧 Smart Shell，这是预期兼容行为。

如果选择 Codex Subscription，还需至少有一个状态为 `authenticated` 的当前账号。App Server、OAuth、额度和账号切换问题见 [`agent-codex-subscription.md`](agent-codex-subscription.md)。Codex 后端失败不会自动改用已保存的 API Key。

## 一直显示证据不足

查看 Timeline 中的 `missingInformation`、截断提示和完成判据。Agent 会在信息不足、证据矛盾、预算用尽或变更未验证时主动停止。缩小问题范围或提供非敏感补充信息后发起 follow-up；不要粘贴密码、私钥或 token。

## 命令被阻断

审批卡会显示匹配规则。R5 不能批准；R4 默认关闭；mutation 与 external MCP 还分别依赖 feature flag。修改 Shell 命令后必须点击“重新检查风险”，旧审批不可用。

## Ctrl+C 后远端任务仍可能存在

系统先发送温和中断，再在宽限期后关闭当前 exec/SFTP channel，不关闭 SSH 会话。断线、超时或取消可能得到 `unknown/unconfirmed`，此时必须用只读检查确认实际状态，不能把 channel 关闭当成进程已结束。

## Strands 加载失败

确认发行目录包含 `@strands-agents/sdk`、`@modelcontextprotocol/sdk`、`@opentelemetry/api`、`openai` 和 `zod`。SDK 是 ESM，由 Main 动态导入。仅在确有 SDK 兼容问题且接受同 Provider 适配器时开启 `agentCompatibleFallbackEnabled`；网络不可达不会通过回退变成成功。

## 证据或任务占用空间

在最终卡或 Evidence Drawer 清理证据。自动清理周期和配额见 `agent-security-privacy.md`。任务 snapshot 元数据默认保留 7 天；Audit 默认 30 天/50 MiB。
