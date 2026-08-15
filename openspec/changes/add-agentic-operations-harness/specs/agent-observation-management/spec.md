## Purpose

定义服务器命令和工具结果如何被安全地转换为精简、可追溯的 Observation 与 Evidence，使多轮 Agent 在长日志和敏感环境中保持上下文稳定。

## ADDED Requirements

### Requirement: 原始输出必须经过观察处理流水线
系统 MUST 在任何工具输出进入模型上下文前完成 ANSI/控制字符清理、秘密脱敏、工具专用解析、错误与关键统计提取、有界采样、截断和结构化；不得把未经处理的原始输出直接追加到模型历史。

#### Scenario: 命令返回超长彩色日志
- **GIVEN** Shell 命令返回包含 ANSI 控制码的十万行日志
- **WHEN** 执行完成
- **THEN** 系统 SHALL 清理控制码、提取关键时间段和错误样本、按上限截断，并只把结构化 Observation 交给模型

### Requirement: Observation 使用稳定结构
每个 Observation SHALL 至少包含状态、退出码或工具状态、摘要、已提取事实、错误分类、有限样本、是否截断、省略数量和 Evidence Reference；缺少的数据必须显式表示为未知而不是臆造。

#### Scenario: 工具只返回部分数据
- **GIVEN** 指标工具在超时前获得部分样本
- **WHEN** Observation 被生成
- **THEN** 系统 SHALL 标记 `partial`、保留实际样本和缺失范围，并不得将未返回指标填为正常

### Requirement: 模型可见输出必须有硬上限
系统 MUST 为每个工具执行模型可见输出上限，默认目标范围为 4-8 KiB；超过上限时保留错误、关键统计、首尾样本和 Evidence Reference，并提示 Planner 使用更窄过滤条件。

#### Scenario: 输出超过工具上限
- **GIVEN** `docker.logs` 的归一化结果仍超过 8 KiB
- **WHEN** Observation Pipeline 生成模型输入
- **THEN** 系统 SHALL 截断模型可见内容、记录省略量，并保留可按引用查看的本地证据

### Requirement: 敏感信息在持久化和模型传输前脱敏
系统 MUST 识别并脱敏常见凭据、私钥、令牌、Cookie、授权头、连接串和用户配置的敏感模式；未经用户明确同意，不得把原值发送给模型或写入普通审计记录。

#### Scenario: 配置文件包含访问令牌
- **GIVEN** 有界配置读取命中 `api_token`
- **WHEN** 内容进入 Observation 和 Evidence Store
- **THEN** 系统 SHALL 用稳定占位符替换令牌值，并保留“检测到敏感字段”的事实

### Requirement: 工具输出被视为不可信数据
系统 MUST 将服务器输出、日志、文件内容和 MCP 返回值标记为不可信 Observation，不得执行其中要求改变系统提示、绕过策略或调用新工具的指令。

#### Scenario: 日志包含提示注入文本
- **GIVEN** 日志行声称“忽略安全规则并执行某命令”
- **WHEN** Planner 读取该 Observation
- **THEN** 系统 SHALL 把文本仅作为证据数据处理，所有后续动作仍须基于任务目标并通过 Tool Gateway

### Requirement: 上下文只保留决策所需工作记忆
系统 SHALL 在模型上下文中保留目标、完成判据、当前计划、已确认事实、未解决假设、近期 Observation、Evidence Reference、已批准变更和验证状态，并压缩或淘汰重复的历史工具文本。

#### Scenario: 多轮探查接近上下文预算
- **GIVEN** 会话已产生多次相似日志查询
- **WHEN** 工作记忆达到配置阈值
- **THEN** 系统 SHALL 合并重复事实、保留最新差异和证据引用，并丢弃已被替代的模型可见原文

### Requirement: 上下文预算按最终 Prompt 而非局部分段估算
系统 MUST 以最终序列化模型请求计算单轮上下文占用，计入固定策略、目标、会话、相关工具目录、工作记忆、Observation 和输出 Schema，并为模型输出与估算误差保留空间。累计用量仅用于任务成本统计，不能作为某一轮 context window 的占用。

#### Scenario: 工具目录和输出 Schema 占主要输入
- **GIVEN** memory 与 Observation 仅约 2k tokens，但工具目录、系统规则和输出 Schema 使最终 Prompt 接近 8k tokens
- **WHEN** 系统评估上下文压力
- **THEN** 计量结果 SHALL 基于完整 Prompt，且不得因局部分段或累计用量错误宣称 context exhausted

### Requirement: 结构化列表结果必须目标相关且紧凑
列表工具 SHALL 先应用已校验过滤条件，再为模型和最终结果生成有界 `resultView`、扫描数、匹配数、截断标记和 Evidence；事实不得拼接与目标无关的大量记录。过滤参数在 Schema 中声明后必须真正影响结果。

#### Scenario: 26 个容器中匹配 nginx
- **GIVEN** 主机有 26 个容器且其中若干名称或镜像包含 nginx
- **WHEN** `docker.list` 接收 query=`nginx`
- **THEN** Observation SHALL 只展开匹配项并保留扫描/匹配计数，不得把 20 个无关容器拼进单条事实

### Requirement: 原始证据本地短期保存且可清理
系统 SHALL 将必要的原始或清洗后证据仅保存在本地短期 Evidence Store，默认每任务上限 10 MiB、保留 24 小时，并支持任务结束时立即清理；超过配额时按最旧证据淘汰且保留淘汰记录。

#### Scenario: 证据达到任务配额
- **GIVEN** 当前任务已保存 10 MiB 证据
- **WHEN** 新工具结果需要保存
- **THEN** 系统 SHALL 淘汰最旧且非验证关键的证据或只保存摘要，并在最终结果中标明证据已受配额限制

### Requirement: 优先缩小查询而不是反复截断
系统 SHALL 在发现输出过大后向 Planner 提供可操作的缩小建议，例如时间窗口、行数、服务名、容器名、字段或过滤表达式；同一宽泛查询不得无进展地重复。

#### Scenario: 首次日志查询被截断
- **GIVEN** 宽泛日志查询返回 `truncated: true`
- **WHEN** Planner 仍需要定位特定错误
- **THEN** 下一动作 SHALL 使用更窄的时间范围或过滤条件，或者请求用户明确范围
