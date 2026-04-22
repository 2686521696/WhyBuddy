# 任务清单：向量查询节点

> 本次对账依据 2026-04-22 当前仓库实现与测试重新核查，重点核对了：
> `shared/rag/web-aigc-search.ts`、`server/rag/web-aigc-search-adapter.ts`、`server/routes/rag.ts`、`server/rag/retrieval/rag-retriever.ts`、`server/rag/observability/metrics.ts`、`server/tests/rag-web-aigc-routes.test.ts`、`server/tests/rag-observability.property.test.ts`。
> 本轮结论已更新：4 项任务当前都已有实现与测试支撑，可保持已完成状态。

- [x] 定义向量查询输入输出
  - 已具备的范围：
    - `shared/rag/web-aigc-search.ts` 已定义 `WebAigcSearchRequest`、`WebAigcSearchScope`、`WebAigcSearchOptions`、`WebAigcDocumentSearchResponse`、`WebAigcFragmentSearchResponse` 等输入输出契约。
    - 同文件已定义 `DOCUMENT_SEARCH`、`FRAGMENT_SEARCH` 两个 Web-AIGC 检索 API 常量，节点对外接口边界明确。
    - `server/rag/web-aigc-search-adapter.ts` 已实现请求归一化、结果投影与基础校验。
    - `server/routes/rag.ts` 已对 `query`、`scope.projectId` 做请求校验，并返回统一的成功/失败结构。
  - 仍需注意的范围：
    - 当前输入契约以文本 `query` 为主，并通过检索层内部向量化完成语义检索；如果后续 spec 需要“直接传入原始向量”，还需补充专门字段与校验。
  - 结论：面向 `vector_query` 节点的输入输出契约已经落地，可勾选。

- [x] 对接现有 RAG 检索接口
  - `server/routes/rag.ts` 中的 `/api/rag/web-aigc/document-search`、`/api/rag/web-aigc/fragment-search` 已通过 `runWebAigcSearch()` 复用现有 `deps.retriever.search()`。
  - `server/rag/web-aigc-search-adapter.ts` 已把 Web-AIGC 请求映射为现有 `RetrievalOptions`：
    - `projectId`
    - `topK`
    - `sourceTypes`
    - `sourceIds`
    - `agentId`
    - `codeLanguage`
    - `minScore`
    - `mode`
    - `expandContext`
    - `contextWindowChunks`
  - `server/rag/retrieval/rag-retriever.ts` 已提供现有 RAG 检索实现，支持：
    - `semantic`
    - `keyword`
    - `hybrid`
    - 基于 `sourceType / sourceId / agentId / codeLanguage / timeRange` 的过滤
  - `server/tests/rag-web-aigc-routes.test.ts` 已验证 Web-AIGC 路由会把请求正确投递给 `retriever.search()`。
  - 结论：已接入现有 RAG 检索链路，可勾选。

- [x] 输出元数据与分值
  - `shared/rag/web-aigc-search.ts` 中：
    - `WebAigcFragmentSearchHit` 已包含 `score`、`metadata`、`highlight`、`positionHint`
    - `WebAigcDocumentSearchHit` 已包含文档级 `score`，并内嵌片段结果
  - `shared/rag/contracts.ts` 中 `RetrievalResult` 已定义 `score`、`metadata`、`content`、`sourceType`、`sourceId` 等核心字段。
  - `server/rag/retrieval/rag-retriever.ts` 会从 `metadataStore` 组装 `ChunkMetadata`，再返回到检索结果。
  - `server/rag/web-aigc-search-adapter.ts` 会把检索结果进一步投影为：
    - 片段 `summary / highlight / positionHint / metadata / score`
    - 文档聚合后的 `score / highlights / fragments`
  - `server/tests/rag-web-aigc-routes.test.ts` 已覆盖结果分组、片段过滤、摘要与高亮投影。
  - 结论：结果中的元数据与分值输出已具备，可勾选。

- [x] 写入查询监控事件
  - 已具备的范围：
    - `server/rag/observability/metrics.ts` 已定义 `RAGMetrics.recordRetrieval()` 以及 `rag_retrieval_total`、`rag_retrieval_hit_rate` 等检索指标结构。
    - `server/routes/rag.ts` 已暴露 `/api/admin/rag/metrics` 查看指标快照。
    - `server/routes/rag.ts` 当前已在以下查询入口成功路径中调用 `deps.metrics.recordRetrieval(latencyMs, hasResults)`：
      - `/api/rag/search`
      - `/api/rag/web-aigc/document-search`
      - `/api/rag/web-aigc/fragment-search`
    - `server/tests/rag-web-aigc-routes.test.ts` 已新增并验证：
      - `document-search` 会写入 retrieval metrics
      - `fragment-search` 会写入 retrieval metrics
      - 通用 `/api/rag/search` 也会写入 retrieval metrics
      - 参数校验失败时不会误写 metrics
    - `server/tests/rag-observability.property.test.ts` 已验证指标对象本身的累加与快照逻辑。
  - 仍需注意的范围：
    - 当前已完成的是 metrics 写入，不等于已经补齐 Web-AIGC 检索专用 audit/event catalog。
    - 如果后续要把“审计事件”和“监控指标”合并成统一可观测语义，还可以继续补 observability 事件定义。
  - 结论：查询监控事件已经真正接入主查询链路，可勾选。

> 复核补充：
> `server/tests/rag-web-aigc-routes.test.ts` 本轮运行通过 5/5；
> `server/tests/rag-observability.property.test.ts` 本轮运行通过 3/3。
> 这些测试现在已经能证明两件事：
> 1. 路由适配已落地；
> 2. 检索请求已经写入 retrieval metrics。
