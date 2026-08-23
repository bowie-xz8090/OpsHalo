# 验证记录

## 2026-08-23

- `npm run b`：通过；从空 `work/` 目录完成 Renderer、Main 和 Mini 发行目录编译。
- `npm run verify-mini-artifact`：通过；检查 15 个已删除路径和 7 个专用模块。
- `npm run test-unit-ci`：通过，15 个 suite、297 个测试。
- `npm run lint`：通过。
- SSE 契约覆盖 keepalive、UTF-8 跨 chunk、`[DONE]`、错误帧、首事件超时和完成前断流；Provider 错误在共享日志边界脱敏。
- 延迟 gate 计算 submit ack、首生命周期、Provider TTFT、执行首输出、final synthesis 和总耗时的 P50/P95。
- 安全 gate 已接入确定性端到端场景审计，四类禁止计数均为 0。

## 发布门禁

- 真实 Codex/阿里云 Linux SSH smoke、三平台 Electron 目录构建、三个成品内 OpenAI-compatible/Strands 流式契约、性能、安全、许可证 clean-room 和 migration rollback 均已完成。
- 详细命令、指标、成品哈希与验证边界见 [release-gates.md](./release-gates.md)。
- 当前仅剩 `11.5` 用户明确验收；按规格不能由开发验证代替用户勾选。
- 本次按产品决策不引入 AI WebSocket；Provider 仍使用既有 HTTP/SSE 或 Codex App Server 通知，经 Main IPC 向 Renderer 发布安全事件。

## OpsHalo 1.0.17 步骤历史与光标锚点验证

- `npm run test-unit-ci`：通过，15 个 suite、261 个测试；新增同 task 多步骤冻结、活动历史隔离和命令完成后最新光标空间测试。
- `npm run lint`、`npm run verify-mini-artifact`、`git diff --check`：通过。
- macOS 独立 `OpsHalo.app` 构建并从 `app.asar` 启动；入口为 `index.html?v=1.0.17` 且返回 `Cache-Control: no-cache`。
- 真实阿里云 SSH 两步只读 smoke：首条 `nginx -t` 执行后以只读历史卡固定在原自然语言下方，命令、输出和新提示符随后显示；下一条 `cat /etc/nginx/nginx.conf` 审批出现在新提示符下方。执行第二步并滚动终端后，第二步历史卡仍按原 buffer line 回显，最终分析卡在最新提示符下方保持可见。

## OpsHalo 1.0.18 xterm 嵌入式 Agent 卡片验证

- 保留审批、步骤、证据和终态卡组件，将宿主改为 xterm `registerMarker` / `registerDecoration`；卡片使用真实 buffer 行占位，不依赖 viewport top/bottom 或滚动重定位监听。
- 定向 unit test：11/11 通过；覆盖 marker/decoration 注册、历史冻结、无 Agent 浮动 overlay、终端输入隔离和 Shell transcript。
- Playwright Electron 交互 E2E：通过；验证规划卡从紧凑高度扩展为审批卡、按钮执行后冻结、下一张卡位于后续 marker、终态显示实际步数且不含 `/12`。
- `npm run b` 与定向 Standard 检查通过；生产 bundle 包含嵌入式卡片组件且不再从 `TerminalSmartShellOverlay` 渲染 Agent 浮层。
- macOS arm64 独立 `OpsHalo.app` 使用 1.0.18 构建；最终真实 SSH smoke 验证记录在本节后续结果中。
- `npm run test-unit-ci`：通过，15 个 suite、264 个测试；`npm run lint`、`npm run verify-mini-artifact`、`git diff --check` 均通过。
- Playwright Electron 回归验证命令输出后的新 Shell 提示符完整保留，下一轮规划卡 marker 位于该提示符下一行；规划态仅占两行终端单元格，DOM 像素高度不超过对应预留高度，终态扩展和高卡片跨 viewport 滚动仍通过。
- AI 设置提交显式等待 `saveUserConfig` 完成后才提示成功并关闭；“仅保存”和“测试并保存”共用该持久化边界。macOS 成品完全退出并再次启动后，Codex 后端可直接继续规划，Agent 模式仍为开启状态，无需重新授权或重新开启。
- 真实阿里云 SSH 成品界面确认顺序为：命令输出、新 Shell 提示符、嵌入式分析卡、后续 Shell 提示符；规划过程卡只显示一行状态，不再保留大块空白。
- 长终态结果 E2E 使用 18 条长事实和待确认项验证：React 卡片完成渲染后按真实 DOM 高度向上取整补足 xterm buffer 行，结果卡与正文 `overflow-y` 均为 `visible`，内容高度完整落在 decoration 占位内；历史只使用终端 scrollbar 回看，不再出现卡内滚动条。
- 重新编译并构建 macOS arm64 `OpsHalo.app`；Computer Use 启动确认窗口标题、`index.html?v=1.0.18`、SSH 终端及 Shell/Agent 模式入口正常，应用未落入 Electron `default_app.asar`，最终进程保持运行。

