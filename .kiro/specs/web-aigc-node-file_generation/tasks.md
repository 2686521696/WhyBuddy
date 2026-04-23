# 任务清单：文件生成节点

- [x] 定义文件生成输入输出
- [x] 接入 artifact 管理
- [x] 支持预览与下载
- [x] 验证路径安全

## 完成说明

- 已新增 `shared/web-aigc-file-generation.ts`，定义 `file_generation` 节点输入输出、artifact 元数据、预览与下载契约。
- 已新增 `server/routes/node-adapters/file-generation-node-adapter.ts`，完成基础格式内容生成、产物落盘、artifact 元数据生成、预览元信息与路径安全校验。
- 已新增 `server/routes/file-generation.ts`，提供 `POST /api/file-generation/nodes/execute`、`GET /api/file-generation/outputs/:outputId/:filename`、`GET /api/file-generation/outputs/:outputId/:filename/preview` 三个最小闭环入口。
- 已新增 `server/tests/file-generation-node-adapter.test.ts` 与 `server/tests/file-generation-routes.test.ts`，覆盖内容生成、artifact 管理、预览下载元数据、路径安全与错误处理。
