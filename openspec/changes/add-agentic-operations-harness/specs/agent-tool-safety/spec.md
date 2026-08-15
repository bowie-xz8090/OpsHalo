## Purpose

定义所有内部 Agent、通用 Shell、SFTP、PTY 和外部 MCP 工具必须遵守的统一风险判定、用户授权、阻断、超时、取消和审计契约。

## ADDED Requirements

### Requirement: 所有工具动作经过统一安全网关
系统 MUST 将所有 Agent 发起的工具动作提交到同一 Tool Gateway，并在主进程或隔离执行边界完成参数校验、策略判定、审批、执行和审计；渲染进程不得拥有绕过该网关的 Agent 执行路径。

#### Scenario: 内部 Agent 直接请求 SSH 执行
- **GIVEN** 渲染进程中的 Agent 生成了一条 Shell 命令
- **WHEN** 该请求未携带有效的网关决策与会话令牌
- **THEN** 主进程 SHALL 拒绝执行并记录安全事件

### Requirement: 工具必须声明安全元数据
每个已注册工具 MUST 声明输入模式、类别、可变性、最低风险、敏感度、审批策略、默认和最大超时、模型输出上限、可取消能力及结果模式；缺失必需元数据的工具不得供 Agent 使用。

#### Scenario: 注册不完整的第三方工具
- **GIVEN** MCP 工具没有声明可变性或最低风险
- **WHEN** 工具注册表加载该工具
- **THEN** 系统 SHALL 将其设为不可用于自动执行，直到管理员或用户补全安全元数据

### Requirement: 使用多轴风险判定
系统 SHALL 同时计算副作用等级 R0-R5、敏感度 S0-S3 和资源成本 C0-C3，并将工具风险下限、命令静态分析、重定向与管道、替换表达式、权限上下文、目标资源和用户策略合并为最终决策；模型风险判断只能作为提高风险的辅助信号。

#### Scenario: 只读命令包含外发管道
- **GIVEN** 基础命令看似读取日志
- **WHEN** 静态分析发现输出通过网络发送到外部地址
- **THEN** 系统 SHALL 按数据外发提高风险，且不得将其作为普通 R1 只读动作自动执行

### Requirement: 自动执行仅限有界低风险只读动作
系统 SHALL 仅自动执行 R0/R1、S0/S1 且参数有界的只读动作；网络访问、范围不明、可能高成本、读取高敏感数据或任何变更动作不得因模型声称“只读”而自动执行。

#### Scenario: 读取有限服务状态
- **GIVEN** `service.status` 被评为 R1/S0/C0 且目标服务名明确
- **WHEN** 任务仍在自动只读预算内
- **THEN** 系统 SHALL 允许无需用户确认执行并记录原因

#### Scenario: 读取远程网络资源
- **GIVEN** 动作不会修改本机但需要访问新的网络地址
- **WHEN** 策略将其评为 R2
- **THEN** 系统 SHALL 暂停并请求用户确认，不得自动执行

### Requirement: 变更和高风险动作必须获得明确决策
系统 MUST 对 R3 及以上变更、S2/S3 敏感读取、sudo、密码提示和交互式动作暂停执行；R3/R4 必须逐次获得用户批准，R5 必须阻断且不得提供“仍然执行”按钮。

#### Scenario: 用户拒绝变更
- **GIVEN** Agent 请求重启服务且审批卡已展示
- **WHEN** 用户选择拒绝
- **THEN** 系统 SHALL 不执行命令、记录拒绝并让 Planner 寻找只读替代方案或结束任务

#### Scenario: 永久阻断动作
- **GIVEN** 动作被判定为 R5，例如明显的系统级不可逆破坏
- **WHEN** Agent 请求执行该动作
- **THEN** 系统 SHALL 阻断动作、解释阻断原因并禁止通过任务级授权绕过

### Requirement: 审批信息完整且防止偷换
审批界面 SHALL 在执行前展示主机、用户、工作目录、完整命令或工具参数、风险等级、影响资源、sudo/PTY 使用、超时、预期效果、验证方式和可用回滚方案；批准令牌必须绑定这些规范化内容，内容变化后必须重新审批。

#### Scenario: 批准后参数发生变化
- **GIVEN** 用户批准了对服务 A 的一次重启
- **WHEN** 待执行动作被修改为服务 B 或增加额外管道
- **THEN** 系统 SHALL 使原批准令牌失效并重新显示审批

#### Scenario: 批准后会话身份发生变化
- **GIVEN** 用户已批准主机 A 上的动作但尚未执行
- **WHEN** 标签页重连后的主机指纹、登录用户、工作目录或策略版本与审批时不一致
- **THEN** 系统 SHALL 废弃原批准令牌、阻止执行并要求基于新会话重新评估和审批

#### Scenario: 保存设置后新任务执行只读探查
- **GIVEN** 用户保存设置后策略已刷新，随后创建绑定新策略版本的 Agent task
- **WHEN** Gateway 自动批准有界 `docker.list` 并通过 SSH execution bridge 发送动作
- **THEN** capability 的签发、Main 消费和 Session Server 校验 SHALL 全部使用该 task 的策略版本；不得使用应用启动时缓存的旧版本，也不得把内部 capability 校验失败误报为远端连接故障

