## Purpose

定义 Agent 对结构化和普通 Shell 输出的事实抽取、工作记忆、完成判定、证据化自然语言综合及不确定性表达契约。

## ADDED Requirements

### Requirement: 普通 Shell 输出必须进入通用观察流水线

当工具专用 parser 不可用时，系统 SHALL 使用确定性 generic parser 识别 JSON、表格、key-value、日志、命令错误和普通文本。系统 MUST 保留 Evidence Reference，并 MUST NOT 因无法解析而让模型补造事实。

#### Scenario: Shell 输出 key-value 状态

- **GIVEN** `shell.exec` 成功返回多行 key-value 输出
- **WHEN** generic parser 能稳定识别键和值
- **THEN** 系统生成 `confidence=parsed` 的 FactCandidate
- **AND** 每个事实包含 parser id 和 EvidenceRange

#### Scenario: 输出是不规则自由文本

- **GIVEN** 普通 Shell 返回无法可靠解析的自由文本
- **WHEN** generic parser 未找到确定结构
- **THEN** Observation 保留有界文本样本和 Evidence Reference
- **AND** `facts` 可以为空
- **AND** 模型不得把样本中的推测表达提升为已验证事实

### Requirement: 事实候选必须携带证据区间和置信等级

每个 FactCandidate MUST 包含 statement、kind、confidence、parserId、observedAt 以及至少一个 EvidenceRange。`heuristic` 事实 MUST 作为待验证线索，MUST NOT 单独满足关键完成判据或支持变更成功结论。

#### Scenario: 日志暗示端口冲突

- **GIVEN** 日志包含可能表示端口被占用的错误文本
- **WHEN** parser 只能进行启发式识别
- **THEN** 系统记录 heuristic error clue
- **AND** Planner 需要端口或进程工具补证后才能确认根因

### Requirement: 增量 Observation 必须先脱敏再进入模型

Observation delta MUST 在模型可见、UI 可见和持久化前完成 secret redaction、控制字符清理和大小限制。大输出 MUST 以 Evidence 保存，并只把目标相关的差异、错误和统计加入 WorkingMemory。

#### Scenario: 长日志持续产生重复行

- **GIVEN** 命令产生大量重复日志和一条新错误
- **WHEN** Observation Pipeline 增量归并
- **THEN** WorkingMemory 只增加去重统计和新错误事实
- **AND** 不反复把完整日志发送给 Planner

### Requirement: 工作记忆必须使用事实账本

WorkingMemory SHALL 以 fact id、未解决信息、completion criteria、最近错误、动作摘要和 verification 状态保存任务上下文。已被新证据满足的 missing information MUST 被确定性 reconciler 消解。

#### Scenario: 缺少的容器列表已经获得

- **GIVEN** Planner 先前记录“需要目标容器列表”
- **WHEN** 结构化容器查询返回完整匹配事实
- **THEN** reconciler 标记该缺口已满足
- **AND** 后续 prompt 不再重复要求相同列表

### Requirement: Observation 摘要必须受来源约束

可选 Summarizer MAY 压缩 Observation，但其输出 MUST 引用输入中存在的 fact id 或 EvidenceRange，且 MUST 无工具权限。摘要验证失败时系统 SHALL 使用确定性 reduction，不得把无来源摘要加入事实账本。

#### Scenario: 摘要模型返回不存在的证据

- **GIVEN** Summarizer 输出一个引用未知 fact id 的结论
- **WHEN** Summary Validator 检查结果
- **THEN** 该结论被拒绝
- **AND** WorkingMemory 保持原有确定性 facts

### Requirement: 是否完成必须由确定性评估器决定

CompletionEvaluator MUST 根据 completion criteria、已验证 facts、ExecutionResult 和 VerificationOutcome 产生状态。Final Synthesizer MUST NOT 将 `inconclusive`、`blocked`、`failed` 或 `cancelled` 改写为成功。

#### Scenario: 服务重启成功但验证失败

- **GIVEN** 变更命令 exit code 为 0
- **AND** 后置健康验证失败
- **WHEN** CompletionEvaluator 计算结果
- **THEN** 状态不是 satisfied
- **AND** 最终回答明确报告验证失败及可能副作用

### Requirement: 最终自然语言答案必须由证据支持

Grounded Final Synthesizer SHALL 只使用用户目标、CompletionDecision、允许的 facts、短证据片段和动作/验证结果。每个关键 claim MUST 绑定至少一个 fact id；无法绑定的 claim MUST 被删除、降为不确定性或触发一次结构修复。

#### Scenario: 复杂只读排障完成

- **GIVEN** 多个工具形成支持根因的交叉验证事实
- **WHEN** 系统生成最终回答
- **THEN** 回答围绕用户目标给出结论
- **AND** 展示关键 Evidence 链接
- **AND** 区分已确认事实、推断和未解决项

#### Scenario: 最终总结模型超时

- **GIVEN** CompletionDecision 已经 satisfied
- **WHEN** Final Synthesizer 超时或输出无效结构
- **THEN** 系统使用确定性模板返回已有结论和 Evidence
- **AND** 不把任务改成 failed

### Requirement: 明确查询不得强制增加润色回合

每次用户自然语言目标和每个新 Observation 均由 Planner 按原始目标判断下一步。系统 MUST NOT 使用按产品关键词写死的 Fast Query Lane 或 Result Projector 跳过自然语言理解。Observation 已满足目标时 Planner MUST 结束且不再生成命令；只有用户目标需要综合解释且证据已确定时，才可调用 Grounded Final Synthesizer。

明确的路径、位置、版本、用户、端口或当前值查询进入终态时，确定性回退和 Grounded Final Synthesizer SHALL 直接回答原始目标，仅保留支持该答案所需的事实。系统 MUST NOT 将同一次命令中与目标无关的语法检查、配置块、日志或后续建议拼接进主结论。

#### Scenario: 查询匹配容器为零

- **GIVEN** 用户明确查询名称匹配的容器
- **WHEN** 结构化工具完整返回零匹配
- **THEN** Result Projector 直接回答未找到匹配项
- **AND** 不因没有正向对象继续无意义探查
- **AND** 不调用模型润色

#### Scenario: 查询 Nginx 配置位置

- **GIVEN** 用户只询问“Nginx 配置在哪里”
- **AND** 命令输出同时包含配置路径、语法检查和多个 location 块
- **WHEN** 系统生成最终结论
- **THEN** 主结论直接回答配置文件路径
- **AND** 不拼接语法检查、location 块或无关后续建议

#### Scenario: 无关输出导致完成判定包含警告

- **GIVEN** 路径查询已获得带实时 Evidence 引用的唯一目标路径
- **AND** 同一命令的其他输出使通用完成判定产生无关警告
- **WHEN** 系统生成终态
- **THEN** 路径事实 SHALL 收敛为完成并直接返回该路径
- **AND** Grounded Final Synthesizer MUST NOT 覆盖或扩写这一行确定性答案
- **AND** 缺少 Evidence 引用或存在同等可信的冲突路径时仍保持未确认

### Requirement: 工具和知识文本必须视为不可信数据

Observation、Skill 和 Knowledge 内容中的指令文字 MUST NOT 改变系统规则、工具权限、审批、完成状态或主机绑定。Planner prompt MUST 明确标记这些内容为不可信引用。

#### Scenario: 日志包含提示注入文本

- **GIVEN** 远端日志要求模型忽略规则并执行写命令
- **WHEN** 日志进入 Observation 和 Planner context
- **THEN** 系统把文本作为普通证据数据
- **AND** 不改变 Tool Gateway 或 Policy 决策
