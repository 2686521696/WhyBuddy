# 后端 NodeJS 到 Python 迁移：Blueprint spec-docs smoke gate

## 执行状态

- 状态：已完成
- 目标：给 Blueprint/spec-docs Python proxy 建立 smoke gate（冒烟门禁）
- 前置：`backend-python-blueprint-spec-docs-proxy-contract.md` 已完成

### 状态清单

- [x] 已执行 AgentLoop
- [x] Python service + Node proxy smoke 可跑
- [x] smoke 不依赖真实 LLM key
- [x] 失败原因能区分服务不可达、契约错误、代理错误
- [x] gate 全绿
- [x] 人工 review（审查）已确认 diff 干净

## 目标

补一个可重复执行的 smoke gate，确认 Blueprint/spec-docs 的 Python proxy 不是只在单元测试里成立，而是在本地服务/代理边界也能跑通。

## 允许修改的文件

- `tws-ai-slide-rule-python/tests/test_blueprint_spec_docs_smoke.py`
- `server/routes/__tests__/blueprint.spec-docs-smoke.test.ts`
- `agent-loop/scripts/migration-queue.json`（仅 gate 命令必要时）
- `agent-loop/tasks/backend-python-blueprint-spec-docs-smoke-gate.md`

## 禁止扩大范围

- 不要求真实外部 LLM key。
- 不迁其它 Blueprint 能力。
- 不提交端口日志、缓存、`.env`。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `blueprintSmokeGates`。

## 成功标准

- smoke gate 能在本地稳定运行。
- 至少覆盖 Python health、Node proxy、response shape 三层。
- 错误信息可用于定位是哪层失败。
