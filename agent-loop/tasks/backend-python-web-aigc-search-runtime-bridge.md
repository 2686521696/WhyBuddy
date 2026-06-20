# 后端 NodeJS 到 Python 迁移：Web AIGC search runtime bridge

## 执行状态
- 状态：待执行
- 目标：把 Web AIGC search adapter（搜索适配器）从 contract-only（只有契约）推进到 Python runtime bridge（运行时桥）。
- 角色分工：worker 负责 Python runtime bridge 和 Node proxy test；reviewer 确认不发真实外部搜索请求。

### 状态清单
- [ ] Python search runtime bridge 支持 web/graph/image/static page 四类形状。
- [ ] Node adapter 能在 Python backend 开关下调用 runtime bridge。
- [ ] empty/error/permission denied 不伪装成 success。
- [ ] gate 全绿。
- [ ] Codex review 确认没有真实外部网络依赖。

## 目标

上一轮已经有 search adapter contract。这个任务推进到 runtime bridge，但 provider 仍使用 fake/in-memory provider（假/内存提供方）。重点是 Node 到 Python 的调用边界、状态字段和 provenance（来源）稳定。

## 允许修改的文件
- `tws-ai-slide-rule-python/services/web_aigc_search_adapter.py`
- `tws-ai-slide-rule-python/tests/test_web_aigc_search_runtime_bridge.py`
- `tws-ai-slide-rule-python/tests/test_web_aigc_search_adapter_contract.py`
- `server/routes/node-adapters/web-search-node-adapter.ts`
- `server/routes/node-adapters/graph-search-node-adapter.ts`
- `server/routes/node-adapters/image-search-node-adapter.ts`
- `server/routes/node-adapters/static-webpage-read-node-adapter.ts`
- `server/routes/__tests__/web-aigc.search-python-runtime.test.ts`
- `server/routes/__tests__/web-aigc.search-python-contract.test.ts`
- `agent-loop/tasks/backend-python-web-aigc-search-runtime-bridge.md`

## 禁止扩大范围
- 不接真实搜索 API。
- 不抓真实网页内容。
- 不改 UI。
- 不吞掉 permission/audit 字段。
- 不更新总迁移百分比。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `webAigcSearchRuntimeBridgeGates`。

## 成功标准

- Python 测试覆盖 success、empty、error、permission denied。
- Node 测试确认 Python backend 开关下能走 runtime bridge。
- provenance 和 query 字段稳定。
- 所有 gate 通过，且不依赖外部网络。