## OpsHalo 1.0.19 紧凑规划卡与配置隔离验证

- 展开的审批/结果卡进入下一轮规划时，旧卡立即冻结在原 buffer 位置，新规划卡严格新建为两行 xterm decoration，不继承旧卡高度；Playwright Electron 交互 E2E 通过。
- Electron E2E 固定使用独立 `DATA_PATH`，不再读写 `~/Library/Application Support/OpsHalo`；测试前后真实 `electerm_data.db` 修改时间保持为 `2026-08-23 18:29:25`。
- 配置持久化 E2E 覆盖保存 Agent 与变更审批开关、完整关闭应用、沿相同数据目录重新启动，并等待 Store 初始化后确认四项 AI 配置全部恢复。
- `npm run test-unit-ci`：通过，15 个 suite、265 个测试；`npm run lint -- --no-fix`、`npm run verify-mini-artifact`、`git diff --check` 均通过。
- macOS arm64 `OpsHalo.app` 已以 1.0.19 重新构建并完成真实数据验证：入口为 `index.html?v=1.0.19`；现有 Codex 账号保持 authenticated；点击“仅保存”、完整退出并重启后，`终端 Agent` 与“允许执行变更（每次确认）”仍均为开启状态。

## OpsHalo 1.0.20 审批卡回收与终态可见性验证

- 执行审批后立即销毁对应 xterm decoration/marker，并在光标仍紧邻占位时通过终端控制序列回收全部占位行；Shell 命令、stdout/stderr 和新提示符直接接替原位置，不再重复显示“已执行步骤”。
- 终态卡完成真实内容高度测量、补足 buffer 行并恢复提示符后，短结果滚到底部完整显示，超过一屏的长结果定位到 marker 开头；正文和后续提示符均保留在 terminal scrollback 中。
- Playwright Electron 核心交互 E2E 通过：审批卡执行后数量为 0，Shell 命令与输出连续，下一轮规划卡仍为两行；18 条长事实的终态卡占位超过 20 行、无内部滚动条，标题处于终端可见区域，向下滚动时卡片按 marker 区间连续显示。
- `test/e2e/010.agent-input-mode.spec.js` 其余四项场景通过；账号切换用例同步当前中文标签后定向重跑通过；完整退出并重启的持久化用例继续通过。
- `npm run test-unit-ci`：15 个 suite、297 个测试全部通过；`npm run lint`、OpenSpec strict validation 和 `git diff --check` 通过。
- macOS arm64 `OpsHalo.app` 已以 1.0.20 重新构建；`app.asar` SHA-256 为 `8598335b46b248cbc6b2451a8d8dc6d7352b5f46e9f28754b59922001bb80c64`。Computer Use 完全退出旧进程后启动新包，确认入口为 `index.html?v=1.0.20`、账号仍为 authenticated、两个 Agent 开关保持开启、真实 SSH 标签可打开且 Shell/Agent 模式可切换；应用最终保持在 Agent 模式运行。

## OpsHalo 1.0.21 精简结论与动态展开验证

