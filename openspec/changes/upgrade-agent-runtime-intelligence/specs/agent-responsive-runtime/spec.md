## Purpose

定义 Agent Runtime V2 的端到端流式响应、任务级 Provider 会话、真实执行进度、有界只读并发和取消契约，使用户及时获得可验证反馈，同时保持单主机和统一安全网关边界。

## ADDED Requirements

### Requirement: 提交后必须立即建立可见任务状态

系统 SHALL 在本地接受 Agent 输入后立即创建 task 和 `session.accepted` 事件，不得等待 Provider、SSH 或知识检索完成后才显示运行状态。P95 本地确认耗时 MUST 不高于 100 ms，首个安全生命周期事件 P95 MUST 不高于 300 ms。

#### Scenario: Provider 尚未返回

- **GIVEN** 用户在 Agent 模式提交自然语言请求
- **WHEN** Provider 首个响应需要数秒
- **THEN** UI 在本地阈值内显示任务已接受和当前阶段
- **AND** 用户可以立即停止任务

### Requirement: Shell 与 Agent 模式入口必须保持可见

终端控制栏 SHALL 始终展示互斥的 Shell/Agent 模式入口。Agent 开关尚未启用或 AI 配置不完整时，Shell MUST 保持活动模式；用户选择 Agent 时系统 SHALL 打开 AI 配置，MUST NOT 创建 task、接管终端输入或把输入发送给 Provider。

#### Scenario: Agent 尚未配置

- **GIVEN** 当前终端处于 Shell 模式且 Agent 开关关闭或配置不完整
- **WHEN** 用户点击 Agent 模式
- **THEN** Shell/Agent 模式入口仍保持可见
- **AND** 系统打开 AI 配置并保持 Shell 模式
- **AND** 不创建 Agent task，也不拦截下一条 Shell 输入

### Requirement: Provider 响应必须通过版本化流式协议传输

支持流式能力的 Provider adapter MUST 以增量事件传输面向用户的文本、阶段、完整结构决策和 usage。系统 MUST NOT 将隐藏思维链、reasoning token、原始请求响应或未完成工具参数发送给 Renderer。

#### Scenario: 工具参数跨多个 chunk 到达

- **GIVEN** Provider 以多个 delta 返回工具参数
- **WHEN** 参数尚未收到完成标记或尚未通过 schema 校验
- **THEN** 系统可以显示安全阶段信息
- **BUT** 不得执行、审批或向 UI 展示 partial tool arguments

#### Scenario: 流式响应中断

- **GIVEN** Provider 已输出部分用户文本但结构决策未完成
- **WHEN** 网络中断或 stream parser 报错
- **THEN** 系统将文本标记为中断
- **AND** 不执行不完整决策
- **AND** 输出脱敏的可重试错误

### Requirement: Provider 会话必须按任务复用和释放

系统 SHALL 为每个 task 创建至多一个活动 Planner Provider Session，并在后续 ReAct 回合复用。可缓存账号读取、Codex thread 创建和 Strands Agent 初始化 MUST NOT 在每个回合重复执行。任务完成、失败、取消、过期或应用关闭后，session MUST 被释放。

#### Scenario: Codex 任务包含三个规划回合

- **GIVEN** 一个 Codex Subscription task 需要三个 Planner turn
- **WHEN** 状态机依次请求三次规划
- **THEN** 系统只为该 task 创建一个 Codex thread
- **AND** 三个 turn 使用 task snapshot 固定的 model 和 reasoning 配置

#### Scenario: Provider session 失效

- **GIVEN** task 已有有效 WorkingMemory
- **WHEN** Provider session 在后续回合失效
- **THEN** 系统可在同一显式后端内重建一次 session
- **AND** 使用最小 WorkingMemory 重建上下文
- **AND** 不得静默切换其他 Provider、账号或计费路径

### Requirement: 执行进度必须反映真实输出

