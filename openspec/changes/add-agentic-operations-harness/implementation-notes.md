# Implementation notes

更新日期：2026-08-15

## 已落地边界

- Main process 持有 Session Manager、Harness、Tool Registry/Gateway、Policy、Approval、Execution、Observation、Evidence、Verification 与 Audit；Renderer 只使用专用 IPC 和事件投影。
- Strands 固定为 `@strands-agents/sdk@1.13.0`，每轮创建新的 `tools: []` Agent，只接收结构化单决策。兼容回退必须显式启用、限定同 Provider，网络失败不触发回退。
- SSH exec 与 SFTP 复用现有 Session Server 连接，Main、server process、session child 三处验证 task/invocation/intent/session/policy capability。旧 Renderer Agent 工具与 Agent 模式下的 legacy MCP 执行通道 fail closed。
- 结构化工具、Shell fallback、background 与保守 MCP wrapper 统一经过 Gateway。只允许有界 R0/R1 自动只读；变更必须审批、声明后置验证并记录 ChangeRecord。
- `Ctrl+C` 与停止按钮使用统一取消链。变更中取消会等待只读验证安全点；手工输入暂停会等待安全点后再发送；崩溃恢复的未确认变更优先验证。
- 终端控制栏提供按 tab 隔离且默认 Shell 的“Shell模式 / Agent模式”选择器。Shell 不拦截输入，Agent 才路由自然语言；活跃任务切回 Shell 复用安全取消/验证链路。
- Observation/Evidence 在模型和磁盘前清理、脱敏、截断；持久化目录版本化，Session/Evidence/Audit 分别执行配额与保留策略。
- AI 后端可互斥选择原有 OpenAI Compatible/API Key 或 Codex Subscription。Codex 使用每账号隔离 `CODEX_HOME` 的官方 App Server；业务索引只存脱敏元数据，App Server 仅返回结构化规划，远程动作继续通过 Tool Gateway。
- Agent 会话采用当前活动优先的紧凑投影：提交后先本地显示可中断的 AI 状态，Codex App Server 发布 connecting/authenticating/preparing/thinking/responding 安全心跳；内部协议事件不渲染为步骤，同一 invocation 的策略、执行、观察与验证就地合并，完成历史默认折叠，审批与启动失败均在光标下原位展示。

## 自动 phase gates

`npm run test-agent` 包含 G0-G5 静态边界与契约检查、策略/capability、状态机/mailbox、持久化/恢复、Observation/Evidence、Harness、Codex App Server 安全边界、变更验证、MCP fail-closed、Ctrl+C 四态仲裁和确定性场景评估。

| Gate | 当前自动检查 |
| --- | --- |
| G0 | Node/SDK 版本固定、开关默认关闭、打包 ESM smoke |
| G1 | legacy Agent/MCP 旁路关闭、Main/Session capability 标记 |
| G2 | 25+ 内置结构化工具均有严格输入与安全元数据 |
| G3 | Strands 无 SDK 执行工具、Renderer Ctrl+C 统一仲裁 |
| G4 | 变更验证计划、审批、未知状态、安全点取消与恢复验证 |
| G5 | MCP 未知元数据保守注册；legacy Renderer MCP 在 Agent 模式 fail closed |

## 本机验证记录

