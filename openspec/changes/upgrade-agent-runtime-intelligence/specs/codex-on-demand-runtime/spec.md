## Purpose

定义 Codex 原生运行时的固定版本按需下载、安全安装、账号状态保持、Renderer 最小接口和发行物体积门禁，使 OpsHalo 安装包不再携带大体积 Codex 二进制。

## ADDED Requirements

### Requirement: 发行物不得内置 Codex 原生运行时

从 1.0.26 起，Windows、macOS 和 Linux 安装包 SHALL NOT 包含 `@openai/codex`、任一 `@openai/codex-*` 平台包、`codex.exe` 或 Codex 原生二进制。OpenAI Compatible 模式 SHALL NOT 下载或安装 Codex 运行时。

#### Scenario: 扫描多平台成品

- **GIVEN** CI 已构建 Windows、macOS 和 Linux 成品
- **WHEN** 执行成品扫描
- **THEN** 安装包和解包目录均不存在 Codex npm 包或原生二进制
- **AND** 生产依赖及 `asarUnpack` 不再声明 Codex

### Requirement: 运行时来源必须由固定清单约束

系统 SHALL 使用内置清单固定 Codex `0.147.0`，并按平台与架构记录唯一官方 HTTPS 地址、SHA-512、压缩大小、目标三元组和可执行文件名。系统 MUST NOT 请求 `latest`、重定向到非清单主机或接受未经清单允许的地址。

#### Scenario: 当前平台不在清单中

- **GIVEN** 当前平台与架构没有固定清单项
- **WHEN** 用户尝试添加 Codex 账号
- **THEN** 系统显示该平台暂不支持按需运行时
- **AND** 不创建网络请求或账号记录

### Requirement: 下载必须可取消、可恢复且共享并发任务

主进程 SHALL 使用 Electron 网络栈下载到用户数据目录的受限临时文件，并继承系统代理与证书配置。下载 MUST 支持取消和基于 `Range`/`ETag` 的断点续传；服务器不接受 Range 时 SHALL 安全地从头覆盖。相同版本的并发请求 MUST 共用一个下载任务。

#### Scenario: 用户取消后再次下载

- **GIVEN** 固定运行时已下载一部分并记录 ETag
- **WHEN** 用户取消后再次点击账号授权按钮
- **THEN** 系统保留无敏感信息的分片并使用 Range/If-Range 恢复
- **AND** 下载状态、已下载大小和总大小持续通过受限事件更新

#### Scenario: 两个入口同时请求同一版本

- **GIVEN** 浏览器 OAuth 与已有账号重新授权几乎同时请求当前运行时
- **WHEN** 运行时尚未就绪
- **THEN** 主进程只创建一个网络下载任务
- **AND** 两个调用等待同一个安装结果

### Requirement: 安装前必须完成完整性和可执行性验证

主进程 MUST 校验压缩大小和 SHA-512，并拒绝绝对路径、路径穿越、链接、设备文件、超限内容或白名单外文件。系统 SHALL 在受限临时目录解压，执行 `--version` 和 App Server `initialize` smoke，通过后原子切换为可用版本。

#### Scenario: 压缩包损坏或包含恶意路径

- **GIVEN** 下载内容哈希不匹配、超出固定大小或包含 `../` 路径
- **WHEN** 主进程验证运行时
- **THEN** 安装失败且损坏文件被删除
- **AND** 现有可用旧运行时保持不变

### Requirement: 运行时缓存必须隔离并最小化持久化

运行时目录 SHALL 以 Codex 版本、平台和架构隔离，并使用限制性目录和文件权限。安装元数据 MUST NOT 存储下载 URL、账号 Token、用户目标、命令或任务内容。新版本安装成功后 SHALL 清理旧版本；升级失败 SHALL 保留旧版本。

#### Scenario: 新版本安装失败

