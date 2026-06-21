# 后端 NodeJS 到 Python 迁移：Runtime depth audit 90

## 执行状态
- 状态：待执行
- 目标：复核当前 `DONE_REVIEWED`（已审查完成）的 contract/proxy/runtime 深度，防止把契约绿灯误报成生产运行时完成。
- 角色分工：worker 负责分层审计和证据表；reviewer 确认 90% 口径没有膨胀。

### 状态清单
- [x] 对 Blueprint、role、NL command、workflow、RAG、telemetry、A2A 等切片做深度分层。
- [x] 每项标注 `contract-only`、`proxy-only`、`runtime-bridge`、`production-wiring`。
- [x] 给出能计入 90% 的项和不能计入的项。
- [x] gate 全绿。
- [x] Codex review 确认证据和分类一致。

## 目标

当前很多任务已经 `DONE_REVIEWED`，但其中不少只是 contract（契约）或 proxy（代理）。90% 阶段需要明确哪些真的进入 runtime bridge（运行时桥）或 production wiring（生产接线）。

## 允许修改的文件
- `docs/backend-python-runtime-depth-audit-90.md`
- `agent-loop/tasks/backend-python-runtime-depth-audit-90.md`

## 禁止扩大范围
- 不修改业务代码。
- 不修改总迁移百分比。
- 不把 contract-only 计入 runtime 完成。
- 不提交 `.agent-loop` 运行产物。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `runtimeDepthAudit90Gates`。

## 成功标准

- 审计表覆盖当前 75 候选中的所有 `DONE_REVIEWED` 后端切片。
- 每项都有层级、证据和是否计入 90% 的判断。
- 列出下一步必须补 runtime 或 production wiring 的切片。
- mojibake（乱码）扫描通过。
