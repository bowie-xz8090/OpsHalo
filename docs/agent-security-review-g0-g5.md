# Agent Harness G0-G5 安全复核

复核日期：2026-08-14

复核范围：`add-agentic-operations-harness` 当前实现、46 项 Agent 契约/攻击测试、20 项 legacy MCP 回归、2 项 Agent UI Playwright 场景及 Electron 打包产物。结论只适用于当前代码与默认关闭的 feature flags，不代替发布前的真实主机渗透测试。

## Gate 结论

| Gate | 复核证据 | 结论 |
| --- | --- | --- |
| G0 Protocol | Zod strict schema、状态机合法转换、单写者 mailbox、owner-bound IPC、请求大小/频率限制、递增 event sequence、snapshot gap 恢复均有测试；Node/Strands 版本锁定且打包导入通过 | 通过 |
| G1 Gateway shadow/boundary | 总开关关闭时旧 Smart Shell 不变；开启时 legacy Renderer Agent 执行直接拒绝，legacy MCP terminal/background/SFTP/ZMODEM 入口由 `assertLegacyMcpGatewayBoundary` fail closed；策略与审计由 Main 持有 | 通过 |
| G2 Read-only | 25+ 工具全部要求 strict input schema、安全元数据和公开边界；Tool Gateway 统一做会话、风险、审批、capability、执行及审计；只有有界 R0/R1 + S0/S1 + C0/C1 自动执行；取消只影响当前 invocation channel | 通过 |
| G3 Adaptive ReAct | Strands 每轮使用新的 `tools: []` Agent，模型不能直接执行工具；事实账本、信息缺口、12/20 步、自动只读、错误、重复、时间和上下文预算由确定性代码停止；假模型数据集覆盖完成、证据不足和无进展 | 通过 |
| G4 Approved changes | approval/capability 绑定 task、invocation、intent digest、session fingerprint、policy version 和 TTL；一次消费、防重放；mutation at-most-once，必须先声明只读验证计划，取消/崩溃后仍完成或恢复验证，失败不得报告成功 | 通过 |
| G5 External MCP | 外部 MCP 未知元数据按 reversible/R2/S2/C2/always-approval 保守注册且不能降低风险；内外 MCP 共用 Gateway；Agent 模式下旧 Renderer MCP 执行入口 fail closed | 通过（保持灰度关闭） |

## 绕过面复核

| 攻击面 | 强制边界与复核结果 |
| --- | --- |
| Renderer / 旧 Agent | Renderer 只能调用专用 Agent IPC；`agent-tools.js` 在 Agent 总开关开启时拒绝 legacy 自动工具执行。Renderer 不是授权边界，即使伪造请求仍需 Main 的 owner、schema、Gateway 与 capability 校验。 |
| Main IPC | 通过 `BrowserWindow.fromWebContents(event.sender)` 绑定窗口 owner，按 channel 限流、限制序列化大小并使用 strict schema；snapshot/evidence/control 再检查 task owner。 |
| Session Server / SSH exec | Main 发出的 capability 在 Session Server 和具体 session child 重新校验；实际 session fingerprint 与 invocation 必须匹配，且 capability 一次消费。取消按 invocation 隔离，不关闭其他 SSH channel。 |
| SFTP | Agent SFTP 只接受 Gateway capability，child 重新计算 session fingerprint；读/列举/写入均有条数或字节上限，write/delete 仍由变更审批与后置验证约束。 |
| capability / 审批 | HMAC token 不落盘，绑定全部安全字段和过期时间；批准修改、暂停、重启、策略变化、会话变化和任务结束会失效；exact-task grant 只匹配相同 intent，不能复用 invocation token。 |
| MCP | legacy MCP 动作在 Agent 模式先经过边界 gate；外部 MCP 注册时补全保守元数据并复用相同 Policy Engine；模型无法直接调用 MCP SDK 工具。 |
| 事件重放 | `taskId + sequence + snapshotVersion` 去重；重复事件无副作用，缺口触发 snapshot/delta 恢复；审批仍由 Main snapshotVersion 和 pending intent 校验，重放 UI 事件不能执行。 |
| 工具输出提示注入 | stdout/stderr 在进入模型前先做控制字符清理、脱敏、截断和结构化；Prompt Builder 将其放入 `UNTRUSTED_OBSERVATION_DATA`，FactRecord 必须带 evidence reference；模型输出只产生单个候选动作，仍须重新经过 Gateway。 |
| 变更完成声明 | mutation receipt 会创建 ChangeRecord 与 verification obligation；后置检查失败、矛盾、未知或未执行时只能得到 failed/partial/inconclusive，回滚作为新的待审批动作。 |

## 已执行验证

- `npm run test-agent`：46/46。
- `node --test test/unit-ci/mcp-exec.spec.js`：20/20。
- `test/e2e/010.agent-input-mode.spec.js`：2/2，覆盖模式隔离、wireframe A-D、响应布局、ARIA、误批准、R5、证据分页和六种终止状态。
- `npm run lint`、`npm run vite-build`、`npm run compile`、`npm run prepare-file` 与打包依赖动态导入通过。
- 全量 unit 165 项中 160 通过；5 项仅受当前 Windows `ssh-agent` 服务禁用影响。

## 残余风险与发布限制

- 尚未在真实 Linux 发行版、生产 SSH、真实 Provider、第三方 MCP server 和跨平台安装包上做渗透/故障注入；这些属于 R0/R1 灰度前的环境验收。
- `agentModeEnabled`、`agentMutationEnabled`、`agentExternalMcpEnabled` 继续默认关闭；G0-G5 代码复核通过不等同于自动批准灰度。
- R4 默认阻断、R5 永久阻断；不得为了灰度降低风险下限或跳过后置验证。
