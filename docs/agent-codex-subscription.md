# Codex Subscription AI 后端

OpsHalo 保留原有 OpenAI Compatible / API Key 配置，并新增 `Codex Subscription`。两种类型互斥：同一时刻只会启用当前选择的类型，切换不会删除另一类已经保存的配置，也不会在失败时跨类型自动回退。

## 适用范围与计费

`Codex Subscription` 通过官方 Codex App Server 登录 ChatGPT/Codex 账号，使用该账号可用的 Codex 套餐和额度。ChatGPT Plus/Codex Subscription 与 OpenAI Platform API Key 的 API 余额、账单和限额彼此独立；切换到 API Key 类型时仍按 API Provider 的账户计费。

协议和账号能力以 [OpenAI Codex App Server 文档](https://learn.chatgpt.com/docs/app-server) 为准。OpsHalo 只把 App Server 用作结构化规划 Harness，不把它作为目标服务器的执行通道。

## 配置与授权

1. OpsHalo 安装包已固定并内置官方 Codex App Server，无需另行安装 Codex CLI、Node.js、Volta 或 Codex Desktop。设置中的 `codexAppServerExecutable` 仅用于高级诊断时显式覆盖内置版本，通常保持为空。
2. 打开 AI 配置，将“当前 AI 类型”切换为 `ChatGPT / Codex Subscription`。
3. 使用“浏览器 OAuth 添加账号”或“设备码添加账号”。系统浏览器只打开 App Server 返回的 HTTPS 或 localhost 回调地址。
4. 授权完成后选择当前账号，点击“刷新账号/额度”确认状态，再保存配置。
5. 开启 Agent 能力并重启应用，在终端标签页切换到 Agent 模式。

可以添加多个账号，查看脱敏邮箱、套餐、登录状态和 App Server 返回的额度窗口。切换或删除一个正在执行 Agent 任务的账号会被阻止；先使用停止按钮或 `Ctrl+C` 安全终止任务。

登录失效时可对原账号选择“重新授权”。“退出登录”调用官方 App Server logout；“删除本地账号”还会停止该 profile 的 App Server，并删除其隔离目录。

## 安全边界

- 每个账号使用独立 `<Electron userData>/ai-accounts/codex/v1/profiles/<profileId>/codex-home`，不会读取或改写用户全局 `~/.codex`。
- OAuth 凭据由官方 App Server 保存在隔离 `CODEX_HOME`。OpsHalo 的 profile 索引只保存 profile id、脱敏邮箱、套餐、额度摘要和状态，不保存或向 Renderer 返回 `id_token`、`access_token`、`refresh_token`。
- App Server 进程不继承 API Key、云密钥等凭据环境变量；日志和错误在 IPC 前脱敏、截断。
- 规划线程关闭本机 Shell、unified exec、Apps、MCP 来源、Web Search 和多 Agent能力，并使用只读、无网络 sandbox。若 App Server仍请求本机命令、文件修改或动态工具，主进程会拒绝并记录安全审计。
- 模型只能返回一个结构化 `PlannerDecision`。SSH、SFTP、MCP、超时、输出截断、审批、验证和审计继续由 OpsHalo Tool Gateway 统一处理。
- 停止按钮与 `Ctrl+C` 会调用官方 `turn/interrupt`，随后走 OpsHalo 原有的执行取消和必要验证链路。

不要导入或粘贴来源不明的 Token JSON。此实现有意不提供 `id_token` / `refresh_token` 导入入口，以避免来源校验、过期刷新、账号绑定和明文泄漏风险。

## 故障处理

- `安装包内置的 Codex App Server 不完整`：重新安装同平台、同架构的 OpsHalo 安装包；系统不会回退到 PATH 上的外部版本。仅在高级诊断时配置可信的绝对路径。
- `尚未授权或登录已失效`：刷新账号；仍失败时使用“重新授权”。
- `授权地址不安全`：只接受 HTTPS，或 `127.0.0.1` / `localhost` 的 HTTP 回调。升级官方 Codex CLI 后重试。
- `请求超时/进程退出`：该轮任务失败或暂停，不会回退到 API Key。重新打开应用或刷新账号会重建该 profile 的 App Server。
- `额度信息暂不可用`：授权可能仍有效；额度读取错误会以脱敏摘要显示，可稍后刷新。
- `账号仍有活跃 Agent 任务`：先停止任务，等待中断和验证完成后再切换、退出或删除。

## 回滚和清理

要回滚到原行为，将“当前 AI 类型”切回 `API Key / OpenAI Compatible` 并保存；原 API 配置仍在。关闭 `agentModeEnabled` 可完全停止 Agent 模式，Shell 与旧 AI 配置路径保持不变。

退出所有 Codex 账号后，可在应用关闭时删除 `<Electron userData>/ai-accounts/codex/v1` 完成本地清理。不要在 App Server 或 Agent 仍运行时手工删除目录。
