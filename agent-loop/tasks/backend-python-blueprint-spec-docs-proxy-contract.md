# 后端 NodeJS 到 Python 迁移：Blueprint spec-docs proxy contract

## 执行状态

- 状态：已完成 — Blueprint spec-docs Python proxy 契约已落地
- 目标：建立 Blueprint/spec-docs（蓝图/规格文档）Node 到 Python thin proxy（薄代理）契约
- 前置：`backend-python-blueprint-spec-docs-inventory.md` 已完成

### 状态清单

- [x] 已执行本地实现
- [x] Node route/helper 能委托 Python spec-docs endpoint
- [x] Python endpoint 返回稳定 shape（形状）
- [x] Node LLM / pool 在 Python mode 下不参与该切片
- [x] gate 全绿
- [x] 人工 review（审查）已确认 diff 干净

## 最近执行

- 最近执行：2026-06-19
- 执行方式：Codex 本地实现，不发真实外部 LLM 请求
- Python endpoint：`/api/blueprint/spec-documents/generate-one`
- Node 开关：`BLUEPRINT_SPEC_DOCS_PYTHON_PROXY=true`
- gate 结果：`blueprintProxyGates` 通过

## 目标

做一个最小 Blueprint/spec-docs Python proxy，不全量迁 Blueprint。Node 保持外壳和兼容路由，Python 负责一个明确的 spec-docs LLM 子能力。

## 允许修改的文件

- `tws-ai-slide-rule-python/routes/blueprint_spec_docs.py`
- `tws-ai-slide-rule-python/tests/test_blueprint_spec_docs_proxy.py`
- `server/routes/__tests__/blueprint.spec-docs-python-proxy.test.ts`
- `server/routes/blueprint/**`（仅 proxy wiring 必要处）
- `agent-loop/tasks/backend-python-blueprint-spec-docs-proxy-contract.md`

## 禁止扩大范围

- 不迁整个 Blueprint/Autopilot。
- 不改前端 UI。
- 不引入真实外部 LLM 请求。
- 不破坏现有 Node spec-docs 路径。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `blueprintProxyGates`。

## 成功标准

- Python endpoint 有 contract test。
- Node proxy test 证明 Python mode 下委托 Python，且不调用 Node LLM/pool。
- TypeScript 通过。
- diff 只落在允许文件范围内。
