# Tasks

- [x] 1. Remove installers, packaging staging, smoke directories, test output, generated builder config, and package logs from the source workspace; exclude locked legacy backups from the copy and retry cleanup.
- [x] 2. Copy the modified source state to a new OpsHalo directory without original Git metadata, dependencies, runtime data, or artifacts.
- [x] 3. Change package, product, executable, app id, protocol, data directory, repository metadata, and version to OpsHalo 1.0.0.
- [x] 4. Remove all in-app automatic/manual update checks, update download UI, update settings, IPC/menu hooks, and related tests.
- [x] 5. Rewrite English/Chinese README, security guidance, and affected product documentation.
- [x] 6. Remove inherited automatic release workflows and verify no upload credential or generated artifact is tracked.
- [x] 7. Install dependencies as needed and run lint, Agent tests, unit tests, and production compile without packaging.
- [x] 8. Initialize a clean Git repository, review tracked files, and create the OpsHalo 1.0.0 initial commit.
- [ ] 9. Create the independent GitHub repository, push the commit, and set About description/homepage/topics.
