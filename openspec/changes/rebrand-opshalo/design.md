# Design

## Repository boundary

The modified working tree is copied into `D:\Projects\OpsHalo` without `.git`, dependencies, user data, evidence, test output, staging directories, or release artifacts. All branding edits and commits occur only in the new directory.

## Identity

- Display/product name: `OpsHalo`
- npm/package name and CLI: `opshalo`
- Version: `1.0.0`
- App id: `io.opshalo.desktop`
- User data directory: `OpsHalo`
- Development data directory: `.opshalo-dev-data`
- Repository: `https://github.com/bowie-xz8090/OpsHalo`

Using a new application id and data directory prevents accidental coupling to installed electerm or electerm-mini profiles.

## Update removal

Remove the update store extension, remote release queries, startup check, IPC event, menus, settings toggle, About action, sidebar status, update modal, and update E2E tests. Packaging publish providers and inherited release workflows are excluded from the initial import. Codex App Server's own `check_for_update_on_startup: false` setting remains because it explicitly disables updates in the bundled service.

## Compatibility

SSH/SFTP, Shell mode, Agent mode, AI backend selection, Tool Gateway, approvals, evidence, cancellation, and verification are unchanged. Existing electerm-mini user data is intentionally not migrated automatically.
