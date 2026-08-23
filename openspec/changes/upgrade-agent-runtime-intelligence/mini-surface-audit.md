# Mini 产品面可达性清单

## 保留边界

| 功能面 | Renderer 入口 | Main/Server 入口 | 保留原因 |
| --- | --- | --- | --- |
| SSH | 连接列表、书签表单、终端会话 | `session-ssh`、SSH bridge | 核心远程终端和 Agent 执行通道 |
| SFTP | SSH 会话文件面板 | `session-sftp` | SSH 文件传输 |
| 本地终端 | 新建本地会话 | `session-local`、`session-process` | 本地 Shell 工作流 |
| AI Agent | 终端 Agent overlay、AI 设置 | Agent runtime、provider adapters | 核心智能运维工作流 |
| 主题/通用设置 | 设置面板 | 设置持久化 IPC | 可用性和本地化 |
| 同步/工作区 | 设置同步、工作区 | 数据同步与书签存储 | 多设备配置与会话组织 |
| MCP SSH 工具 | AI 配置内 MCP 管理 | `widget-mcp-server`、SSH-only gateway | Agent 受控 SSH 能力 |

## 已删除的不可达功能族

- 会话协议：Telnet、Serial、FTP、RDP、VNC、SPICE、Web。
- Renderer：上述协议表单与会话、Quick Command 管理、Profile 管理、Batch 编辑器/日志、通用 Widget 管理。
- Main/Server：上述协议 Session Server、代理、文件传输实现及构建 stub。
- 专用依赖：`@novnc/novnc`、`ironrdp-wasm`、`spice-client`、`@electerm/ftp-srv`、`basic-ftp`、`node-forge`、`serialport`。

## 被动兼容边界

- 旧书签、Profile、Quick Command 和同步字段不再进入新建/编辑 UI，也不会创建已删除协议会话。
- 加载时忽略不可达记录，不主动改写用户的同步数据和回滚数据。
- 旧 SSH Profile 认证读取路径暂时保留，仅用于既有 SSH 数据兼容，不形成可见 Profile 功能面。

## 自动化证明

- `test/unit-ci/mini-product-surface.spec.js` 检查 Renderer、动态入口、旧数据加载和新 schema 边界。
- `build/bin/verify-mini-artifact.js` 检查干净构建产物路径与已删除专用模块。
- `npm run verify-mini-artifact` 仅在 `npm run b` 产生的干净 `work/app` 上执行。
