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

## 本地文件

`<userData>/agent-runtime/v1` 目录权限尽可能设置为 0700，文件为 0600。普通日志和 Renderer state 不记录 capability、HMAC secret、原始 Provider 对象、隐藏思维链或未脱敏命令输出。
