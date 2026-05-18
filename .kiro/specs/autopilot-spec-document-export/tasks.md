# 实施任务清单：Autopilot SPEC Document Export

## 概览

按 "底层 helper → 服务层 → 路由 → 前端 API → 前端 UI → 测试" 顺序落地。
所有改动遵循全局工程约束：中文 JSDoc / 注释 / commit message；不引入
PBT；不扩 TS 116 基线；不破 5140+ 测试；不修改受保护文件。

## 任务

- [x] 1. 实现文件名清洗 helper
  - [x] 1.1 新建 `server/routes/blueprint/spec-documents/export/sanitize-filename-segment.ts`
    - 导出纯函数 `sanitizeFilenameSegment(raw: string): string`
    - 替换字符 `< > : " / \ | ? *` 为 `-`；连续空白合成 `_`；trim 首尾空白；
      截断 80 字符；空结果回退 `"untitled"`
    - 中文 JSDoc 说明每条规则与对应 Req 4.1 锚点
    - _Implements Req 4.1_
  - [x] 1.2 编写单元测试 `server/routes/blueprint/__tests__/sanitize-filename-segment.test.ts`
    - 6 个 example-based 用例覆盖保留字符 / 空白合并 / 截断 / 空结果 /
      全 emoji / Windows 保留字符 + 中文混排
    - _Implements Req 4.1, 5.1_

- [x] 2. 实现导出归档服务层
  - [x] 2.1 新建 `server/routes/blueprint/spec-documents/export/spec-documents-export-archive.ts`
    - 导出类型 `SpecExportGranularity`、`SpecExportRequest`、
      `SpecExportArchiveResult`、`BuildSpecExportResult`
    - 导出 async fn `buildSpecExportArchive(request, deps)`：完整实现
      single / node / tree 三条路径、参数校验、404 / 400 分支、
      MANIFEST.json 组装、jszip 序列化
    - 处理同名 node 冲突：碰撞时附加 `-<nodeId.slice(0,6)>`
    - 不修改 store；不抛错；调用方根据 `kind` 字段映射 HTTP 状态
    - _Implements Req 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10, 4.2, 4.3_
  - [x] 2.2 编写单元测试 `server/routes/blueprint/__tests__/spec-documents-export-archive.test.ts`
    - 共 11 用例：单文档 happy + 缺字段 + 文档不存在；节点级 happy +
      0 文档；整树 happy + 0 文档；granularity 越界；job 不存在；
      MANIFEST.json 内容断言；同名 nodeTitle 碰撞分隔
    - 用 fake `getJob` / `listSpecDocuments` deps，不依赖真实 store
    - _Implements Req 1.1-1.10, 5.1, 5.4_

- [x] 3. 在路由层挂载导出端点
  - [x] 3.1 在 `server/routes/blueprint.ts` 中添加 `GET /jobs/:jobId/spec-documents/export` 路由
    - 紧跟既有 GET /jobs/:jobId/spec-documents 路由后挂载
    - 解析 query `granularity / nodeId / type`，调 `buildSpecExportArchive`
    - 按 `result.kind` 分支响应：`invalid_request → 400`，`not_found → 404`，
      `ok → 200` + Content-Type + `Content-Disposition: attachment;
      filename="<filename>"` 头
    - body 为 string 时 `res.send(body)`；为 Uint8Array 时 `res.send(Buffer.from(body))`
    - _Implements Req 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8_
  - [x] 3.2 在 `server/tests/blueprint-routes.test.ts` 追加 1 条端到端测试
    - `withServer` + `createSelectedSpecTree` + 触发 spec-documents 生成
      （走模板兜底）后 GET 导出端点
    - 断言：response.status === 200，content-type 含 application/zip，
      content-disposition 含 `filename=`，response.arrayBuffer() 长度 > 0，
      zip 内文件数 = documents.length + MANIFEST，
      manifest.granularity === "tree"，manifest.documents 与 documents 等长
    - _Implements Req 1.1, 1.4, 1.9, 5.1_

- [x] 4. 实现前端导出 API helper
  - [x] 4.1 新建 `client/src/lib/blueprint-api/exportSpecDocuments.ts`
    - 导出 async fn `exportSpecDocumentsToDownload(args)`
    - 内部 `fetch(url, { signal })`；非 2xx 抛 Error 含 status + body 摘要
    - 解析 `Content-Disposition` 头取 filename（regex），缺失时回退到
      `<jobId>-<granularity>.<ext>`
    - 用 `URL.createObjectURL(blob)` + 临时 `<a download>` 触发下载，
      finally 清理 `URL.revokeObjectURL` + removeChild
    - 注：因 `client/src/lib/blueprint-api.ts` 单体文件优先解析，
      消费者直接从 `@/lib/blueprint-api/exportSpecDocuments` 子路径导入，
      不走 barrel re-export（已确认 TS 116 基线零增量）
    - _Implements Req 2.2, 3.3_
  - [x] 4.2 编写测试 `client/src/lib/blueprint-api/__tests__/exportSpecDocuments.test.ts`
    - 5 用例：成功路径 / Content-Disposition 解析 / URL encoding /
      4xx 错误 / 网络错误
    - 用 `vi.stubGlobal` 注入 minimal document / URL stub（node 环境无 DOM）
    - 不引入 jsdom / @testing-library/react，沿用项目惯例
    - _Implements Req 2.2, 5.1, 5.4_

