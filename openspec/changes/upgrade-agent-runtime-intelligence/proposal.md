## Why

OpsHalo 已有 Agent Harness、安全网关、审批、证据和验证骨架，但当前实现仍以“请求完成后一次性返回”为主：OpenAI Compatible 路径未提供文本流，部分 Provider 每轮重新创建 Agent 或线程；SSH 执行层主要发送计时心跳而非真实输出增量；普通 Shell 输出很难转化为可引用事实；最终结论主要依赖确定性事实拼接，缺少受证据约束的自然语言综合。这些问题让任务看起来长时间无响应，也限制了多轮排障的连贯性和答案质量。

本变更在不改变单主机和安全边界的前提下，建立“立即反馈、持续流式、会话复用、增量观察、证据化综合、模型能力探测、Skills/本地知识增强、可量化评测”的 Agent Runtime V2。

## What Changes

- 新增 task-scoped Provider Session。一次任务复用同一 Provider 会话、Codex thread 或 Strands Agent，避免每个 ReAct 回合重复登录、探测和建线程。
- 新增统一流式事件协议，传输安全的助手文本增量、Provider 阶段、真实命令输出进度、用量和最终结果；不传输隐藏思维链。
- 将 SSH/PTY 执行的 stdout/stderr 增量接入 Execution Runtime，在进入 UI、模型和持久化前完成控制字符清洗与密钥脱敏。
- 保留单写者状态机；仅允许最多三个相互独立、同一当前主机上的低风险只读动作并发，变更、交互、验证依赖和未知风险动作继续串行。
- 为普通 Shell 输出增加规则优先的事实候选抽取、证据区间和增量 Observation，补齐非结构化工具不能形成可靠事实的问题。
- 新增 Grounded Final Synthesizer。确定性完成判定负责“能否结束”，模型只负责将已验证事实综合成自然语言；模型失败时回退为确定性答案。
- 新增 Fast、Planner、Summarizer 三类模型角色和确定性 Verifier；支持单模型复用，也允许在同一显式后端内配置不同模型。
- 新增 Provider 能力探测和配置诊断，验证流式传输、结构化输出/工具调用、上下文窗口、超时和取消能力，并给出自动执行、受限执行或仅建议等级。
- 新增受控 Skills 目录和本地知识库。Skills 只提供流程与资源，不授予执行权限；知识检索返回来源、版本和证据，不自动触发服务器动作。
- 新增 Agent 评测套件，覆盖首个可见反馈、首个 Provider 增量、首个真实执行输出、模型调用次数、任务完成质量、安全回归和真实 Provider + SSH smoke。
- 增强终端输入路由和会话面板：支持明确的 Agent 模式及 `Shift+Enter` 强制自然语言提交，实时展示安全文本、动作和证据状态。
- 收敛 Mini 发行物的产品边界：只保留前端实际可达的 SSH/SFTP、本地终端、AI、主题、同步与工作区能力；对不可达的遗留会话、组件、服务端实现、依赖和测试先做可达性审计，再成组删除。
- 从 1.0.26 起不再把 Codex 原生运行时放入安装包；用户显式开始 Codex OAuth 或设备码授权时，主进程从固定官方清单按需下载、校验并原子安装对应平台运行时。

## Capabilities

### New Capabilities

- `agent-responsive-runtime`: 定义任务级 Provider 会话、流式事件、真实执行进度、只读并发和取消语义。
- `agent-grounded-reasoning`: 定义普通 Shell 事实抽取、工作记忆、受证据约束的总结和最终回答。
- `agent-model-profiles`: 定义模型角色、Provider 能力探测、配置契约、兼容等级和安全降级。
- `agent-skills-knowledge`: 定义 Skills、本地知识库、检索来源、隐私和 Tool Gateway 边界。
- `agent-runtime-evaluation`: 定义延迟、质量、安全、成本和真实环境验收门槛。
- `codex-on-demand-runtime`: 定义固定版本运行时清单、安全下载、校验安装、账号状态保持、Renderer 状态接口和发行物瘦身门禁。

### Modified Capabilities

无已归档能力。本变更以增量能力约束扩展仍在仓库中的 `add-agentic-operations-harness`，不重写其既有安全规格。

## Goals

- 用户提交后立即看到真实、持续且可取消的运行状态，而不是等待整个模型或命令结束。
- 减少重复 Provider 初始化和无价值模型回合，使明确只读查询快速结束，使复杂排障保持连贯上下文。
- 让结构化工具和普通 Shell 都能形成可追溯事实，最终答案清楚区分结论、证据、不确定性和后续动作。
- 让用户能判断当前 AI 配置是否适合自动 Agent，并用可解释的能力探测代替仅凭模型名称猜测。
- 用 Skills 和本地知识库沉淀运维流程与私有上下文，同时不增加模型的执行权限。
- 用确定性测试和真实 smoke 同时约束响应速度、推理质量和安全回归。
- 让源码、依赖和发行物与实际产品入口一致，避免继续维护前端不可达的遗留协议和工具。

## Non-goals