- 2026-08-15 针对真实 `5.0.18` 会话“查看docker nginx-lb的nginx配置”复盘：任务在第 1 步、0 次工具执行时等待 Strands/DashScope 约 142 秒后以 `AGENT_INTERNAL_ERROR` 失败，证明故障发生在首次模型规划而非 SSH 或 Docker。现增加 `docker.nginx_config` 专用只读工具和高置信 Router，原句在完整 Session Manager/Gateway/Observation/Result Projector 场景中断言 0 次 Harness、1 次有界工具执行并返回 `nginx -T` 配置；修改配置语义仍禁止直达。Strands 单轮规划默认 45 秒硬截止、响应 Ctrl+C 且不隐式重试，超时/内部错误明确标记未发送服务器命令。API Key 新配置默认改用 OpenAI Compatible Harness；已有 Strands + DashScope 配置在 task snapshot 阶段自动固定到同 endpoint/model/key 的 direct adapter，不跨供应商或账号。验证结果：生产循环专项 30/30，`npm run test-agent` 82/82，StandardJS 与 `npm run compile` 通过。
- Windows x64 `5.0.19` 修复安装包：`dist/OpsHalo-5.0.19-win-x64-installer.exe`，194,709,974 字节，SHA-256 `9A6FD5ADA29DEB35269D2389A068E405DAFF02504AC43C91D36FF4AD14E65955`。最终 ASAR 检查确认版本 5.0.19、Nginx 配置直达路由、`docker.nginx_config`、OpenAI Compatible 默认值、DashScope adapter 选择和设置页兼容提示均已入包；包内执行原句得到 `docker-nginx-config/docker.nginx_config/nginx-lb`，DashScope + 旧 Strands 配置的 Harness selection 返回 `openai_compatible`。`win-unpacked` 使用隔离 userData 启动 8 秒保持 5 个进程并生成运行数据后清理进程。项目未配置发行证书，NSIS 外层 Authenticode 状态为 `NotSigned`。
- Windows x64 `5.0.18` 生产 Agent Loop 修复安装包：`dist/OpsHalo-5.0.18-win-x64-installer.exe`，194,708,330 字节，SHA-256 `B9AC42C2C6C3E6E2E633E16AD73321F39909600010A326BD88D2194B55B26567`。版本提升后重新执行 compile、prepare 与 NSIS x64 build；ASAR 检查确认版本 5.0.18、仅存在 `electerm-5.0.18.js`、无 5.0.17 主 bundle，并包含 Fast Query Router、Result Projector、provider-safe Planner wire 与精确 Harness 错误分类。隔离空 userData 启动验证主进程存活并拉起 4 个子进程。内置 Codex 原生二进制 Authenticode 签名有效；项目未配置发行证书，NSIS 外层状态为 `NotSigned`。
- `5.0.17` 生产 Agent Loop 恢复：针对真实失败快照复盘出“29 个工具目录 + 原始内部 Schema + 第二次无条件模型调用 + 裸 `context` 错误匹配”组合问题。四类 Planner Adapter 现统一使用 provider-safe wire schema，动态参数经 `argumentsJson/verificationPlanJson` 本地解码后再做内部 Zod/Tool Registry 校验；错误分类先读 provider code/type/status；上下文预算按最终序列化 Prompt 计量并保留输出/安全余量；每轮最多暴露 8 个目标相关工具。
- 明确查询类任务增加确定性快车道：Docker、进程、端口、主机概况与指定服务状态可在高置信时直接调用一个已注册只读工具，并由 Result Projector 基于 Evidence 完成，不再为“把成功结果转述给用户”强制调用第二次模型。诊断、日志/配置、变更、歧义、partial 和错误结果仍进入受限 ReAct 循环。`docker.list/process.list/network.ports` 的筛选参数现在真实生效；大结果区分“查询不完整”和“只展示部分”，完整原文仍进入 Evidence；快速通道从创建 intent 起即受同一 AbortSignal、Policy、Gateway、超时和审计约束。
- 2026-08-15 最终代码验证：`npm run test-agent` 80/80；新增生产循环专项与取消/场景回归 9/9；`npm run lint`、`npm run compile` 通过；编译后 Electron Playwright `test/e2e/010.agent-input-mode.spec.js` 4/4。全量 `npm run test-unit-ci` 共 198 项，193 项通过；仅 5 个既有 SSH-agent 用例因本机 Windows `ssh-agent` 服务被禁用（错误 1058）失败，未修改系统服务绕过。真实 Provider + 已登录 SSH 的端到端只读 smoke 仍需在可安全复用的在线会话中执行，不能用假 SSH 或打包成功冒充。
- `5.0.16` 修复设置刷新后的 Agent 执行回归：SSH/SFTP bridge 不再缓存应用启动时的 policy version，而是逐次使用 task snapshot 的 `featurePolicyVersion`；capability 内部错误保留原始分类并明确“命令未发送到服务器”，不再误报连接异常。Strands/OpenAI Compatible 的无效 PlannerDecision 统一执行一次结构修复，仍失败则无 ToolIntent 降级建议模式。终端把 Planner 信息缺口显示为“正在继续探查”，终止后隐藏该运行态区块；最终卡不再占满面板。`docker.list` 事实摘要增加前 20 个容器的名称、镜像和状态。
- 本轮新增并通过“设置刷新后 `docker.list -> SSH capability 双端校验 -> Observation -> complete`”确定性回归，最终结论含具体 `nginx-lb/nginx-sidecar`；AI Axios 错误日志不再记录完整 error/config/header/stack，脱敏回归证明测试凭据不进入安全消息。
- 2026-08-15 验证：`npm run test-agent` 73/73；`test/e2e/010.agent-input-mode.spec.js` 4/4（编译后的 `work/app` Electron + Playwright）；`npm run lint` 和 `npm run compile` 通过。全量 `npm run test-unit-ci` 191 项中 186 通过，5 个 SSH-agent 专用用例因本机 Windows `ssh-agent` 服务状态为 `Stopped/Disabled`、系统错误 1058 失败；该环境差异与本次 Agent 代码无关，未修改系统服务规避。
- Windows x64 `5.0.16` 中间验证包曾通过 `app.asar` 与 `win-unpacked` 启动检查，但因用户当前安装版同为 5.0.16、同名前端资源存在覆盖安装缓存风险，不作为交付件；正式修复包提升为 5.0.17 后重新编译和打包。
- Windows x64 `5.0.17` 正式测试安装包：`dist/OpsHalo-5.0.17-win-x64-installer.exe`，194,703,052 字节，SHA-256 `10B0A93743DD7F66305CCF4994CDC1EF75EA49D95F6B0487E887EB544D9BBBA8`。版本提升后重新执行 compile、Agent 73/73、lint、prepare 和 NSIS x64 build；ASAR 检查确认仅存在 `electerm-5.0.17.js`、无 5.0.16 主 bundle，且 task policy、结构修复降级、AI 错误脱敏、新信息缺口文案均入包。隔离空 userData 的 `win-unpacked` 启动验证 Main=5.0.17、Renderer 加载 `basic/electerm-5.0.17.js`、窗口存活且无 page error。内置 `codex-cli 0.147.0` OpenAI Authenticode 签名有效；NSIS 外层因项目没有代码签名证书而显示未签名。

