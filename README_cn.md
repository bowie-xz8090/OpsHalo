# OpsHalo

OpsHalo 是一款面向 Linux 服务器排障与操作的 AI SSH/SFTP 运维工作台，在自然语言 Agent 能力之外保留明确、可审计的安全边界。

[![English](https://img.shields.io/badge/English-EN-blue)](README.md) [![中文](https://img.shields.io/badge/中文-Chinese-blue)](README_cn.md)

## 核心能力

- SSH 终端与 SFTP 文件管理。
- Shell 模式保留原始命令行操作方式。
- Agent 模式支持自然语言请求和基于 ReAct 的多轮自主探查。
- 结构化发现主机、进程、端口、服务、Docker、指标、日志、文件和配置。
- 仅有界、低风险只读动作允许自动执行。
- 变更、敏感命令、网络动作和交互操作必须由用户明确确认。
- 输出脱敏与截断、本地证据、超时、循环预算、Ctrl+C 中断和变更后验证。
- OpenAI Compatible/API Key 与 ChatGPT/Codex Subscription 两类 AI 后端互斥启用。
- 支持模型角色配置与能力探测、有界 Skill、显式本地知识源及来源引用。
- Provider 流式响应、真实命令输出进度、任务级会话复用和证据化最终综合均受顺序回滚开关保护。

## Agent 工作流

```text
自然语言请求
  → 确定性安全查询或 Harness 规划
  → 策略与命令检查
  → 经授权的工具/SSH 执行
  → 有界观察与证据
  → 自适应重规划或验证后的结论
```

模型不会直接获得本机或远程命令执行权限。所有动作都必须经过 OpsHalo Tool Gateway 和任务级策略校验。

## 本地开发

需要 Node.js 20.19+ 与 npm。

```bash
git clone https://github.com/bowie-xz8090/OpsHalo.git
cd OpsHalo
npm config set legacy-peer-deps true
npm install

# 终端 1：Vite 开发服务
npm start

# 终端 2：Electron
npm run app
```

验证命令：

```bash
npm run lint
npm run test-agent
npm run test-unit-ci
npm run compile
```

开发数据保存在 `.opshalo-dev-data`。发行版本使用独立的 `OpsHalo` 应用数据目录，不复用 electerm 或 electerm-mini 的配置。

## 更新与发行

OpsHalo 1.0.0 不执行自动更新，也不提供应用内手动更新检查。

发行包由 GitHub Actions 构建。打开 **Actions → Release multi-platform**，运行工作流并填写标签（例如 `v1.0.0`）。完成后会将 Windows、macOS、Linux 产物发布到 [GitHub Releases](https://github.com/bowie-xz8090/OpsHalo/releases)。

## 安全与隐私

- 不要在 Agent 提问中粘贴密码、私钥、API Key 或会话 Token。
- Provider 输出与工具输出都按不可信输入处理。
- Evidence 在发送模型和本地持久化前脱敏，并受到保留期限和容量限制。
- 漏洞报告方式见 [SECURITY.md](SECURITY.md)。

## 文档

- [Agent 运维说明](docs/agent-operations.md)
- [Codex Subscription 后端](docs/agent-codex-subscription.md)
- [安全与隐私](docs/agent-security-privacy.md)
- [工具开发](docs/agent-tool-development.md)
- [故障排查](docs/agent-troubleshooting.md)

## 上游与许可证

OpsHalo 基于 [electerm](https://github.com/electerm/electerm) 演进并沿用 MIT 许可证。上游组件与 `@electerm/*` 依赖的版权归原作者所有。

## 许可证

MIT
