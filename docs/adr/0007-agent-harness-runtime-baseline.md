# ADR-0007：Agent Harness 运行时基线

- 状态：Accepted
- 日期：2026-08-14
- 对应 OpenSpec：`add-agentic-operations-harness`

## 决策

Agent Session、Harness、Tool Gateway、策略、审批、执行、Observation、Evidence、Verification 和 Audit 全部归属 Electron Main/隔离 Session Server；Renderer 仅提交专用 IPC 请求并投影事件。主规划器采用单 Planner + 确定性服务，不允许模型或 Strands SDK 直接持有 Shell、File、HTTP、MCP、PTY 或 SFTP 执行工具。

首选 Harness 固定为官方 `@strands-agents/sdk@1.13.0`，以动态 `import()` 跨越现有 CommonJS Main 与 SDK ESM 边界。模型使用现有 OpenAI-compatible 配置，Strands 每个 ReAct turn 创建全新且 `tools: []` 的 Agent，通过 `structuredOutputSchema` 只返回一个 `PlannerDecision`，避免 SDK 内部消息历史绕过本系统的事实账本和上下文压缩。

开发 Node engine 提升为 `>=20.19.0`。Strands 的必需 peer 固定为 `@modelcontextprotocol/sdk@1.30.0`、`@opentelemetry/api@1.9.1`、`openai@6.45.0` 和 `zod@4.3.6`。SDK 许可证为 Apache-2.0。

## 验证记录

- 本地 SDK 目录：4,215,217 bytes；打包清理后：3,527,366 bytes。
- MCP SDK：5,378,154 bytes；OpenAI SDK：10,094,011 bytes；Zod：4,343,491 bytes（开发安装目录口径）。
- `npm run vite-build` 和 `npm run compile` 通过。
- `npm run prepare-file` 后，从 `work/app` 动态导入 `Agent` 与 `OpenAIModel` 通过，证明 Electron 产物包含 ESM 及必要 peer。
- 无网络/连接拒绝映射为显式 `transport_error`，同 Provider 仅按 0/500/1500ms 有限重试，不跨 Provider 自动回退，不伪造离线成功。
- 只有用户显式启用 `agentCompatibleFallbackEnabled` 时，SDK 模块/构造兼容错误才切到同一 Provider 的 OpenAI Compatible Adapter；网络错误不会触发该回退。

## 独立持久化边界

运行时使用 `<userData>/agent-runtime/v1`，包含 `sessions/`、`evidence/`、`audit/` 和 `runtime-policy.json`。Snapshot 使用临时文件、fsync、rename 和目录 fsync；Evidence 在脱敏后 gzip 落盘；重启后所有非终态任务恢复为 `paused`，审批与内存 capability 失效。

## 执行入口迁移清单

| 原入口 | Agent 模式处理 |
| --- | --- |
| Renderer `agent-tools.js` | 总开关开启时拒绝直接执行；AI Chat 转为启动 Main Agent Session |
| Smart Shell | 总开关关闭保持 legacy；开启后使用 Agent Session |
| SSH `execCommand` | 仅由 `session-execution-bridge` 携 capability 调用；Main Server 与 Session Child 再验证 |
| PTY | Agent 不能输入；审批后转为用户接管 |
| SFTP | 复用当前 SSH connection 的新 SFTP channel；同一 capability 三层校验 |
| background | Gateway 登记、审批、任务内 ID、有限状态/日志/取消 |
| MCP | 注册时补全保守元数据；未知可变性不自动执行；Agent 模式下旧 Renderer MCP 执行入口 fail closed，外部 Agent MCP 默认关闭 |

## 后果

发行包会增加 SDK 与 peer 依赖体积，但执行授权边界保持在 Main/Session Server。Feature flags 默认全部关闭，因此未启用时旧 Smart Shell、聊天和 MCP 用户路径保持不变。
