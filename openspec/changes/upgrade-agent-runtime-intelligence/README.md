# upgrade-agent-runtime-intelligence

在现有单主机 Agent Harness 安全基线上，提升 OpsHalo Agent 的响应速度、持续推理、证据化回答、模型适配和可扩展知识能力。

## 当前状态

规格设计已进入实现与验证阶段。Agent Runtime V2 的核心运行时、模型配置、Skills/本地知识基础、终端原生命令执行和连续只读探查已完成首轮实现；未勾选任务仍代表待实现或待扩大验证的范围。

最近同步：OpsHalo 1.0.18 将 Agent 卡片嵌入 xterm scrollback：

- 保留规划、审批、步骤历史和最终概括卡片，但通过 xterm marker/decoration 固定在真实 buffer 行，不再使用随 viewport 浮动的窗口。
- 审批继续使用“执行 / 修改 / 拒绝”按钮；点击执行后旧卡冻结，Shell 命令从卡片占位块下方开始执行。
- Observation 需要更多证据时，在同一 task 中直接生成下一条审批，不再显示“继续检查”中间按钮。
- 下一轮审批卡创建在当前命令输出之后，所有历史随终端自然滚动，不存在 viewport 锚点漂移、遮挡或多余空洞。
- 规划中仅显示一行高度的紧凑卡；终态卡显示“已结束 · 第 N 步”和分析概括，不显示预测总步数。
- 已删除按 Nginx/Docker 关键词写死的命令和后续步骤；每轮由 Planner 根据当前自然语言与证据生成最小命令。
- 所有用户可见 Shell 动作逐条确认且只授权本次；“文件位置”等窄目标不得扩大为内容或诊断查询。
- 系统界面语言入口位于通用设置首屏，并与 AI 配置中的回答语言保持独立。
- 既有安全策略、Evidence 和真实终端执行边界保持不变。

## 设计索引

- [proposal.md](./proposal.md)：问题、范围、非目标、兼容性和成功判据。
- [design.md](./design.md)：运行时、Provider 会话、流式事件、观察/总结、模型配置、Skills、知识库、迁移和失败策略。
- [tasks.md](./tasks.md)：按依赖排序的实现、测试和灰度清单。
- `specs/agent-responsive-runtime/spec.md`：响应速度、真实进度、持久 Provider 会话和并发约束。
- `specs/agent-grounded-reasoning/spec.md`：普通 Shell 事实抽取、工作记忆、证据化总结和最终回答。
- `specs/agent-model-profiles/spec.md`：模型角色、能力探测、配置校验和安全降级。
- `specs/agent-skills-knowledge/spec.md`：Skills、本地知识库、检索来源和权限边界。
- `specs/agent-runtime-evaluation/spec.md`：延迟、质量、安全和真实环境评测门槛。

## 与现有变更的关系

本变更增量扩展 `add-agentic-operations-harness`，不得削弱其 Tool Gateway、Policy、Approval、Evidence、Verification、单主机绑定和 Electron 主进程执行边界。发生冲突时，以更严格的安全约束为准。

## 明确排除

- 不实现多主机 workspace、主机选择器或跨主机编排。
- 不接入阿里云 ECS、磁盘、安全组或其他云资源 OpenAPI。
- 不复制 Chaterm 或阿里云 Workbench 的源代码、私有协议或未公开实现。

## 后续 OpenSpec 流程

- 每次产品行为、状态机、UI 契约或验收范围变化时，必须在同一修改轮次同步对应 spec、design 和 tasks。
- 已实现且已自动化或真实 smoke 验证的任务可以勾选；其余任务继续按 `tasks.md` 的 phase gate 推进。
- 所有测试和真实 smoke 通过后才可归档。
