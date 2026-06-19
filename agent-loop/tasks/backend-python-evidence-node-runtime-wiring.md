# 后端 NodeJS 到 Python 迁移：evidence Node runtime wiring

## 执行状态
- 状态：待执行
- 目标：把 evidence Node proxy contract（证据 Node 代理契约）推进到 Node 调 Python 的 runtime wiring（运行时接线）最小闭环。
- 角色分工：worker 负责 Node/Python 接线和测试；reviewer 确认错误形状、provenance 和 fallback 诚实。

### 状态清单
- [ ] Node 侧 evidence route 可以在 Python mode 下调用 Python evidence runtime。
- [ ] Python 成功、fallback、错误三种响应形状被 Node 测试锁住。
- [ ] Node 不吞掉 provenance（证据来源）字段。
- [ ] gate 全绿。
- [ ] Codex review 确认没有绕回旧 Node-only fake path。

## 目标

现有 evidence proxy contract 已经锁住契约，但还需要更像真实运行时的 Node 到 Python 接线。这个任务只推进 evidence search 的最小 runtime wiring，不迁整个 RAG 系统。

## 允许修改的文件
- `server/routes/sliderule.ts`
- `server/sliderule/python-delegation.ts`
- `server/routes/__tests__/sliderule.evidence-python-runtime.test.ts`
- `server/routes/__tests__/sliderule.evidence-python-proxy-contract.test.ts`
- `tws-ai-slide-rule-python/routes/sliderule.py`
- `tws-ai-slide-rule-python/sliderule_llm/evidence.py`
- `tws-ai-slide-rule-python/tests/test_evidence_node_runtime_wiring.py`
- `agent-loop/tasks/backend-python-evidence-node-runtime-wiring.md`

## 禁止扩大范围
- 不重构整个 `server/routes/sliderule.ts`。
- 不改非 evidence capability 的路由行为。
- 不接真实 vector store。
- 不提交运行产物或密钥。
- 不更新总迁移百分比。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `evidenceNodeRuntimeWiringGates`。

## 成功标准

- Node vitest 能证明 Python mode 下 evidence capability 会调用 Python runtime。
- Python pytest 能证明 evidence runtime 响应包含诚实 provenance。
- Python 不可用时 Node 返回明确错误或 fallback，不伪装成功。
- 所有 gate 通过。