- 不实现多主机 workspace、显式选择多台主机、跨主机任务图或每动作主机选择；每个任务继续绑定启动时的当前单一终端会话。
- 不接入阿里云 ECS、磁盘、安全组、VPC、监控或其他云资源 OpenAPI。
- 不让模型直接调用 SSH、PTY、SFTP、MCP 或 Codex App Server 工具；所有动作继续经过 OpsHalo Tool Gateway。
- 不展示、保存或遥测模型隐藏思维链；只展示简短计划、阶段、依据和可审计动作。
- 不将本地知识库升级为云端资产数据库、CMDB 或远程同步服务。
- 不复制 Chaterm 的 GPL 代码，也不仿制阿里云 Workbench 的未公开内部实现；仅参考公开可观察的交互目标，采用 OpsHalo 自有实现。
- 不在本规格变更中修改产品代码、依赖或默认开关。

## Compatibility

- 现有 `add-agentic-operations-harness` 的状态机、ToolIntent、风险分级、审批令牌、Evidence Reference 和 FinalResult 保持兼容；新增字段均版本化并提供默认值。
- 功能开关关闭时继续使用现有非流式 Provider 调用、单动作循环和最终结果视图。
- 旧版单模型配置自动迁移为 Planner profile，并默认复用于 Fast/Summarizer；用户无需立即配置三套模型。
- API Key/OpenAI Compatible 与 Codex Subscription 仍互斥，系统不得跨后端、跨账号或跨计费路径静默回退。
- 不支持原生 tool calling 的模型可使用现有严格 JSON wire 协议；通过契约探测前不得获得自动执行等级。
- Renderer 只消费版本化、安全化事件；旧 Renderer 忽略未知事件，新 Renderer 在事件缺口时请求完整 snapshot。
- 当前标签页、连接指纹、策略版本和主机身份继续在 task 创建时冻结；流式和并发优化不得改变目标主机。
- 清理不可达功能不得删除或改写用户旧数据；旧书签、历史和同步载荷中的已移除类型必须被安全忽略，并保留向后回滚所需的被动数据兼容。

## Success Criteria

- 本地提交确认的 P95 不高于 100 ms，首个安全生命周期事件的 P95 不高于 300 ms。
- 在基准网络和受支持 Provider 下，首个助手文本增量 P50 不高于 2.5 秒、P95 不高于 8 秒；超出时 UI 持续显示明确阶段并允许取消。
- 远端命令产生首批 stdout/stderr 后，脱敏的执行进度事件 P95 在 500 ms 内到达 Renderer；不再用单纯 elapsed heartbeat 冒充输出。
- 同一任务内不重复执行可缓存的 Provider 登录/账号读取，Codex thread、Strands Agent 或 OpenAI-compatible 会话上下文按 task 复用并在结束时释放。
- 每个新自然语言目标和新证据批次最多触发 1 次 Planner 调用；不得用关键词固定命令跳过首轮语义理解。
- 普通 Shell 成功输出能生成带 Evidence range 的事实候选；无法可靠解析时明确标记为 observation，而不是编造事实。
- 最终回答的每个关键结论可追溯到 Evidence/Fact；证据不足、部分成功和未知远端状态不得被润色为成功。
- Provider 设置保存时能生成能力报告，并阻止未通过结构化动作测试的配置进入自动执行等级。
- Skills 和本地知识检索不能绕过工具策略、审批、脱敏、上下文预算或单主机绑定。
- 评测集至少覆盖 30 个确定性场景、10 个失败/取消场景和每个正式支持 Provider 的只读真实 smoke；任何安全回归阻止灰度扩大。
- Mini 发行物不得再导入或打包 Telnet、Serial、FTP、RDP、VNC、SPICE、Web 等无前端入口的会话实现及其专用依赖；保留的共享模块必须有明确的可达消费者和自动化测试。
- 安装包不得包含 `@openai/codex*` 或 Codex 原生二进制；Codex Subscription 首次授权可在配置页明确下载固定运行时，OpenAI Compatible 模式不触发下载。

## Impact

- 主进程 Agent 模块将新增 Provider Session、流式解析、真实执行 chunk、Grounded Synthesizer、模型 profile、能力探测、Skill Registry、Knowledge Index 和 evaluation instrumentation。
- 现有 `session-execution-bridge`、`execution-runtime`、Harness adapter、Observation parser、Completion Evaluator、Agent IPC、设置页和 Agent 终端投影需要版本化扩展。
- 本地持久化新增 provider capability report、skill metadata、知识索引、检索来源和聚合性能指标；OAuth/API Key、原始 prompt/response 和隐藏推理不得进入这些记录。
- 可选 embedding/rerank 能力必须按显式设置启用；默认知识检索可使用本地全文索引，不要求新增云服务。
- 实施时需要评估 Chaterm 许可证边界并记录 clean-room 设计来源；不得复制 GPL 文件、提示词或协议实现。
- Mini 产品面清理将删除不可达的会话 Renderer、Session Server、表单、构建 stub、专用依赖和仅验证已移除能力的测试，并增加旧数据加载与发行物依赖审计。
- Codex Subscription 增加主进程运行时管理器、受限 IPC 和配置页下载状态；运行时缓存与账号目录分离，失败或取消不得清除账号、当前选择或 Agent 开关。