Execution Runtime MUST 从 SSH/PTY adapter 接收真实 stdout/stderr chunk，并在清洗、控制字符处理和脱敏后产生有界进度事件。计时心跳 MUST 标记为 timer source，MUST NOT 伪装成命令已产生输出。

#### Scenario: 长命令持续输出

- **GIVEN** 远端只读命令每秒产生输出
- **WHEN** 首批字节到达 OpsHalo
- **THEN** Renderer 在 P95 500 ms 内收到脱敏后的字节计数和安全尾行
- **AND** 完整原始输出不进入进度事件

#### Scenario: 命令长时间无输出

- **GIVEN** 命令仍在运行但没有 stdout/stderr
- **WHEN** UI 需要保持可见进度
- **THEN** 系统可以发送 elapsed/silent heartbeat
- **AND** 事件明确标记 `source=timer` 和 `silentForMs`

### Requirement: 审批后的 Shell 命令必须在原终端执行和展示

用户批准 `shell.review_exec` 后，Renderer SHALL 将批准的完整命令提交给当前绑定终端执行。命令文本、stdout、stderr、退出后的提示符和终端控制行为 MUST 由原终端展示，MUST NOT 把完整命令输出复制到 Agent 分析卡、FinalResult 卡或独立结果弹窗。Evidence 和 Observation MAY 保存经脱敏的有界副本，但不得取代终端中的原始执行体验。

#### Scenario: 用户批准只读端口查询

- **GIVEN** Agent 提议 `ss -tulnp` 或等价的有界只读命令
- **WHEN** 用户在嵌入审批卡中点击“执行”
- **THEN** 当前 Shell 像用户手动输入命令一样显示命令及 stdout/stderr
- **AND** 命令完成后显示新的 Shell 提示符
- **AND** Agent 分析文本中不重复展示整段端口结果

### Requirement: 自然语言目标必须由 Planner 逐轮解释且保持原始粒度

Session Manager MUST 将每个新自然语言目标交给当前 Planner 理解，不得按 Nginx、Docker、端口等关键词选择写死命令或写死后续步骤。需要服务器证据时，Planner SHALL 生成一条满足当前目标所需的最小 `shell.review_exec` 命令；变更 SHALL 使用 `shell.exec`。每条 Shell 动作 MUST 单独确认且授权范围只能为 `once`，结构化只读工具不得绕过用户可见的确认与终端输出链路。

#### Scenario: 仅查询 Nginx 配置文件位置

- **GIVEN** 用户输入“查询 nginx 配置文件位置”
- **WHEN** Planner 形成下一步动作
- **THEN** 命令只查询并输出配置文件路径
- **AND** 不得读取配置内容、运行语法检查、扫描 `conf.d`、查询状态或监听端口
- **AND** 命令执行前必须显示确认卡

#### Scenario: 查询 Docker 状态

- **GIVEN** 用户输入“查询 docker 状态”
- **WHEN** Planner 需要服务器证据
- **THEN** 系统显示模型生成的最小 Shell 命令并等待确认
- **AND** 不得自动调用 `docker.list` 或其他结构化读取后在 Agent 面板展示结果

#### Scenario: 创建并写入文件

- **GIVEN** 用户输入“创建新文件 test.txt，写入 hello world”
- **WHEN** Planner 识别为变更
- **THEN** 系统生成 `shell.exec` 变更动作、验证计划和审批卡
- **AND** 不得因缺少预置关键词路由而直接返回“证据不足”

#### Scenario: 光标位于输入行中间

- **GIVEN** 用户已经输入完整自然语言目标，随后把光标移动到该行中间
- **WHEN** 用户按 Enter 提交
- **THEN** Renderer SHALL 从当前 Shell 提示符之后读取完整逻辑输入行，包括光标右侧文字和终端自动换行的续行
- **AND** 清除待执行自然语言时 SHALL 先移动到行尾再清除整行，不得把右侧残留文字拼接到生成命令

