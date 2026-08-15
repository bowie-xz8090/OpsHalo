## Why

OpsHalo 现有 Smart Shell 以单轮环境探查和命令建议为主，已有 Agent 工具循环也缺少统一的风险授权、上下文治理、停止判定和变更后验证，无法安全、可控地完成多轮服务器排障与操作。需要将 AI 模型、SSH/SFTP/MCP 工具和光标提示面板纳入一套轻量 Harness + ReAct 运行时，使 Agent 能够根据证据持续探查，同时守住用户授权和 Electron 进程边界。

## What Changes

- 新增面向单个终端会话的 Agent Session Manager，使用显式状态机编排计划、策略检查、执行、观察、压缩、验证与终止。
- 新增可替换的 Harness 接口；首期提供 Strands TypeScript 适配器，并保留现有 OpenAI 兼容调用适配器。
- 在保留现有 OpenAI Compatible/API Key 配置的同时，新增通过官方 Codex App Server 登录 ChatGPT/Codex 订阅账号的 Harness 适配器；用户必须显式选择一种 AI 后端，任一时刻只能启用一个，系统不得跨后端静默回退。
- 新增 Codex 账号总览、官方浏览器 OAuth/设备码登录、套餐与额度展示、重新授权、退出和隔离账号切换；不提供原始 `id_token`/`refresh_token` JSON 导入，也不改写用户全局 `~/.codex/auth.json`。
- 发行包固定并内置官方 Codex App Server 原生二进制，干净环境安装后不得依赖系统预装 Codex CLI、Node.js、Volta 或 Codex Desktop；自定义可执行路径仅作为显式高级覆盖项。
- 新增统一 Tool Gateway 和 Tool Registry。内部 Agent、结构化工具、通用 Shell、SFTP 与外部 MCP 调用均通过同一安全入口。
- 新增确定性的 Policy Engine、风险分级、审批管理、超时、取消、循环预算和审计；仅有界 R0/R1 且 S0/S1 的只读动作允许自动执行。
- 新增结构化只读探查工具，覆盖主机、进程、端口、服务、容器、指标、日志、配置和有限文件读取；通用 Shell 仅作为兜底能力。
- 新增 Observation Pipeline 与 Evidence Store，对输出进行清洗、密钥脱敏、结构化、摘要、截断和引用，防止上下文膨胀及工具输出提示注入。
- 新增错误分类和自适应探查、信息充分性判断、循环检测、明确的完成/需用户输入/证据不足/阻断状态。
- 所有变更操作新增前置检查和只读后置验证；失败或部分成功时不得宣称完成，回滚同样需要授权。
- 将现有光标下方 AI 提示框升级为紧凑任务时间线，展示决策摘要、动作、证据、审批卡和最终结论，但不展示模型隐藏思维链。
- 在终端会话控制栏新增每标签页独立的“Shell 模式 / Agent 模式”显式切换；Shell 模式完全保留原始命令行输入，只有 Agent 模式才将自然语言交给 Agent Harness。
- 首期通过功能开关灰度启用，并优先支持当前标签页绑定的 Linux SSH 会话。
- **BREAKING（开发环境）**：为满足官方 `@strands-agents/sdk` 和现有 Vite 8 工具链要求，项目 Node.js 开发/构建基线由 `>=16` 提升为 `>=20.19`；已打包 Electron 应用的终端用户运行方式不变。

## Capabilities

### New Capabilities

- `agent-orchestration`: 定义 Harness 适配、ReAct 状态机、任务预算、自适应探查、暂停恢复及终止语义。
- `agent-tool-safety`: 定义统一工具网关、工具元数据、风险分级、审批、阻断、超时、取消和审计规则。
- `agent-observation-management`: 定义工具输出清洗、脱敏、结构化、截断、证据存储和模型上下文压缩。
- `agent-operation-verification`: 定义证据充分性、变更前置检查、变更后验证、失败/部分成功及回滚处理。
- `agent-terminal-experience`: 定义光标提示面板的过程时间线、审批交互、原始证据查看及多轮会话衔接。

### Modified Capabilities

无。仓库当前没有已归档的 OpenSpec 能力规格；本变更建立首批能力契约。

## Goals

- 支持“自然语言问题 → 自主多轮只读探查 → 分析证据 → 必要时请求操作授权 → 执行并验证 → 输出结论”的完整闭环。
- 让安全判断、预算和执行控制由确定性代码强制实施，而不是依赖模型自律。
- 在长日志、多次工具调用和命令报错条件下仍保持上下文可控、行为可取消、结论可追溯。
- 复用现有 SSH exec、PTY、SFTP、MCP 和提示面板，避免出现彼此绕过的平行执行通道。