### Requirement: 批准范围默认仅一次执行
系统 SHALL 默认把批准限定为当前动作的一次执行；只有用户主动选择且策略允许时，才能在当前任务内为完全匹配的低中风险动作建立临时授权，任务结束后授权必须失效。

#### Scenario: 相同变更再次被请求
- **GIVEN** 用户只批准了一次配置写入
- **WHEN** Agent 后续请求再次执行相同写入
- **THEN** 系统 SHALL 再次请求确认，除非存在明确的当前任务范围授权

### Requirement: 超时与取消由执行层强制实施
系统 MUST 为每次工具调用设置不超过工具最大值的超时，并将用户取消和任务超时传播到 SSH exec、PTY、SFTP、MCP 与后台任务；超时后不得继续静默执行后续动作。

#### Scenario: 命令超过最大执行时间
- **GIVEN** 某诊断动作最大超时为 60 秒
- **WHEN** 远端进程在 60 秒内未结束
- **THEN** 执行层 SHALL 终止或断开该动作，返回结构化 `timeout` 结果并进入重新评估

#### Scenario: 变更执行后连接中断
- **GIVEN** 已批准变更已经开始但执行结果因连接中断而未知
- **WHEN** 执行层无法证明远端动作成功或未执行
- **THEN** 系统 SHALL 将结果标记为 `unknown`，禁止自动重试并先请求只读验证

### Requirement: 交互式动作转交用户控制
系统 SHALL 识别 TTY、密码、分页器、编辑器和持续跟随等交互需求，默认不得由 Agent 自动输入凭据或无限等待；需要继续时必须转交用户或使用已声明的有限非交互替代工具。

#### Scenario: sudo 请求密码
- **GIVEN** 已批准命令在执行时出现 sudo 密码提示
- **WHEN** Agent 没有可用的无密码授权
- **THEN** 系统 SHALL 暂停自动化并将控制权交给用户，不得猜测、缓存或生成密码

### Requirement: 内外部工具使用相同策略与审计
系统 MUST 对内置工具和外部 MCP 工具应用相同的注册、风险、审批、超时、输出和审计契约，审计记录至少包含任务、会话、工具、参数摘要、策略结果、用户决策、时间、结果和证据引用。

#### Scenario: 外部 MCP 工具请求写操作
- **GIVEN** 第三方 MCP 工具声明或被识别为可变操作
- **WHEN** Agent 调用该工具
- **THEN** Tool Gateway SHALL 按对应 R3+ 规则请求批准，而不是沿用 MCP 自身的宽松许可

### Requirement: Codex App Server 不得形成第二执行通道
系统 MUST 将 Codex App Server 视为非可信工具意图来源。用于目标 SSH 服务器的结构化工具、Shell、SFTP、PTY 和 MCP 动作仍必须进入 OpsHalo Tool Gateway；App Server 的本机内置 Shell/File 能力 SHALL 被禁用或在隔离环境中拒绝，App Server 自身的批准结果不得替代本地 Policy 与 Approval 决策。

#### Scenario: App Server 请求本机命令执行
- **GIVEN** Codex App Server 产生本机 Shell/File 执行请求而不是已注册的 electerm 远程工具调用
- **WHEN** 主进程收到该请求
- **THEN** 系统 SHALL 拒绝该请求并记录安全事件，不得把它改写为目标服务器命令或让 App Server 在 electerm 进程权限下执行

#### Scenario: Codex 远程工具请求变更
- **GIVEN** Codex 通过工具桥提出目标 SSH 服务器的变更动作
- **WHEN** 动作到达 OpsHalo
- **THEN** Tool Gateway SHALL 独立执行参数校验、风险分级和本地用户审批，不能复用 App Server 的批准状态降低风险

### Requirement: Codex OAuth 凭据与账号 profile 必须隔离
系统 MUST 让官方 App Server 管理 OAuth 凭据生命周期，并按账号使用仅当前用户可读写的隔离 profile。Renderer、模型上下文、普通日志和 electerm 账号元数据不得包含原始 access token、refresh token 或 id token；系统不得导入任意 Token JSON，也不得为切换账号改写全局 `~/.codex/auth.json`。

#### Scenario: Renderer 请求账号总览
- **GIVEN** 某 Codex profile 已完成登录
- **WHEN** Renderer 请求账号列表
- **THEN** 主进程 SHALL 仅返回 profile id、脱敏账号、套餐、额度摘要和状态，不返回任何 OAuth Token 或 App Server 原始认证响应

#### Scenario: profile 目录权限不安全
- **GIVEN** 系统无法创建仅当前用户可访问的 Codex profile 目录
- **WHEN** 用户尝试登录或启用 Codex Subscription
- **THEN** 系统 SHALL 拒绝启用该 profile 并显示安全错误，不得降级到普通共享目录保存凭据