#### Scenario: 模型结构化动作连续失败

- **GIVEN** 当前模型连续两次返回无效的 Planner 结构
- **WHEN** 同一模型仍能返回简单 JSON 命令建议
- **THEN** 系统 SHALL 将该 AI 生成的命令封装为正常 ToolIntent 并进入审批，不得直接显示“证据不足”
- **WHEN** 简单命令建议也无效
- **THEN** 若模型已有可见回答，系统 SHALL 在脱敏后直接展示该回答，并明确其未作为命令执行
- **AND** 若模型没有可见回答，系统 SHALL 明确显示“当前 AI 配置无法生成可确认命令，本次未执行任何操作”
- **AND** 不得使用“证据不足”等内部验证术语代替模型兼容性错误

### Requirement: 下一步决策必须发生在当前命令输出之后

每次命令完成并形成 Observation 后，Session Manager SHALL 先判断目标是否已经满足。若仍缺少必要证据，系统 MUST 在同一 task 中创建新的完整 ToolIntent，重新经过 Tool Gateway、Policy 和 Approval，并将下一轮审批文本写在当前命令输出之后；系统 MUST NOT 先把 task 标记为 complete，也 MUST NOT 要求用户点击额外的“继续检查”中间按钮。

Renderer SHALL 保留 Agent 规划、审批、历史和结果卡片，并将每张卡片挂载到 xterm normal buffer 的 marker/decoration。Renderer MUST 为卡片预留与 decoration 高度一致的真实 buffer 行，使卡片与 Shell 输出保持同一 scrollback 顺序；MUST NOT 使用相对 viewport 的绝对定位 overlay，也 MUST NOT 让卡片覆盖命令输出。

历史卡片的可见范围 SHALL 以完整占位区间计算，而不是只判断 marker 首行是否位于视口内。marker 首行滚出视口但占位区间仍与视口相交时，Renderer MUST 继续渲染卡片相交部分，使用户能使用终端滚动条连续回看完整卡片；只有整个占位区间离开视口后才可隐藏其 DOM。

审批卡 SHALL 显示实际“第 N 步”、风险、目标和完整命令，并提供“执行 / 修改 / 拒绝”按钮；修改后 SHALL 重新进行参数校验和风险评估，R5 操作 MUST NOT 提供执行入口。批准执行后 Renderer SHALL 在原 marker 位置保留完整审批内容，将其切换为只读的“已执行步骤”确认样式并移除操作按钮；命令、stdout、stderr 和新提示符随后按 Shell 原生顺序展示。完整命令、风险、目标和说明 MUST 继续可通过终端 scrollback 回看，卡片占位 SHALL 按只读内容的实际高度重新测量，既不得压缩成单行摘要，也不得留下超出内容的空白。Renderer MUST NOT 删除、移动或在输出后重复创建这条历史卡。拒绝或修改但尚未执行的审批仍可作为原位历史保留。

规划、执行、观察和分析等尚无待确认内容的中间状态 MUST 使用紧凑卡片且只显示一行当前状态。命令完成后，Renderer MUST 保留 Shell 新提示符，并将下一轮紧凑规划卡创建在该提示符的下一行；不得清除提示符或把卡片锚定到命令输出末尾。审批或最终结果到达后 SHALL 扩展当前相邻占位或在最新提示符处创建完整卡片；所有已冻结内容（包括已执行步骤的完整只读确认卡）MUST 留在原 marker 对应位置，不得随新状态移动或消失。卡片外层 MUST 与实际内容/预留行数一致，不得形成无内容的大块空洞。完整卡片 MUST 根据实际渲染内容扩展 buffer 占位行并展示全部内容，MUST NOT 设置卡片内部纵向滚动条；用户展开或收起分析依据时，Renderer MUST 重新测量内容高度、同步调整 buffer 占位并保持下方 Shell 提示符位于卡片之后。历史内容统一由终端 scrollback 和终端滚动条访问。

