# 后端 NodeJS 到 Python 迁移：web-aigc search adapters contract

## 执行状态
- 状态：待执行
- 目标：为 web search、graph search、image search、static webpage read 等搜索类 adapter 建立 Python contract。
- 角色分工：worker 负责 contract 和测试；reviewer 确认没有发真实外部搜索请求。

### 状态清单
- [x] Python 侧有 search adapter contract。
- [x] Node 侧测试覆盖 success/empty/error/permission denied。
- [x] provenance（来源）和 query 字段稳定。
- [x] gate 全绿。
- [x] Codex review 确认没有真实外部网络依赖。

## 目标

把 Node 搜索类 adapters 迁出一层 contract，让 Python 能表达结果形状。先用 fake provider，不接真实搜索。

## 允许修改的文件
- `agent-loop/tasks/backend-python-web-aigc-search-adapter-contract.md`
- `tws-ai-slide-rule-python/services/web_aigc_search_adapter.py`
- `tws-ai-slide-rule-python/tests/test_web_aigc_search_adapter_contract.py`
- `server/routes/node-adapters/web-search-node-adapter.ts`
- `server/routes/node-adapters/graph-search-node-adapter.ts`
- `server/routes/node-adapters/image-search-node-adapter.ts`
- `server/routes/node-adapters/static-webpage-read-node-adapter.ts`
- `server/routes/__tests__/web-aigc.search-python-contract.test.ts`
- `shared/web-search.ts`
- `shared/web-aigc-graph-search.ts`
- `shared/web-aigc-image-search.ts`

## 禁止扩大范围
- 不接真实搜索 API。
- 不保存真实网页内容。
- 不改 UI。
- 不吞掉 permission/audit 字段。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `webAigcSearchAdapterContractGates`。

## 成功标准

- Python contract 覆盖 web/graph/image/static page 四类搜索形状。
- Node 测试确认 empty 和 error 不伪装成 success。
- provenance 字段保留。
- gate 全绿。