- 直接路径查询按原始问题提取并排序已验证路径，只返回目标值；`nginx配置在哪里` 的确定性结果为 `Nginx 配置文件位于 /etc/nginx/nginx.conf。`，不再附带语法检查、location 列表或证据术语。
- 终态分析卡移除重复的“查看证据 / 清理证据 / 继续追问”按钮；分析依据仍保留在卡片内，可直接展开查看。
- 展开或收起分析依据时，Renderer 保存终态展开状态，重新测量真实 DOM 高度并同步增减 xterm buffer 占位行；当前 Shell 提示符和输入行在卡片下方恢复，完整内容不使用卡内滚动条。
- Playwright Electron 核心交互 E2E 通过：终态卡从折叠态展开后占位行数增加，长内容完整展示且提示符位于卡片之后；历史卡保持在原 xterm marker 位置。
- `npm run test-unit-ci`：15 个 suite、299 个测试全部通过；`npm run lint`、`npm run verify-mini-artifact`、OpenSpec strict validation 和 `git diff --check` 均通过。
- macOS arm64 `OpsHalo.app` 已以 1.0.21 重新构建并启动；`CFBundleShortVersionString` 与 `CFBundleVersion` 均为 1.0.21，窗口入口为 `index.html?v=1.0.21`。真实 SSH 标签、Shell/Agent 模式入口正常，Agent 模式保持开启且可直接进入 AI 规划，无需重新启用账号。主程序、`node-pty` 与内置 Codex 均为 arm64；`app.asar` SHA-256 为 `aae20a87656722941cb8270ecd02fe861090a15a8846024922fa79a611e6cc4c`。
- 后续用户现场验收发现遗漏：默认已展开的非成功终态在 decoration DOM 晚于首次测量时仍停留在两行规划高度，只显示“已结束”标题，正文被裁切且 Shell 提示符覆盖卡片边界。因此 1.0.21 不作为该交互的验收通过版本。

## OpsHalo 1.0.22 终态首次展开与直接路径收敛验证

- 根因修复：完整卡片保持 `needsContentFit` 状态；首次测量尚无 decoration/React DOM 时不再永久退出，xterm `onRender` 会重新排队测量，终态恢复 Shell 提示符后还会执行一次兜底测量。
- 新增 Electron 回归覆盖 `inconclusive` 终态首次即展开 18 条长事实：卡片自动扩展超过 20 行，overlay 和 final card 的 `scrollHeight` 不超过实际高度，Shell 提示符严格位于 `marker.line + rows`，没有卡内滚动条或正文裁切。
- 原有完整交互 Electron 回归同步通过：成功终态先展示精简结论，展开分析依据后再次增加占位；命令输出、历史卡和下方提示符顺序保持不变。两条定向 E2E 均通过。
- 直接路径收敛只接受当前 task Evidence 引用支持的唯一目标路径；即使通用完成判定被同批无关 `location` 输出干扰，也直接返回 `Nginx 配置文件位于 /etc/nginx/nginx.conf。`。同分冲突路径或缺少 Evidence 时保持未确认；确定性直接答案不再进入模型润色回合。
- `npm run test-unit-ci`：15 个 suite、301 个测试全部通过；`npm run lint`、`npm run verify-mini-artifact`、OpenSpec strict validation 和 `git diff --check` 均通过。
- macOS arm64 `OpsHalo.app` 已以 1.0.22 重新构建并启动，窗口入口为 `index.html?v=1.0.22`；`app.asar` SHA-256 为 `e4f255d94476df0959a874111abad33b51d34249bd4979a8b1ab380fa06ea044`。
- 后续用户现场验收发现另一处遗漏：命令执行期间延迟到达的旧 `awaiting_approval` snapshot 会覆盖已暂存的新规划状态，Shell 输出完成后重新创建并冻结旧审批卡，表现为原命令在最终结果前重复显示“已执行步骤”。因此 1.0.22 也不作为完整交互验收通过版本。

## OpsHalo 1.0.23 已消费审批乱序保护验证

- Renderer 只在审批卡及 buffer 占位成功回收后提交执行；暂时无法安全回收时保持原审批可交互并提示重试，不再执行命令同时冻结重复卡片。
- 成功回收后记录 approval request id；订阅投影和嵌入渲染均过滤延迟到达的同一审批。命令执行期间的暂存状态按 `snapshotVersion`、`lastEventSequence` 和投影时间选择更新版本，旧审批不能覆盖新规划或终态。
- Electron 回归主动构造“新版 planning 先到、旧版 awaiting_approval 后到”的乱序：Shell 输出完成后仅创建两行新规划卡，审批 dialog 数量为 0，“已执行步骤”数量为 0；同一用例继续验证终态正文、提示符和 scrollback 顺序。
- 两条核心 Electron E2E 通过；`npm run test-unit-ci` 为 15 个 suite、301 个测试全部通过；`npm run lint` 与 `npm run verify-mini-artifact` 通过。
- macOS arm64 `OpsHalo.app` 已以 1.0.23 重新构建并启动，`CFBundleShortVersionString` 与 `CFBundleVersion` 均为 1.0.23，入口实际返回 `index.html?v=1.0.23`、`style-1.0.23.css` 与 `basic-1.0.23.js`；`app.asar` SHA-256 为 `49f1d4f1a20992170b02a634503db97b7b8ebe01663e2b76f3fe7e5ce459e810`。
- 后续用户现场验收发现 1.0.23 将已批准审批的 decoration、marker 和全部占位一并删除，虽然消除了重复详情，却也删除了用户需要回看的步骤执行记录。因此 1.0.23 不作为步骤历史交互的验收通过版本。

