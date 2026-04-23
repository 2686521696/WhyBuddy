# 任务清单：图片检索节点

- [x] 定义图片检索输入输出
- [x] 设计图片搜索适配器
- [x] 支持结果预览信息
- [x] 验证来源与可用性处理

## 完成说明

- 已新增 `shared/web-aigc-image-search.ts`，定义 `image_search` 节点输入输出、候选图片结果、可用性与降级响应结构。
- 已新增 `server/routes/node-adapters/image-search-node-adapter.ts`，实现基于文本、标签、参考图描述的最小图片检索闭环，默认使用本地候选图片集合完成 mock 检索。
- 已新增 `server/routes/image-search.ts`，提供独立 `POST /api/image-search/nodes/execute` 路由，不改 `server/index.ts`。
- 已新增 `server/tests/image-search-node-adapter.test.ts` 与 `server/tests/image-search-routes.test.ts`，覆盖输入校验、图片候选输出、预览信息、可用性统计、执行器失败后的降级说明。
