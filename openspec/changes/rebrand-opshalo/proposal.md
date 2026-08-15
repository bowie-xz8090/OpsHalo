# Change: Rebrand project as OpsHalo

## Goal

Create an independent OpsHalo 1.0.0 repository from the current Agent-enabled working tree without committing or pushing to the original electerm-mini repository.

## Scope

- Change application, package, executable, app id, data directory, documentation, and repository metadata to OpsHalo.
- Remove automatic startup update checks, manual in-app update checks, update download UI, and update-network code.
- Disable inherited release/publish automation during the initial repository import.
- Preserve upstream MIT attribution and existing SSH/SFTP/Agent security behavior.
- Initialize and upload an independent Git repository.

## Non-goals

- Produce installers or release artifacts.
- Replace inherited icons or redesign the UI.
- Change Agent safety policy, model selection, or execution permissions.

## Success criteria

- Source metadata reports `OpsHalo` version `1.0.0`.
- No application update-check path remains reachable.
- Lint, Agent tests, unit tests, and production compile pass.
- The new Git repository contains no build artifacts, runtime data, credentials, or original `.git` history.
- GitHub About and repository metadata identify OpsHalo.
