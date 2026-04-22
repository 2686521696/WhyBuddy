# 任务清单：文档检索节点

- [x] 定义文档检索输入输出
  已有 `shared/rag/web-aigc-search.ts` 定义 `WebAigcSearchRequest`、`WebAigcDocumentSearchResponse`、`WebAigcFragmentSearchResponse` 等契约，覆盖查询词、检索范围、文档级/片段级结果、分值、摘要与高亮字段。

- [x] 接入知识与 RAG 查询
  已有 `server/routes/rag.ts` 暴露 `POST /api/rag/web-aigc/document-search`，并通过 `server/rag/web-aigc-search-adapter.ts` 将节点请求映射到现有 RAG retriever。
  按当前代码事实，`document_search` 直接打通的是 RAG 检索链，尚未看到独立挂到 `server/routes/knowledge.ts` 的专用入口；若按“已接入检索能力主链”判断，该项可以保持已勾。

- [x] 输出文档级证据
  已有 `projectDocumentSearchResponse(...)` 将片段检索结果按 `documentId` 聚合为文档级结果，并输出 `fragments`、`highlights`、`summary`、`score` 等证据字段；对应行为已有路由测试覆盖。

- [x] 验证权限与范围隔离
  `server/routes/rag.ts` 现已在检测到全局 `PermissionCheckEngine` 时，对 `POST /api/rag/web-aigc/document-search` / `fragment-search` 执行 `database:select` 权限校验，资源按 `rag_${scope.projectId}` 收敛；缺少 `agentId` / `token` 会返回 400，权限拒绝返回 403，对应行为已有 `server/tests/rag-web-aigc-routes.test.ts` 覆盖。当前闭环属于“项目级 collection 权限 + 请求范围过滤”的最小实现，尚未扩展到更细粒度的文档级 ACL / 租户身份体系。
  现状补充：`projectId` 目前同时承担工作区/项目边界语义；新增测试已覆盖空结果返回 `results: [] + totalCandidates: 0`、权限资源严格绑定 `rag_${projectId}`、以及 retriever 失败时返回 500 且不误记成功检索指标。