## Non-goals

- 首期不允许 Agent 自主执行提权、破坏性、不可逆或高敏感操作。
- 首期不实现跨标签页、跨主机的无人值守编排，也不自动安装缺失软件或自动提供密码。
- 首期不追求本地 PowerShell 与 Linux SSH 的完全策略等价；PowerShell 使用独立规则后续交付。
- 不保存或向模型暴露完整隐藏思维链，不把大段原始日志长期塞入对话历史。
- 本提案只形成规划与验收契约，不在本变更提案阶段直接修改产品代码。

## Compatibility

- 现有 Smart Shell、聊天和 OpenAI 兼容模型配置保持可用；功能开关关闭时保持旧行为，开启后每个标签页默认仍为 Shell 模式，由用户显式切换到 Agent 模式。
- AI 设置保留原有 Provider、Base URL、Model 与 API Key 字段，并新增互斥的 `OpenAI Compatible/API Key` 与 `Codex Subscription` 类型选择；切换类型不得删除另一类型的已保存配置，生效配置只能有一组。
- Codex Subscription 只用于 Agent Harness；普通 OpenAI API 调用与 ChatGPT/Codex 订阅额度相互独立，系统不得把订阅登录态伪装成 API Key，也不得在失败时自动切换计费路径。
- 不具备可靠工具调用能力的模型降级为严格 JSON 动作协议；仍不可靠时只能提供建议，不得进入自动执行模式。
- Strands 是首选 Harness 适配器而非业务层硬依赖，后续可增加 ACP、OpenHands 等适配器而不改变工具和策略契约。
- Agent 总开关、变更能力和外部 MCP 能力分别灰度且默认关闭，旧模式在开关关闭时行为不变。

## Success Criteria

- 所有 Agent 与 MCP 动作都能证明经过 Tool Gateway，渲染进程不存在可绕过审批的 Agent 执行路径。
- 有界 R0/R1 且 S0/S1 的只读探查可自动循环；网络只读、变更、交互、提权和高风险动作按策略确认或阻断。
- 默认任务在 12 个 ReAct 步骤、5 分钟、3 次连续错误等预算内可靠停止，并支持用户立即取消。
- 工具原始输出不直接无限进入模型上下文；最终结论可通过 Evidence Reference 回看证据。
- 每个变更动作都有预先声明且实际执行的验证；证据不足时输出“不确定”及缺失信息，而非强行成功。
- 单元、集成、安全回归和端到端测试覆盖允许、审批、拒绝、超时、取消、截断、重复动作、失败恢复和验证路径。
- API Key 与 Codex Subscription 的选择严格互斥；Codex 登录、账号读取、额度读取、切换、退出和 `Ctrl+C` 中断均有契约测试，且 App Server 无法绕过 Tool Gateway 操作目标服务器。
- 高置信单目标结构化只读查询在 0 次额外模型总结、1 次工具执行后直接完成；Adaptive ReAct 只在证据不足时继续规划，Provider 后续故障不得覆盖已经足够的查询证据。
- 上下文按完整序列化 Prompt 计量，Provider Schema 错误与真实 context-length 错误可区分；工具目录、Schema、Observation 和累计 usage 不再造成伪 `context_exhausted`。

## Impact

- 主要影响 `src/client/components/ai/agent.js`、`agent-tools.js`、`smart-shell-utils.js`、`src/client/components/terminal/terminal-smart-shell-overlay.jsx`、`src/client/store/mcp-handler.js`、`src/app/widgets/widget-mcp-server.js` 及相关主进程 IPC/SSH 执行代码。
- 将新增 Agent session、Harness adapter、工具注册表、策略/审批、Observation/Evidence、验证和审计模块，以及对应设置项与事件协议。
- 将新增 Codex App Server 生命周期、账号 profile、官方登录 IPC 和设置页账号总览；每个 profile 使用独立私有运行目录，OpsHalo 元数据不保存或发送原始 OAuth Token。
- Windows/macOS/Linux 各架构构建 SHALL 打包对应的固定版本 `@openai/codex` 平台原生文件并从 ASAR 外可执行目录启动；缺失时报告安装完整性错误，不回退到 PATH 上的未知版本。
- 新增官方 `@strands-agents/sdk`（Apache-2.0、Node.js 20+、ESM）依赖；实施时固定通过 Electron 打包验证的稳定版本，并将项目 Node.js engine 更新到 `>=20.19`。
- 现有 MCP 黑白名单和命令校验逻辑需要迁移到统一策略层或作为其输入，避免双轨规则产生不一致。
