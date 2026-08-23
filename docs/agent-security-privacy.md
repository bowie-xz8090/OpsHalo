# Agent 风险、证据与隐私

## 风险矩阵

风险取工具下限、Shell/参数分析、敏感度、成本、内置规则和用户规则中的最严格结果，任何提示或模型输出只能提高、不能降低等级。

| 维度 | 等级 | 默认处理 |
| --- | --- | --- |
| Risk | R0/R1 | 仅在 S0/S1、C0/C1 且有界时自动执行 |
| Risk | R2 | 需要审批 |
| Risk | R3 | 逐次审批，变更需验证 |
| Risk | R4 | 默认阻断；本地策略开放后仅批准一次 |
| Risk | R5 | 永久阻断，无批准按钮 |
| Sensitivity | S2/S3 | 至少审批；S3 与网络组合进一步升级 |
| Cost | C2/C3 | 宽范围或长任务至少审批 |

内置分析覆盖复合命令、管道、重定向、替换、后台、sudo、网络外发、未知命令、持续 follow、编辑器、原始设备和敏感路径。`runtime-policy.json` 的用户黑/白名单只能增加限制，不能覆盖 R5。

未知或无法完整解析的 Shell 命令按潜在变更处理，必须具备验证计划；`env/find -delete/xargs/command/nohup/timeout` 等包装形式不能伪装成自动只读动作。任务终止、暂停、重启和审批过期都会撤销内存 capability。崩溃恢复发现执行中变更时，会生成 `unknown` ChangeRecord 和强制验证义务。

## 输出与 Evidence

stdout/stderr 分流；每个 stream 保留 32 KiB head + 64 KiB tail，单 invocation 原始接收上限 2 MiB，进程内保留不超过 256 KiB。ANSI 与控制字符先清理，二进制输出只保留大小和 SHA-256。默认发给模型的 Observation 不超过 6 KiB，硬上限 8 KiB。

授权头、token、密码、连接串、私钥等在进入模型或磁盘前脱敏。工具输出总是标为 `UNTRUSTED_OBSERVATION_DATA`，边界字符会转义，不能改变系统策略或直接触发下一工具。

Evidence 使用 `evidence://<task>/<id>`，脱敏后 gzip 存储，默认 10 MiB/task、24 小时 TTL、LRU 清理。UI 以最多 64 KiB 分页读取，可删除单项或整任务证据。Audit 为脱敏追加式日 NDJSON，默认保留 30 天且总量不超过 50 MiB。

任务 snapshot 只保留恢复所需的结构化状态，默认 7 天且总量不超过 20 MiB；不保存 Provider 原始流、隐藏推理、完整 transcript、凭据或未脱敏输出。未完成的 assistant draft 只随 snapshot 短期保留。Capability probe 报告不含凭据，配置 hash 改变后立即失效；当前任务只使用创建时固定的报告快照。

延迟与 V1/V2 报告只包含 Provider 类型、终态枚举和数值指标，例如回合、token、工具/证据/验证计数及 P50/P95，不包含目标、命令、主机名、输出、prompt 或 response。运行时 recorder 默认仅在内存中保存最近 500 条，退出即清除；显式生成的发布 gate 报告属于仓库验证记录，不包含用户任务内容。

本地知识源由用户显式选择，源文件不会被整文件静默上传；与当前问题匹配的有界、已脱敏 chunk 会作为不可信上下文发送到当前任务所选 Provider。索引保存的是脱敏后的 chunk、版本与路径；默认全文索引，显式开启本地混合检索时额外生成 `local-hash-v1` 向量。知识索引持续保留到用户删除来源、关闭功能或清理应用数据；源文件变化后引用会标记过期。Skill 和知识文本均为不可信上下文，不能改变系统策略。

## 本地文件

`<userData>/agent-runtime/v1` 目录权限尽可能设置为 0700，文件为 0600。普通日志和 Renderer state 不记录 capability、HMAC secret、原始 Provider 对象、隐藏思维链或未脱敏命令输出。

macOS 发行版使用独立的 `~/Library/Application Support/OpsHalo`；开发和 E2E 使用隔离数据目录。账号凭据与普通设置分开保存，配置保存完成后才向界面返回成功，避免退出时丢失已启用状态。