- Agent 专项：`npm run test-agent`，63 项通过；新增覆盖生命周期心跳、内部事件过滤、同 invocation 合并和乐观启动/原位失败。
- Agent UI Playwright（1.62.1）：`test/e2e/010.agent-input-mode.spec.js` 3 项通过，覆盖默认 Shell、切换 Agent、tab 隔离、wireframe A-D、窄屏、ARIA/误批准、R5、证据分页、全部终止状态，以及 API Key/Codex Subscription 互斥切换和原 API 配置保留；`NODE_TEST` 会跳过单实例锁，避免与用户正在运行的 OpsHalo 冲突。
- G0-G5 代码级安全复核已记录在 `docs/agent-security-review-g0-g5.md`；真实主机与第三方服务的发布前渗透/故障注入仍列为残余风险。
- StandardJS、`npm run vite-build`、`npm run compile`、`npm run prepare-file` 已通过。
- `work/app` 中动态导入 Strands `Agent` 与 `OpenAIModel` 通过。
- 全量 `npm run test-unit-ci` 共 177 项，172 项通过；5 个既有 SSH agent 用例因本机 Windows `ssh-agent` 服务被禁用（错误 1058）失败，与本变更无关。
- 集成套件的 MCP live-app 用例因服务未启动而跳过，SSH hopping Docker 用例受当前命令执行环境无法创建 `cmd.exe` 子进程阻塞；已单独验证 MCP 命令策略回归 20/20 通过。
- 未在本机执行真实 Linux/SSH mutation，也未开启发布灰度；所有 Agent feature flags 继续默认关闭。
- Codex Subscription 协议测试 8 项通过；本机 `codex-cli 0.130.0` 在临时隔离 `CODEX_HOME` 下完成真实 `initialize` 与 `account/read` 握手，返回未登录状态；未发起 OAuth、未调用模型、未消耗订阅额度。Windows `.cmd` shim 使用无 `shell:true` 的受控启动并验证进程树可清理。
- Windows x64 `5.0.11` NSIS 安装包已生成；包内版本、紧凑 Agent UI、即时活动占位、Codex Provider 心跳均通过 `app.asar` 检查，`win-unpacked` 真实启动加载 `electerm-5.0.11.js`。安装包 SHA-256 为 `0764FAAC45696DC15FDFAB0679746C28FBC73D95DA2BF433779F1AD9182D8E80`。
- 修复开发/测试包重复使用相同版本资源名导致 Electron 一年缓存继续展示旧 UI 的问题：版本提升为 `5.0.11`，编译时同步 staging runtime package 版本，测试静态服务器关闭长期缓存。
- 修复 Codex Subscription 规划请求失败：Zod `z.record` 转 JSON Schema 时产生的 `propertyNames` 不被当前 Codex/OpenAI 结构化输出 schema 子集接受。新增 `toStructuredOutputJsonSchema` 在发给 App Server 前移除不兼容关键字，内部仍使用 `PlannerDecisionSchema.parse` 做最终严格校验。`npm run lint`、`node --test test/unit-ci/agent-codex-subscription.spec.js` 14 项和 `npm run test-agent` 64 项通过；Windows x64 `5.0.12` NSIS 安装包已生成，包内 schema 检查 `hasPropertyNames=false`，SHA-256 为 `0D2C36C6396FD8880AC0FEBB76F76B439731D82A1019F08EF3B6E5F61FD57F45`。
- 修复 Codex Subscription 规划回合等待 `turn/completed` 超时：补齐 App Server server request 桥接的安全回应，覆盖权限请求、用户输入、选项选择、Codex 上下文选择、MCP elicitation、无风险 `currentTime/read` 与旧式审批/实现请求，均不开放本机 Shell/File/HTTP/MCP 执行能力；规划回合等待上限由 120 秒提高到 300 秒。`node --test test/unit-ci/agent-codex-subscription.spec.js` 14 项、`npm run test-agent` 64 项和 `npm run lint` 通过；Windows x64 `5.0.13` NSIS 安装包已生成，staging 版本与协议修复检查通过，SHA-256 为 `DCAF7AE2BC3FA787446B8356286BCADB8B05FCD9EEF6782539EFDFA612F8557F`。
- 修复 Codex App Server `error` 通知触发 Node `EventEmitter` 特殊未处理错误而丢失后续 `turn/completed` 的问题；Provider 通知改为安全映射事件。结构化输出改用 Codex 支持的严格子集 wire schema，把动态对象以 JSON 字符串传输后再经本地 Zod 严格校验。发行包固定内置官方 `@openai/codex@0.147.0` 平台二进制，默认不再依赖 PATH、全局 Codex、Node/Volta 或 Codex Desktop；ASAR 解包和损坏包 fail-closed 已覆盖。`npm run test-agent` 65 项、lint、compile、UI 3 项和最终资源真实规划回合通过。
- `5.0.15` 根据终端最佳实践收敛交互：普通回答直接结束本轮；`need_user` 不再打开内嵌 textarea，而以 `inconclusive` 输出已有结论和最小确认问题，下一轮从 Shell 光标输入；已认证 SSH 会话不得再次询问登录密码，sudo/TTY/凭据仅能在具体动作展示风险并获批后转交当前终端。Shell 审批卡只显示执行/修改/拒绝，运行态和结果态均提供关闭按钮；运行态关闭先走安全取消，变更执行中会等待安全取消和必要后置验证进入终止态后才隐藏。`npm run test-agent` 66/66、StandardJS、Electron UI 3/3 通过；真实 Plus/Codex “你好”规划回合在代理重试后返回中文 `goalStatus=complete`，没有补充输入或密码请求。最终 `win-unpacked` 在独立空用户目录启动并保持 5 个进程存活 8 秒后清理，未影响已安装实例。Windows x64 安装包 `dist/OpsHalo-5.0.15-win-x64-installer.exe` 大小 194,702,138 字节，SHA-256 为 `74C422E4E114F3D638B1D117E97F2B8C6111D3D978C14A0EC6DF30A8EF5FEEE6`；包内 Codex 显示 `codex-cli 0.147.0` 且 OpenAI Authenticode 签名有效，本地 NSIS 安装包未配置项目签名证书。

## 仍需外部环境验收

- Windows/macOS/Linux 安装包与真实 SSH 发行版矩阵。
- 真实 Provider、断网/限流、SSH 断线、SFTP 大文件和 MCP 第三方 server 的端到端测试。
- Playwright 的完整响应式、读屏和人工审批交互矩阵。
- G0-G5 人工安全评审与灰度指标；完成前不得归档本 OpenSpec change。