- **GIVEN** 旧运行时仍可用
- **WHEN** 新版本下载或初始化失败
- **THEN** 旧版本不被删除
- **AND** 账号及 Agent 配置保持不变

### Requirement: 自定义与本机已有运行时必须先于下载

高级配置中的 Codex 绝对路径 SHALL 保持最高优先级。已安装的 OpsHalo 固定运行时其次。系统 MAY 在 `PATH` 和当前用户标准 CLI 目录发现名为 `codex` 的本机 CLI；本机 CLI 可使用用户已安装的版本，但只有 `--version` 可识别且 App Server `initialize` 通过后才能复用。不兼容时 SHALL 回到固定清单下载。上述来源都不可用时，Agent task MUST 引导用户进入 AI 配置，且不得自行后台下载。

#### Scenario: Agent 模式遇到缺失运行时

- **GIVEN** 用户已有账号且 Agent 已启用，但本地固定运行时尚未下载
- **WHEN** 用户尝试启动 Agent task
- **THEN** 系统可复用已经通过验证的本机 Codex CLI，但不在后台开始下载
- **AND** 引导用户进入 AI 配置点击账号操作

### Requirement: 账号入口必须展示显式下载状态

缺失运行时时，浏览器 OAuth 和设备码按钮 SHALL 显示本次下载大小，点击即视为用户开始下载。下载中 SHALL 展示进度、已下载大小、总大小和取消入口；验证中、失败和完成状态 SHALL 使用可读文案。下载完成后系统 SHALL 自动继续原授权流程；已有账号的刷新或重新授权 MAY 显式触发下载。

#### Scenario: 下载完成后继续 OAuth

- **GIVEN** 用户点击浏览器 OAuth 添加账号且运行时缺失
- **WHEN** 下载、校验和初始化全部通过
- **THEN** 系统自动开始原 OAuth 流程并打开官方授权页面
- **AND** 不要求用户再次点击添加账号

### Requirement: 下载故障不得破坏账号和 Agent 状态

运行时缺失、下载失败或取消 MUST NOT 清除已保存账号、当前账号选择或 Agent 启用状态，也 MUST NOT 在真正进入 OAuth 前创建残留错误账号记录。

#### Scenario: 新账号下载阶段失败

- **GIVEN** 用户尚未创建 Codex 账号
- **WHEN** 首次下载失败或被取消
- **THEN** 账号列表仍为空且没有错误 profile
- **AND** 用户可再次点击原按钮重试

### Requirement: Renderer 只能访问最小运行时接口

Preload SHALL 只暴露 `getRuntimeStatus()`、`cancelRuntimeDownload()` 和 `onRuntimeEvent(handler)`。状态仅包含 `state`、`version`、`platform`、`arch`、`downloadedBytes`、`totalBytes` 和已脱敏错误；Renderer MUST NOT 获得本地路径、下载地址、校验值或任意进程启动能力。

#### Scenario: Renderer 查询下载状态

- **GIVEN** 运行时正在下载
- **WHEN** Renderer 调用状态接口
- **THEN** 返回 `downloading` 与字节进度
- **AND** payload 不包含 URL、本地路径、SHA 或凭据

### Requirement: 发布流水线必须验证运行时和成品体积

各平台 CI SHALL 从固定官方地址在临时目录完成完整性校验和 App Server 初始化 smoke，且测试缓存不得进入成品。发布门禁 SHALL 要求 Windows installer 小于 100 MB，macOS DMG 小于 130 MB，Linux DEB/RPM/AppImage 小于 130 MB，Linux/Windows tar.gz 小于 160 MB，并生成 `SHA256SUMS.txt`。

#### Scenario: 成品超出体积上限

- **GIVEN** 任一发布资产超过对应门禁
- **WHEN** 发布工作流准备上传资产
- **THEN** 工作流失败且不创建 v1.0.26 Release
- **AND** v1.0.25 继续作为最后一个内置 Codex 的离线版本保留