## OpsHalo 1.0.24 紧凑步骤历史验证

- 批准执行后不再销毁审批 marker：完整审批内容在原 buffer line 收缩为两行内的只读“第 N 步已执行 · 操作目的”记录，只移除重复命令、风险详情和操作按钮；Shell 命令、stdout/stderr 与新提示符紧随其后。
- Renderer 复用统一的 buffer 行调整逻辑，把完整审批的实际占位同步缩到两行，不留下视觉空洞；控制提交失败时在同一 marker 恢复原审批内容，不创建第二张卡。
- 已消费 approval request id 和 snapshot 版本排序继续阻止延迟旧审批复活；Electron 回归同时断言原位历史 marker < Shell 命令行 < 新提示符后的规划 marker，且历史中不重复完整命令。
- `test/e2e/010.agent-input-mode.spec.js` 全部 6/6 通过，覆盖紧凑步骤历史、长终态动态高度、AI 设置恢复和同数据目录完整重启持久化；`npm run test-unit-ci` 为 15 个 suite、301 个测试全部通过。
- `npm run lint`、`npm run verify-mini-artifact`、OpenSpec strict validation 和 `git diff --check` 均通过。
- macOS arm64 `OpsHalo.app` 已以 1.0.24 重新构建并启动；`CFBundleShortVersionString` 与 `CFBundleVersion` 均为 1.0.24，入口实际返回 `style-1.0.24.css`、`basic-1.0.24.js` 和 `window.et.version=1.0.24`，HTML 与入口脚本均为 `Cache-Control: no-cache`；`app.asar` SHA-256 为 `680b9a36c40f232fe2fca102c54c708afd1058293668ac180269411caba936ba`。
- 后续用户现场验收确认两行摘要不是所需的原始确认样式，并发现终态状态事件可能先生成只有“已结束”标题的空卡，因此 1.0.24 不作为本交互的验收通过版本。

## OpsHalo 1.0.25 完整确认历史与终态正文时序验证

- 批准执行后，原审批 marker 保留完整命令、风险、目标和说明；卡片切换为绿色只读“已执行步骤”状态，仅移除“执行 / 修改 / 拒绝”操作，Shell 命令、stdout/stderr 和新提示符仍从卡片之后按 buffer 顺序展示。
- Session 投影和 Renderer 同时过滤“状态已进入终态但尚无 `finalResult`”的中间快照；真实事件顺序为 `session.state_changed -> session.completed` 时，前者不再生成只有“已结束”标题的空卡，正文事件到达后才扩展最终结果。
- Electron 回归主动覆盖完整只读历史、命令与 marker 顺序、旧审批乱序、终态状态先到/正文后到、长结果动态高度、账号切换和同数据目录完整重启持久化；`test/e2e/010.agent-input-mode.spec.js` 为 6/6 通过。
- 全量 `npm run test-unit-ci` 为 15 个 suite、303 个测试通过；`npm run lint`、`npm run verify-mini-artifact`、OpenSpec strict validation 和 `git diff --check` 通过。
- 打包钩子删除 Electron 自带的 `default_app.asar` 回退入口；macOS arm64 `OpsHalo.app` 以 1.0.25 构建并启动，主程序、`node-pty` 均为 arm64，Renderer 的 `--app-path` 指向 OpsHalo `app.asar`。HTTP 入口返回 `style-1.0.25.css`、`basic-1.0.25.js` 和 `window.et.version=1.0.25`，入口与主脚本均为 `Cache-Control: no-cache`；`app.asar` SHA-256 为 `20522f27d39c1a6eaab4b4d042ae7fbf243aa87a8917a5ee88a6f8338bd5fd4d`。
