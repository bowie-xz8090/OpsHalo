# OpsHalo

OpsHalo is an AI-powered SSH/SFTP operations workbench for investigating and operating Linux servers with explicit safety boundaries.

[![English](https://img.shields.io/badge/English-EN-blue)](README.md) [![中文](https://img.shields.io/badge/中文-Chinese-blue)](README_cn.md)

## Highlights

- SSH terminal and SFTP file management.
- Shell mode for the original command-line workflow.
- Agent mode for natural-language operations and multi-step ReAct exploration.
- Structured discovery across hosts, processes, ports, services, Docker, metrics, logs, files, and configuration.
- Automatic execution is limited to bounded low-risk reads.
- Changes, sensitive commands, network actions, and interactive operations require explicit approval.
- Output redaction, truncation, local evidence, timeouts, loop budgets, Ctrl+C cancellation, and post-change verification.
- Mutually exclusive OpenAI-compatible API Key and ChatGPT/Codex Subscription backends.

## Agent workflow

```text
Natural-language request
  → deterministic safe query or Harness planner
  → policy and command inspection
  → approved tool/SSH execution
  → bounded observation and evidence
  → adaptive replanning or verified result
```

The model never receives direct authority to execute local or remote commands. Every action is validated by OpsHalo's Tool Gateway and task-scoped policy.

## Development

Requirements: Node.js 20.19+ and npm.

```bash
git clone https://github.com/bowie-xz8090/OpsHalo.git
cd OpsHalo
npm config set legacy-peer-deps true
npm install

# Terminal 1: Vite development server
npm start

# Terminal 2: Electron
npm run app
```

Validation:

```bash
npm run lint
npm run test-agent
npm run test-unit-ci
npm run compile
```

Development data is stored in `.opshalo-dev-data`. Packaged builds use an independent `OpsHalo` application data directory and do not share the electerm or electerm-mini profile.

## Updates and releases

OpsHalo 1.0.0 does not perform automatic or manual in-app update checks. Release packaging and publication are intentionally disabled for the initial repository import.

## Security and privacy

- Do not paste passwords, private keys, API keys, or session tokens into Agent prompts.
- Provider output and tool output are treated as untrusted input.
- Evidence is redacted before model use and local persistence, with bounded retention and cleanup controls.
- See [SECURITY.md](SECURITY.md) for vulnerability reporting.

## Documentation

- [Agent operations](docs/agent-operations.md)
- [Codex Subscription backend](docs/agent-codex-subscription.md)
- [Security and privacy](docs/agent-security-privacy.md)
- [Tool development](docs/agent-tool-development.md)
- [Troubleshooting](docs/agent-troubleshooting.md)

## Upstream and license

OpsHalo is derived from [electerm](https://github.com/electerm/electerm) and retains its MIT license. Upstream components and `@electerm/*` dependencies remain credited to their respective authors.

## License

MIT
