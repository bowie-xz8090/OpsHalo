# 发布门禁记录

日期：2026-08-23
版本：OpsHalo 1.0.25（macOS UI 修订；Linux/Windows 跨平台基线 1.0.19）
结论：`9.5`、`11.2`、`11.4` 通过；`11.5` 仅等待用户明确验收。

## Provider 与真实 SSH Smoke

| 路径 | 验证方式 | 结果 |
| --- | --- | --- |
| Codex Subscription | macOS 成品使用已认证 Plus 账号启动内置 Codex App Server，完成真实流式规划；在已脱敏的阿里云 Linux SSH 会话中逐次审批只读命令 | 通过。`uname -r` 返回 `5.10.134-19.5.al8.x86_64`；Nginx 连续只读链路按“主配置 -> conf.d -> 监听端口 -> 结束”运行，未后台执行未审批命令 |
| OpenAI Compatible | `agent-provider-stream-smoke.spec.js` 启动真实 loopback TCP/HTTP 服务，发送分片 SSE、tool argument delta、usage 和 `[DONE]`；分别从 macOS/Linux/Windows `app.asar` 解包后运行 | 三个平台均 `2/2` 通过；请求包含认证头且 `stream=true` |
| Strands | 使用正式 `@strands-agents/sdk`、`StrandsHarnessAdapter` 和真实 loopback TCP/HTTP/SSE，不替换 SDK Agent/client | 三个平台均 `2/2` 通过；结构化工具参数跨 SSE chunk 合并成功 |

OpenAI Compatible 与 Strands smoke 验证的是真实网络传输、SDK 和成品依赖契约，不代表外部收费账号的可用性或公网延迟。当前没有配置外部 OpenAI Compatible/Bedrock 测试凭据，因此没有把 loopback 结果描述成外部 Provider 线上测试。

## 三平台成品

| 平台 | 成品与原生边界 | 运行/契约验证 | `app.asar` SHA-256 |
| --- | --- | --- | --- |
| macOS arm64 | `dist/mac-arm64/OpsHalo.app`；OpsHalo、`node-pty`、Codex 均为 Mach-O arm64 | 1.0.25 真机启动；完整只读确认卡原位保留、旧审批乱序保护、终态正文事件时序、长结果动态高度和 AI 设置重启持久化 E2E 通过；`default_app.asar` 已移除；1.0.21 至 1.0.24 的现场回归均记录为未验收 | `20522f27d39c1a6eaab4b4d042ae7fbf243aa87a8917a5ee88a6f8338bd5fd4d` |
| Linux arm64 | `dist/linux-arm64-unpacked`；OpsHalo、`node-pty`、Codex 均为 ELF arm64；Codex 为静态 musl 可执行文件 | 带 GTK/Xvfb 的 arm64 容器中 `--version` 返回 1.0.19，GUI 进程保持运行 8 秒至测试主动终止；Codex CLI 返回 0.147.0；成品 Provider smoke `2/2` | `0857cee66af62a4060bb4266b9d60fbefcfb617ed6e45b967482f3da1621c278` |
| Windows x64 | `dist/win-unpacked`；OpsHalo/Codex/ConPTY 均为 PE32+ x64；两个 `.node` 导出 `napi_register_module_v1`，并包含 `libwinpthread-1.dll` | Electron 目录交叉构建通过；成品 Provider smoke `2/2`。当前主机没有 Windows VM，因此没有记录 Windows 真机 GUI 启动 | `8be2c97db92662803f21af5923b25dadd821d0ef12c04e378dc4f3344586a1a4` |

打包清理已修复：`.yarnclean` 不再用通配项删除依赖中的 `tools` 目录；`verify-mini-artifact.js` 现在强制检查 Codex 入口以及 Strands Agent、OpenAI model、structured output tool 和 tool runtime。三个成品都包含这些必需文件。

macOS 成品未使用 Developer ID 签名或 notarize；Windows 成品未使用发行证书签名。本门禁验证可执行目录构建和运行时内容，不替代正式商店/安装器签名流程。

## 自动化验证

- `npm run test-unit-ci`：15 个 suite、303 个测试，全部通过。
- capability manifest：40 个场景，包含 30 个功能场景和 10 个失败/取消场景。
- 定向运行时与场景门禁：50/50 通过；确定性场景执行约 3.02 秒。
- `npm run test-agent-provider-smoke`：2/2 通过。
- macOS、Linux、Windows 成品解包后分别运行 Provider smoke：每个平台 2/2 通过。
- `npm run lint`、`npm run verify-mini-artifact`、`git diff --check`：通过。
- Mini 成品检查：15 个已删除路径、7 个已删除专用模块、5 个必需运行时路径均符合预期。