当完整审批/输入卡进入下一轮无待确认的规划状态时，Renderer MUST 将已批准的审批卡冻结为原位完整只读确认卡，并在最新提示符后创建新的两行紧凑卡；新规划卡 MUST NOT 继承历史卡的扩展高度，历史卡也不得被新规划 snapshot 覆盖。Electron E2E MUST 使用独立 `DATA_PATH`，MUST NOT 读取、修改或覆盖真实 OpsHalo 用户配置；AI 设置的持久化验收 MUST 覆盖保存、完全退出和同数据目录重启。

变更动作 VerificationPlan 中的 Shell 后置检查 SHALL 作为当前命令输出之后的下一轮嵌入审批卡逐条提出，不得以内部自动验证方式执行或因其需要确认而将任务终止为 `inconclusive`。

Agent 接管自然语言输入后 SHALL 立即从远端 Shell 的可编辑行缓冲区清除该输入，并将提示符与完整自然语言固化为本地终端历史记录。视觉历史与远端 readline 状态必须分离，后续输入不得与上一轮自然语言拼接。

成功命令若只返回一行受限标量（例如用户名、版本号、单个路径或状态值），Observation Pipeline SHALL 将其记录为带 Evidence 引用的 `observed` 事实。Planner 已判定目标完成且该事实满足完成条件时，Renderer SHALL 直接回到新 Shell 提示符，不得显示“未能完成”结果卡。

若 Planner 返回 `goalStatus=complete`、`missingInformation=[]` 并引用一个或多个真实存在的 observed fact，但将 criterion 遗留为 `pending`，Session Manager SHALL 使用这些已引用 fact 的有效 Evidence 将 criterion 归一化为 `passed`。缺少上述任一条件时仍须保守地保持未完成。

任务进入任意终态时，Renderer SHALL 只在终态正文 `finalResult` 已到达后创建显示“已结束”和“第 N 步”的结果卡及正文分析概括；先到达的终态状态事件 MUST NOT 单独渲染成只有标题的空卡。结果卡 MUST NOT 显示预算上限、预测总步数或“未能完成”标题。结果卡 SHALL 直接展开已有分析依据，MUST NOT 再展示“查看证据”“清理证据”或“继续追问”等重复操作按钮；用户需要发起新问题时直接在后续 Shell 提示符输入。若终态 snapshot 早于已批准 Shell 命令的 stdout/stderr 和新提示符，Renderer MUST 暂存终态并在 xterm 完成该批输出后才创建结果卡，MUST NOT 把分析结果插入命令输出之前或中间。结果卡扩展占位并恢复 Shell 提示符后，Renderer MUST 将终端定位到能够看到结果卡开头的位置；结果超过一屏时，全部内容及其后提示符 MUST 保留在 scrollback 中并可连续滚动查看，不得只露出标题或把正文裁在终端边界之外。终态失败、阻断或未完成时 SHALL 只显示一次面向用户的结果，MUST NOT 同时输出失败 timeline 与重复终态，也 MUST NOT 将 `inconclusive`、`react_steps_exhausted`、“证据不足”、“关键证据存在未解决的矛盾”、`observed` 或 `passed` 等内部状态和证据引擎术语直接展示给用户。无法生成具体结论时 SHALL 显示“目前的命令输出还不能确认全部结果”等用户可理解的说明，或省略无实际信息的字段。

#### Scenario: Nginx 配置需要三轮只读检查

- **GIVEN** 用户要求查看当前主机 Nginx 配置
- **WHEN** 主配置检查表明还存在 `conf.d` 引用
- **THEN** 主配置命令及结果先完整显示在 Shell
- **AND** `conf.d` 检查作为新的嵌入审批卡自动出现在新提示符下方
- **WHEN** `conf.d` 结果表明还需核对实际监听端口
- **THEN** 监听端口检查再次作为新的嵌入审批卡出现
- **WHEN** 监听端口结果已经满足目标
- **THEN** 终端创建结束概括卡并保留全部执行记录和新提示符

