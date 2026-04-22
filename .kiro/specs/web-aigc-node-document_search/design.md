# 设计文档：文档检索节点

## 设计概述

`document_search` 当前由 Cube 现有 RAG 检索链路直接承接，是 web-aigc 文档检索节点在主仓中的兼容实现。

## 接口映射

- `web-aigc` 节点：`document_search`
- Cube 承接主入口：`server/routes/rag.ts`
- 结果投影与参数归一化：`server/rag/web-aigc-search-adapter.ts`
- 底层检索执行：`server/rag/retrieval/rag-retriever.ts`

说明：

- 按当前代码事实，`document_search` 已接入 `POST /api/rag/web-aigc/document-search`。
- 设计上可以与知识问答能力协同，但当前没有独立挂到 `server/routes/knowledge.ts` 的专用文档检索入口。

## 运行流程

1. 调用方提交 `query + scope.projectId`，可选附带 `documentIds`、`sourceTypes`、`topK`、`mode` 等约束。
2. 路由层校验请求，并在启用权限引擎时校验 `agentId + token + rag_${projectId}` 的 `database:select` 权限。
3. 适配层将 web-aigc 请求归一化为现有 `RetrievalOptions`，由 RAG retriever 执行检索。
4. 检索结果按 `documentId` 聚合为文档级证据，输出 `summary`、`highlights`、`fragments`、`score`。
5. 下游节点按文档级结果继续消费，或退回空结果。

## 范围与隔离

- 当前最小工作区边界由 `scope.projectId` 承担，底层 collection 命名为 `rag_${projectId}`。
- 可选的 `documentIds`、`sourceTypes`、`agentId`、`codeLanguage` 会继续缩小检索范围。
- 当前尚未扩展为文档级 ACL、显式租户字段或独立 workspace 身份体系。

## 空结果与失败表现

- 当检索命中在 `documentIds` / `sourceTypes` 过滤后为空时，接口仍返回 `200`，并返回：
  - `results: []`
  - `totalCandidates: 0`
- 当底层 retriever 抛错时，当前路由返回 `500`，错误体保持 `{ error: string }` 的最小结构。
- 检索指标按最终返回结果计数：若文档级结果为空，则记为一次无命中检索；失败请求不记成功检索指标。