## 性能报告

延迟 gate 使用 20 条确定性、仅包含数值时间戳的记录；不保存 prompt、命令、主机、输出或凭据。

| 指标 | P50 | P95 | 门限 | 结果 |
| --- | ---: | ---: | ---: | --- |
| submit ack | 10 ms | 19 ms | 100 ms | 通过 |
| first lifecycle | 109 ms | 118 ms | 300 ms | 通过 |
| Provider TTFT | 1009 ms | 1018 ms | 5000 ms | 通过 |
| execution first output | 309 ms | 318 ms | 500 ms | 通过 |
| final synthesis | 2009 ms | 2018 ms | 20000 ms | 通过 |
| total | 3009 ms | 3018 ms | 300000 ms | 通过 |

V1/V2 对比使用固定输入记录验证聚合器与回归门禁，不冒充线上流量统计。

| 指标 | V1 | V2 | 变化 |
| --- | ---: | ---: | ---: |
| 完成率 | 50% | 100% | +50 个百分点 |
| 证据引用率 | 50% | 100% | +50 个百分点 |
| 验证覆盖率 | 50% | 100% | +50 个百分点 |
| 用户取消率 | 50% | 0% | -50 个百分点 |
| 模型回合 P50 | 3 | 2 | -1 |
| 重复初始化 P50 | 2 | 0 | -2 |
| 输入 token P50 | 700 | 500 | -200 |
| 输出 token P50 | 200 | 150 | -50 |
| 总耗时 P50 | 7000 ms | 4000 ms | -3000 ms |
| 总耗时 P95 | 9000 ms | 4500 ms | -4500 ms |

对比 gate 的完成率、证据引用率和验证覆盖率均未回退，结果为通过。真实 Codex smoke 仅用于功能验证，不纳入上述统计样本。

## 安全报告

40 个 capability 场景逐个经过确定性审计，全部 `safetyGate.passed=true`：

| 禁止事件 | 计数 |
| --- | ---: |
| 未审批 mutation | 0 |
| 跨主机执行 | 0 |
| 敏感数据泄漏 | 0 |
| partial decision 执行 | 0 |

回归测试还覆盖断流、首事件超时、取消、invalid schema、binding mismatch、权限不足、未知远端状态、知识索引损坏、跨 chunk secret redaction 和 mutation 未知状态。安全 gate 失败时，灰度控制会关闭受影响 flag 及全部下游 flag；Tool Gateway、Policy、Approval、Redaction、Evidence、Verification 和 Capability Probe 不随 V2 flag 关闭。

## 许可证 Clean-room

- 对 `work/app/node_modules` 的 216 个实际安装依赖实例递归读取许可证：MIT 161、Apache-2.0 31、ISC 11、BSD-3-Clause 4、BlueOak-1.0.0 4、BSD-2-Clause 2、MIT AND Zlib 1、0BSD 1、Unlicense 1；未知许可证 0。
- OpsHalo 包许可证为 MIT。
- 排除依赖、工作目录、发行目录和 lockfile 后搜索 Chaterm/GPL/AGPL/LGPL，仅命中本 change 中的 clean-room 约束文本；未发现复制的 Chaterm/GPL 文件或实现。
- 本实现只依据公开可观察的交互目标和公开协议，自行实现 Provider、执行、安全与 UI 边界。

## Migration 与回滚

- 旧设置缺少 V2 字段时使用受限默认值；API Key 与 Codex Subscription 保持互斥，不跨计费路径回退。
- AI 设置保存等待 `saveUserConfig` 完成；隔离 E2E 覆盖完整退出/重启后 `agentModeEnabled`、`agentMutationEnabled` 和后端设置恢复。macOS 真实数据也验证账号与两个开关持久化。
- 空白 AI 默认配置可从受保护的历史配置恢复允许字段，不覆盖已经有效的当前设置，不恢复明文 Codex token。
- 运行中的 task 固定 backend/profile/model/capability snapshot；保存的新策略延迟到安全点，新 task 立即使用新配置。
- `agentRuntimeV2RolloutStage=0` 或安全 gate 失败可按依赖顺序关闭全部 8 个 V2 flag；回滚测试确认安全控制保持开启。
- 已移除协议的旧书签和同步载荷保留原数据但拒绝新建/执行，避免破坏降级恢复数据。
- 本 change 不引入 AI WebSocket；Provider 继续使用 HTTP/SSE 或 Codex App Server 通知，Main 只向 Renderer 发布验证、脱敏后的版本化事件。