- [x] 5. 在 SpecDocPreviewBlock 加单文档导出按钮
  - [x] 5.1 修改 `client/src/pages/autopilot/right-rail/spec-tree-workbench/SpecDocPreviewBlock.tsx`
    - 接受新增可选 prop `jobId?: string`（无 jobId 不渲染按钮，向后兼容）
    - 在 `document` 存在分支的 type badge / status 行末追加 `<button>`：
      下载图标用 ↓ / ⚠ / … 字符，aria-label 走 zh-CN 文案
    - 状态机：idle | downloading | error，downloading 时 aria-disabled，
      error 时 enabled + ⚠ icon + tooltip 显示截断错误原因
    - onClick 调 `exportSpecDocumentsToDownload({ jobId, granularity:"single", nodeId, type })`
    - `event.stopPropagation()` 防止触发行展开/收起
    - _Implements Req 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_
  - [x] 5.2 修改 `SpecTreeWorkbench.tsx` 把 `jobId` 透传给 `SpecDocPreviewBlock`
    - 把已经存在的 `_jobId` prop 改为 `jobId`，向下传给每个
      `SpecTreeNodeRow` 与 `SpecDocPreviewBlock`
    - `SpecTreeNodeRowProps` 新增 `jobId: string` 字段
    - _Implements Req 2.1_
  - [x] 5.3 在 `__tests__/SpecDocPreviewBlock.test.tsx` 追加 3 用例
    - 提供 jobId + document 时渲染 export button + aria-label
    - 缺 jobId 时不渲染（向后兼容）
    - document undefined 时不渲染
    - _Implements Req 2.1, 2.5, 2.6, 5.1_

- [x] 6. 在 SpecTreeWorkbench 加节点级 + 整树导出按钮
  - [x] 6.1 修改 `SpecTreeWorkbench.tsx`
    - 新增 `BulkExportButton` 子组件支持 granularity="node" 与 "tree"
    - 顶部 CTA 行追加 `导出全部 SPEC` 按钮：
      `data-testid="spec-tree-workbench-export-all"`，无任何文档时 disabled
    - 节点行展开区底部追加 `导出本节点 .zip` 按钮：
      `data-testid="spec-tree-node-export-button"`，该节点 0 文档时 disabled
    - 两按钮共享同一状态机 + 失败 inline 提示模式
    - _Implements Req 3.1, 3.2, 3.3, 3.4, 3.5_
  - [x] 6.2 在 `__tests__/SpecTreeWorkbench.test.tsx` 追加 2 用例
    - 至少一个节点有文档 → export-all 按钮渲染，不 disabled
    - 全无文档 → export-all 按钮 disabled
    - 节点级按钮覆盖通过 source-level + manual-verification 校验
      （SSR 不展开行，sliding 导出按钮一并验证）
    - _Implements Req 3.1, 3.2, 5.1_

- [x] 7. Checkpoint — 全量回归与基线核对
  - [x] 7.1 跑相关测试集
    - `node ./node_modules/vitest/vitest.mjs run server/routes/blueprint/__tests__/sanitize-filename-segment.test.ts server/routes/blueprint/__tests__/spec-documents-export-archive.test.ts --config vitest.config.server.ts` → 17/17 passed
    - `node ./node_modules/vitest/vitest.mjs run server/tests/blueprint-routes.test.ts -t "exports the full SPEC tree" --config vitest.config.server.ts` → 1/1 passed
    - `node ./node_modules/vitest/vitest.mjs run client/src/pages/autopilot/right-rail/spec-tree-workbench/__tests__ client/src/lib/blueprint-api/__tests__/exportSpecDocuments.test.ts` → 36/36 passed
    - _Implements Req 5.1, 5.3_
  - [x] 7.2 TS 基线校验
    - 首次 check 报 118 错误（多 2）；定位到 `@/lib/blueprint-api` 单体
      文件优先解析导致 barrel re-export 不生效；改为消费者直接从
      `@/lib/blueprint-api/exportSpecDocuments` 子路径导入
    - 修复后 `node --run check` → 116（与改动前完全一致）
    - 无 `// @ts-ignore` / `as any` 伪装通过
    - _Implements Req 5.2_
  - [x] 7.3 ensure all tests pass, ask the user if questions arise
    - 没有 borderline 设计选择需要决策；已知预先存在 2 处
      blueprint-routes mock counter 失败与本 wave 无关，留作单独跟进
    - _Implements Req 5.3_

## 备注

- 所有任务编号严格对应 design 章节顺序；`_Implements Req x.y_` 反引用
  `requirements.md` 内 N.M 验收标准
- 不允许引入 jsdom / @testing-library/react；前端测试一律走
  `react-dom/server` SSR + `vi.mock`，沿用项目现状
- jszip 已是项目既有依赖（`@types/jszip` 也已存在）；不引入新顶层 npm 包
- 任务执行完合并到当前分支后，建议同步在 PR 描述中说明：测试用更新对
  `BlueprintSpecDocument.content` 字段无 fallback 行为变更
- 若后续需要 RFC 5987 编码（含中文 filename 浏览器兼容），可在 4.1 内
  按需扩展，但当前 ASCII filename 即可满足绝大多数浏览器

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "2.1"] },
    { "id": 2, "tasks": ["2.2"] },
    { "id": 3, "tasks": ["3.1"] },
    { "id": 4, "tasks": ["3.2", "4.1"] },
    { "id": 5, "tasks": ["4.2"] },
    { "id": 6, "tasks": ["5.1", "5.2"] },
    { "id": 7, "tasks": ["5.3", "6.1"] },
    { "id": 8, "tasks": ["6.2"] },
    { "id": 9, "tasks": ["7.1", "7.2"] },
    { "id": 10, "tasks": ["7.3"] }
  ]
}
```
