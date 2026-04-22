# 任务清单：知识问答节点

- [x] 定义知识问答输入输出结构
- [x] 对接知识检索与 RAG 路由
- [x] 输出引用与证据列表
- [x] 写入检索质量事件
  - `server/routes/knowledge.ts` 已在 `POST /api/knowledge/nodes/execute` 成功执行后记录 `external.knowledge_retrieval` 审计事件。
  - 事件元数据已覆盖最小检索质量口径：
    - `projectId`
    - `queryMode`
    - `latencyMs`
    - `structuredEntityCount`
    - `relationCount`
    - `semanticHitCount`
    - `citationCount`
    - `evidenceCount`
  - `shared/web-aigc-observability.ts` 已补充 `external.knowledge_retrieval` 事件目录。
  - `server/tests/knowledge-routes.test.ts` 已补充事件断言，验证路由执行后会落审计事件。
