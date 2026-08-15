# Agent Tool 注册指南

所有工具必须在 Main runtime 的 `ToolRegistry` 注册，并且只能由 `ToolGateway` 调用。不要从 Renderer、Harness callback 或模型 SDK 直接执行。

一个 ToolDefinition 必须声明：版本、名称、描述、category、mutability、R/S/C 下限、审批模式、默认/最大超时、原始捕获上限、模型输出上限、取消与 dry-run 能力、严格 input/result JSON Schema 和 parserId。缺少字段、Schema 不可构造或名称重复会拒绝注册。

实现约束：

- 输入必须有界：path、depth、entries、lines、bytes、samples、interval 和 timeout 都需上限。
- 结构化工具优先；Shell 只作兜底。任何接受 command 的工具使用 `parserId: shell`，确保静态分析覆盖内嵌命令。
- 工具 executor 只接受 Gateway 提供的 `{session, arguments, intent, timeoutMs, signal, receiptId, capability, progress}`。
- SSH/SFTP 使用现有 session bridge；不得保存或复制连接凭据。
- mutation 必须要求审批，并由 Planner 提供严格 VerificationPlan；后置检查必须是可自动执行的有界只读工具。
- MCP 安全元数据不完整时按 R2/S2/C2、未知可变性处理，禁止自动执行。
- executor 返回 stdout/stderr/exitCode 等原始执行结果；Observation Pipeline 负责清理、脱敏、证据和事实提取。
- 新工具需增加 Schema、策略表、成功/错误/超时/取消、缺失设施、输出截断、提示注入和旁路测试。

工具目录位于 `src/app/agent/tools/builtin/`；注册汇总位于 `src/app/agent/tools/builtin/index.js`。