#### Scenario: 下一轮审批遇到长输出

- **GIVEN** 前一命令输出占满终端可视区域
- **WHEN** 下一轮审批创建
- **THEN** Renderer 在长输出后的当前终端位置创建嵌入审批卡
- **AND** 用户上下滚动时该卡片与 Shell 输出保持原生 buffer 顺序，不存在浮层或多余预留空洞

#### Scenario: 执行后保留完整确认历史并在新光标继续

- **GIVEN** 当前终端嵌入审批卡展示一条待执行命令
- **WHEN** 用户点击“执行”且 Shell 产生输出和新的提示符
- **THEN** 已经展示过的完整审批详情在原位置切换为绿色只读的“已执行步骤”确认卡，保留命令、风险和说明并移除操作按钮
- **AND** Shell 在该历史卡之后展示命令、完整输出和新提示符，卡片占位按实际内容高度匹配
- **AND** 当前分析状态在最新 Shell 输出之后另起一行
- **WHEN** Planner 产生下一条必要命令
- **THEN** 新审批卡出现在新提示符之后，而不是覆盖或移动 Shell 命令历史
- **AND** 用户滚动终端时可以回看每条完整确认历史、命令和结果，原位置不存在无内容的大块预留空白

#### Scenario: 已消费审批的延迟 snapshot 不得复活旧卡

- **GIVEN** 用户已经批准一条 Shell 命令且 Renderer 已将对应审批卡冻结为完整只读确认卡
- **AND** 命令执行期间新版规划 snapshot 先到达，旧版 `awaiting_approval` snapshot 随后延迟到达
- **WHEN** Shell 输出完成并出现新的提示符
- **THEN** Renderer SHALL 保留版本更新的规划或终态 snapshot
- **AND** 已消费的 approval request id SHALL 阻止旧审批卡再次创建
- **AND** 终端中 SHALL 只有原位置的一张完整只读确认卡，不得在命令输出后重复出现第二张记录

#### Scenario: Agent 卡片与命令输出保持同一 buffer 顺序

- **GIVEN** 一个 Agent 审批卡已经绑定到 xterm buffer marker
- **WHEN** 用户上下滚动终端
- **THEN** 该卡片与命令输出按 buffer 顺序一起滚动
- **AND** 页面中不存在停留在窗口顶部、底部或覆盖命令输出的 Agent DOM 窗口
- **WHEN** 用户点击“执行”
- **THEN** Renderer 把审批卡冻结为原位完整只读确认卡，命令行紧随其后，下一步骤卡片在新的提示符之后创建

#### Scenario: 高卡片的首行滚出视口

- **GIVEN** 一张历史结果卡占据多行 xterm buffer
- **WHEN** 用户向下滚动，使 marker 首行离开视口但卡片后续占位行仍在视口内
- **THEN** 卡片与视口相交的内容继续显示
- **AND** 不得出现只剩空白占位行的历史空洞
- **WHEN** 用户继续滚动并让整个卡片区间离开视口
- **THEN** Renderer 才可隐藏该卡片 DOM

#### Scenario: 长分析结果完整展开

- **GIVEN** Agent 返回的最终分析包含多条事实、判断或待确认内容
- **WHEN** Renderer 将结果卡嵌入 xterm buffer
- **THEN** Renderer 按卡片的实际内容高度补足占位行并展示全部内容
- **AND** 结果卡内部不出现纵向滚动条，用户仅通过终端滚动条连续查看该卡片及前后 Shell 历史

#### Scenario: 展开分析依据后重新调整卡片高度

- **GIVEN** 已完成结果卡初始折叠分析依据并在下方显示 Shell 提示符
- **WHEN** 用户展开包含多条事实的分析依据
- **THEN** Renderer 按展开后的实际内容重新扩展卡片和 buffer 占位
- **AND** 全部正文可见，Shell 提示符移动到卡片之后且不覆盖正文

