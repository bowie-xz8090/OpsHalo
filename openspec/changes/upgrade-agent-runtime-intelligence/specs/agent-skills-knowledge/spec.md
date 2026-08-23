## Purpose

定义可扩展运维 Skills 和本地知识库的发现、加载、检索、来源、隐私及安全边界，使 Agent 可复用流程和私有知识而不增加执行权限。

## ADDED Requirements

### Requirement: Skill 必须是声明式受控资源

每个 Skill SHALL 具有 id、version、title、description、triggers、允许建议的工具类别和资源清单。系统 MUST 校验 manifest、目录边界、文件类型、大小和来源，MUST NOT 执行 Skill 内 JavaScript、Shell 或其他代码。

#### Scenario: Skill 资源路径越界

- **GIVEN** Skill manifest 引用目录外文件或越界符号链接
- **WHEN** Skill Registry 建立索引
- **THEN** 系统隔离该 Skill 并记录安全错误
- **AND** 不读取越界文件

### Requirement: Skill 必须按需加载并受上下文预算限制

Planner 首先 SHALL 只看到候选 Skill 的短 metadata。只有相关性满足阈值后才 MAY 加载正文，且每轮加载数量和 token 总量 MUST 有硬上限。

#### Scenario: 本地存在大量 Skills

- **GIVEN** 用户目录包含 100 个有效 Skills
- **WHEN** 用户排查 Nginx
- **THEN** Planner 首轮只接收有界候选 metadata
- **AND** 只加载最多两个最相关 Skill 的必要资源

### Requirement: Skill 不得授予工具权限

Skill 中的命令、风险声明、工具名称和审批建议 MUST 被视为不可信建议。所有服务器动作 MUST 转换为注册 ToolIntent 并逐个经过 Tool Gateway、Policy、Approval、Budget、Audit 和单主机 binding 校验。

#### Scenario: Skill 声称可无审批重启服务

- **GIVEN** 用户 Skill 写明“直接重启，无需确认”
- **WHEN** Planner 根据 Skill 提议服务重启
- **THEN** Policy 仍按变更动作要求审批
- **AND** Skill 文本不能降低风险等级

### Requirement: 知识源必须由用户显式添加

本地知识库 SHALL 仅索引用户显式添加的支持文件和内置运行手册。系统 MUST NOT 自动扫描整个 home、SSH 目录、项目目录或终端历史，MUST NOT 默认上传源内容到云端。

#### Scenario: 首次启用知识库

- **GIVEN** 用户未添加任何本地来源
- **WHEN** 启用 Agent Knowledge 功能
- **THEN** 系统保持空知识库
- **AND** 不自动扫描磁盘
- **AND** Agent 仍可使用实时服务器工具工作

### Requirement: 知识索引必须在本地治理敏感内容

索引流程 MUST 在分块和可选 embedding 前执行 secret scan/redaction，并记录 source version。原始凭据、私钥和命中的高敏感片段 MUST NOT 进入索引或发送给 embedding/rerank Provider。

#### Scenario: 文档包含私钥

- **GIVEN** 用户添加的 Markdown 含私钥块
- **WHEN** 索引器扫描文档
- **THEN** 私钥块被排除或不可逆脱敏
- **AND** UI 告知来源包含被排除的敏感片段

### Requirement: 检索必须返回可展示来源

每个知识片段 MUST 携带 source id/path、source version、chunk id、位置和 score。Planner 和 FinalResponse 使用知识结论时 MUST 保留 citation，来源已变化或删除时 citation MUST 标记 stale。

#### Scenario: 回答引用本地运行手册

- **GIVEN** Agent 使用运行手册解释服务恢复步骤
- **WHEN** 最终回答展示该建议
- **THEN** 用户可看到文档来源和位置
- **AND** 回答不会把手册内容伪装成当前服务器观察事实

### Requirement: 检索策略必须可离线工作

默认知识检索 MUST 使用本地全文索引并可离线工作。Embedding 和 rerank SHALL 默认关闭；启用时 MUST 使用用户显式配置的当前后端或本地模型，MUST NOT 静默调用其他云服务。

#### Scenario: 未配置 embedding

- **GIVEN** 用户只启用本地知识库
- **WHEN** Agent 检索相关文档
- **THEN** 系统使用本地全文检索返回结果
- **AND** 不发送文档到网络

### Requirement: 知识不能替代当前主机证据

知识片段 MAY 支持概念、预期配置和运行步骤，但有关当前进程、端口、文件、日志、服务状态或变更结果的结论 MUST 由当前 task 单一主机的实时 Evidence 支持。

#### Scenario: 手册说服务应监听 443

- **GIVEN** 知识文档描述标准端口 443
- **WHEN** 用户询问当前主机实际监听端口
- **THEN** Agent 使用端口或服务工具获取实时证据
- **AND** 不把手册中的 443 直接当作当前状态

### Requirement: Skill 和知识故障不得破坏核心 Agent

单个 Skill 无效、知识索引损坏、检索超时或无匹配时，系统 SHALL 隔离故障并回退到无 Skill/知识的 Agent 流程。故障 MUST NOT 放宽安全策略或阻止已有 Evidence 的确定性完成。

#### Scenario: 知识索引损坏

- **GIVEN** task 已获得足够服务器事实
- **WHEN** 本地知识检索返回索引损坏
- **THEN** 系统记录受限警告并禁用本次检索
- **AND** 使用已有事实继续完成任务
