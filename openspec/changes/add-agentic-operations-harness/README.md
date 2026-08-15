# add-agentic-operations-harness

为 OpsHalo 增加基于 Harness 与 ReAct 的安全多轮服务器运维 Agent 设计

## 当前状态

规划完成，尚未开始产品代码实现。OpenSpec 严格校验已通过。

## 设计索引

- [proposal.md](./proposal.md)：动机、范围、能力拆分、兼容性和成功判据
- [design.md](./design.md)：总体架构及完整详细设计，包括模块文件树、接口/Schema、事件与 IPC、状态与持久化、工具目录、风险与审批、输出治理、验证、四类 UI 线框、交互矩阵、迁移和 phase gate
- [tasks.md](./tasks.md)：按依赖排序的实施与验收清单
- `specs/agent-orchestration/spec.md`：ReAct 编排与终止契约
- `specs/agent-tool-safety/spec.md`：工具风险、审批和执行安全契约
- `specs/agent-observation-management/spec.md`：输出、上下文和证据契约
- `specs/agent-operation-verification/spec.md`：结论和变更验证契约
- `specs/agent-terminal-experience/spec.md`：光标提示面板交互契约

## 后续 OpenSpec 流程

- 设计变更：使用 `$openspec-update-change` 更新本 change，并重新严格校验。
- 开始实现：由用户明确发起 `$openspec-apply-change`，按 `tasks.md` 推进。
- 实现完成：完成测试与逐项验收后使用 `$openspec-archive-change` 归档为主规格。

不要在仅更新设计时勾选实现任务，也不要在验证失败或遗留安全旁路时归档。