#### Scenario: 终态首次渲染时分析依据已经展开

- **GIVEN** `inconclusive`、`partial` 或失败终态默认展开分析依据
- **AND** xterm decoration 的首个 render 晚于终态 snapshot
- **WHEN** decoration DOM 完成挂载
- **THEN** Renderer SHALL 自动重新测量并补足全部 buffer 占位行
- **AND** 不得因首次测量尚无 DOM 而永久保留两行规划高度
- **AND** Shell 提示符只能恢复在完整卡片之后

#### Scenario: 执行后的下一轮规划独立使用紧凑高度

- **GIVEN** 当前步骤曾展示并扩展完整审批卡
- **WHEN** 用户批准执行且同一任务进入下一轮规划
- **THEN** 原审批卡冻结为按完整内容高度展示的只读确认卡，Shell 命令历史紧随其后
- **AND** 新规划卡在最新提示符后以两行紧凑高度创建，不继承上一卡片高度，也不重复历史卡内容

#### Scenario: 终态状态事件先于结果正文到达

- **GIVEN** Session Manager 先发布状态变为终态的事件，随后才发布携带 `finalResult` 的完成事件
- **WHEN** Renderer 收到第一个没有 `finalResult` 的中间快照
- **THEN** Renderer 保持当前分析卡，不得显示只有“已结束”标题的空结果卡
- **WHEN** 携带 `finalResult` 的完成事件到达
- **THEN** Renderer 在同一最新位置扩展并完整展示结束标题、分析结论和可用依据

#### Scenario: 测试与真实 AI 配置隔离

- **GIVEN** 用户已保存并启用 AI Agent 配置
- **WHEN** 开发者运行 Electron E2E 后完全退出并重新启动正式应用
- **THEN** E2E 仅修改其独立数据目录，用户的后端、账号引用和 Agent 开关保持不变

#### Scenario: 结束态使用用户可读文案

- **GIVEN** 完成判定为 inconclusive、blocked、partial 或 failed
- **WHEN** Renderer 展示最终结果
- **THEN** 卡片标题显示“分析结果”，并可使用“仍需确认”“操作未执行”等用户可读状态
- **AND** 不显示问号状态图标、“证据不足”、内部英文枚举或证据引擎诊断语句
- **AND** 已确认事实和操作状态使用中文说明，无法解释的内部字段不展示

#### Scenario: 结束态不展示重复操作按钮

- **GIVEN** 最终结果卡已经展开分析概括及分析依据
- **WHEN** Renderer 展示该终态卡片
- **THEN** 卡片不展示“查看证据”“清理证据”或“继续追问”按钮
- **AND** 用户可通过终端历史查看分析，通过结果卡后的 Shell 提示符直接发起新问题

#### Scenario: 任务提前结束时显示实际步数和概括

- **GIVEN** 任务在第二步或第三步后已经完成、停止或无法继续
- **WHEN** Renderer 收到终态 snapshot
- **THEN** 标题显示“已结束”和实际的“第 N 步”
- **AND** 不显示 `/12` 或任何预测总步数
- **AND** 正文概括已执行内容、观察结果和仍待确认事项，不以“未能完成”作为主标题

#### Scenario: 卡片确认拒绝或修改

- **GIVEN** 当前终端显示一张包含待确认命令的嵌入审批卡
- **WHEN** 用户点击“拒绝”
- **THEN** Renderer SHALL 拒绝该审批且不得向远端 Shell 发送命令
- **WHEN** 用户点击“修改”、编辑命令并提交重新检查
- **THEN** Renderer SHALL 提交修改后的命令重新进行策略检查，旧审批卡继续保留在 scrollback 中
- **AND** Renderer SHALL 以 `pendingApproval` 的存在作为卡片可交互的事实来源，不得因状态事件与 snapshot 到达顺序不同而误触发普通 Shell 输入

#### Scenario: 同版本修复后的静态资源更新

