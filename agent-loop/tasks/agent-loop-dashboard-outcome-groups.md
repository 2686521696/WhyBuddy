# AgentLoop: dashboard outcome groups

## 执行状态
- 状态：已完成
- 目标：让 VSIX dashboard（VS Code 扩展面板）按更细的 queue outcome（队列结果）分组展示，区分 OK（成功）、NO_DIFF（无新增差异）、APPLY_CONFLICT（应用冲突）、HUMAN（人工接管）和 CRASH（崩溃）。
- 角色分工：worker（执行工人）负责 state reader（状态读取器）、dashboard renderer（面板渲染器）和样式；reviewer（审查者）确认 UI（界面）不再把 no-diff reviewed（已审查但无新增差异）误报成错误。

### 状态清单
- [x] Dashboard queue health（队列健康）展示 `applied`、`reviewed`、`noDiff`、`applyConflict`、`human`、`failed`、`crashed`、`stopped`。
- [x] 任务列表把 `DONE_REVIEWED_NO_DIFF`（已审查完成但无新增差异）显示为中性状态，不归入 ERR（错误）。
- [x] `APPLY_CONFLICT`（应用冲突）显示冲突文件和 apply error（应用错误）。
- [x] `DIRTY_MAIN_NEEDS_COMMIT`（主仓库有未提交改动，需要先提交）显示为可操作提示。
- [x] detail（详情）区域的 review（审查）、fix iteration（修复迭代）、evidence（证据）布局保持全宽可读。
- [x] gate（门禁测试）全绿，VSIX（VS Code 扩展包）能重新打包。
- [x] Codex review（Codex 审查）确认面板没有把失败刷绿。

## 背景

当前 dashboard（面板）把多种非 OK 状态压成 FAIL/ERR（失败/错误），导致用户看到“一屏红”但无法判断是业务失败、无新增 diff、apply conflict 还是人工接管。新的 status taxonomy（状态分类）需要在 UI 中可见。

## 允许修改的文件
- `agent-loop/vscode-extension/src/stateReader.ts`
- `agent-loop/vscode-extension/src/runSummary.ts`
- `agent-loop/vscode-extension/src/dashboardPanel.ts`
- `agent-loop/vscode-extension/media/dashboard.js`
- `agent-loop/vscode-extension/media/dashboard.css`
- `agent-loop/vscode-extension/package.json`
- `agent-loop/test/vscode-extension.test.js`
- `agent-loop/tasks/agent-loop-dashboard-outcome-groups.md`

## 禁止扩大范围
- 不引入 React、Ant Design 或新 runtime dependency（运行时依赖）。
- 不改 AgentLoop 队列执行语义；这里只消费状态。
- 不把 `APPLY_CONFLICT`（应用冲突）显示成成功。
- 不提交 `.agent-loop/` 运行产物。
- 不改后端迁移业务代码。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `agentLoopDashboardOutcomeGroupsGates`。

## 成功标准

- 单测覆盖 no-diff reviewed（已审查但无新增差异）、apply conflict（应用冲突）、human halt（人工接管）三个显示分组。
- dashboard（面板）JSON/log view（JSON/日志视图）仍可自动换行和格式化。
- review（审查）块和 fix iteration（修复迭代）块在 detail（详情）区域占满剩余宽度。
- `npm run compile`、`npm test`、`npm run package` 在 `agent-loop/vscode-extension` 通过。
- mojibake gate（乱码门禁）通过。