- **GIVEN** 用户已经运行过同一补丁版本的旧前端 bundle
- **WHEN** 安装包含 Agent 交互修复的新构建
- **THEN** 应用版本和静态资源 URL SHALL 更新，Chromium 不得继续复用旧 JS/CSS 缓存
- **AND** HTML、主 JS 和主 CSS MUST 重新校验，只有带内容哈希的动态 chunk MAY 使用 immutable 强缓存

### Requirement: 流式内容必须在跨边界前脱敏

助手文本、execution chunk、safe last line、Observation delta 和错误消息 MUST 在进入 IPC、模型、普通日志或持久化前完成敏感信息脱敏。脱敏器 MUST 能检测跨 chunk 的秘密模式。

#### Scenario: API Key 被拆分到两个 chunk

- **GIVEN** 敏感值的前半部分和后半部分位于相邻 chunk
- **WHEN** 流式处理器接收第二个 chunk
- **THEN** 滑动窗口脱敏器屏蔽完整敏感值
- **AND** Renderer、模型和日志均看不到原值

### Requirement: 只读并发必须有界且逐动作授权

系统 MAY 并发执行最多三个独立动作，但每个动作 MUST 位于当前 task 的同一主机、声明 `parallelSafe`、独立通过 Tool Gateway，且风险不高于 `R1/S1/C1`。变更、交互、提权、网络外传、未知风险和存在依赖的动作 MUST 串行。

#### Scenario: 两个独立只读探查

- **GIVEN** Planner 提议读取服务状态和监听端口
- **AND** 两个工具均声明 parallel-safe 并通过策略
- **WHEN** Session Manager 调度 probe bundle
- **THEN** 两个 invocation 可并发执行
- **AND** 各自拥有预算、审计、Evidence 和错误结果
- **AND** 结果按计划顺序归并

#### Scenario: Bundle 中包含变更动作

- **GIVEN** 一个 bundle 包含只读探查和服务重启动作
- **WHEN** 调度器验证 bundle
- **THEN** 系统拒绝并发调度
- **AND** 重启动作进入原有审批与串行验证流程

### Requirement: 每个任务必须保持单主机绑定

流式传输、Provider session、Skills、知识检索和只读并发 MUST NOT 改变 task 的单主机 binding。每个 invocation MUST 在发送前核对启动时冻结的 terminal session fingerprint。

#### Scenario: 用户切换标签页

- **GIVEN** task 正绑定主机 A
- **WHEN** 用户将可见标签切换到主机 B
- **THEN** task 不得将后续动作发送到主机 B
- **AND** binding 无法确认时暂停任务并使未消费审批失效

### Requirement: 取消必须贯穿 Provider 和执行层

Stop/Ctrl+C SHALL 触发统一 AbortSignal，取消当前 Provider turn、等待中的知识检索、未发送的只读 bundle 动作和运行中的 Execution Runtime。系统 MUST 报告远端进程终止是 confirmed 还是 unknown。

#### Scenario: 用户在模型流式输出时停止

- **GIVEN** Provider 正在输出 assistant delta 且尚未提出动作
- **WHEN** 用户点击 Stop
- **THEN** 系统停止本地 stream 消费并请求取消 Provider turn
- **AND** 不再创建新 ToolIntent
- **AND** task 进入 cancelled 状态

### Requirement: 流式事件必须支持去重和重连

所有 V2 AgentEvent MUST 带 task 内严格递增 sequence 和 snapshot version。Renderer MUST 忽略重复事件，并在发现 sequence 缺口时停止增量应用并请求安全 snapshot。

#### Scenario: Renderer 重连并收到重复 delta

- **GIVEN** Renderer 已应用到 sequence 20
- **WHEN** 重连后再次收到 sequence 18 至 22
- **THEN** Renderer 忽略 18 至 20
- **AND** 只应用连续的 21 至 22
- **AND** 不重复显示文本或工具动作
