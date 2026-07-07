# 活系统蓝图 v2：引擎优先——五系统模型直接"落地"为可运行的应用

> 状态：方案定稿（v2，引擎优先），待启动 M0。
> 依据：对 `beae028b-web.zip`（五个 qiankun 微前端，63MB）与 `f7b6100b-backend.zip`
> （rbac-backend 引擎，18MB）的全量摸底（2026-07-07/08）。
> v1（五前端 iframe 方案）已被本版取代——用户定调：**"这是个引擎，不是每个系统都要跑端口，
> 每个系统都是通过 JSON 维护的。"** 摸底证实了这个判断。

## 一、核心发现：后端就是那台"JSON → 活行为"引擎

`rbac-backend`（Express + Sequelize + MySQL，Redis 可选）逐模块验证结果：

| 系统 | JSON 定义 | 引擎行为 | 判定 |
|---|---|---|---|
| 工作流 | `flow_schema`（X6 cells）| **真状态机**：`workflowEngine.ts` 按 schema 推进实例，网关/会签/或签/自动节点/子流程/审批人解析全有执行器 | ✅ 活 |
| 数据中台 | DataModel/Field/Relation | **真动态建表**：`schemaManager.ts` 发 `CREATE TABLE dm_*`，`queryBuilder` 动态 SQL，`/api/data/{model}` 真 CRUD（含行列权限/校验/回收站） | ✅ 活 |
| 页面设计器 | PageSchema | **真运行时**：`designerRenderService.renderPage()` 渲染已发布页 + 真执行数据源（api/database/workflow） | ✅ 活 |
| 应用中心 | Application + 绑定 | **真发布**：`appVersionService.publishVersion()` 全应用快照（pages/workflows/dataModels/menu/permissions）+ 回滚 | ✅ 活 |
| RBAC | roles/permissions/menus | 真鉴权链（JWT + 权限守卫 + 菜单树下发） | ✅ 活 |
| AIGC | 编排定义/节点配置 | 混合：`ai/orchestration/FlowExecutor` 真执行简化编排（拓扑排序+LLM/HTTP/RAG 节点）；设计器大编排目前仅 CRUD | ⚠️ 半活 |

**契约核对**：五个前端点名的全部端点（`/api/auth`、`/api/roles`、`/api/menus/tree`、
`/api/workflow/flow-templates|process-configs`、`/api/data-platform/models|fields|relations`、
`/api/data/{model}`、`/api/designer/pages`、`/api/applications`、`/api/apps/:id/permissions`、
AIGC `/v1/:tenantId/*`）在引擎里**全部命中**（另有 `/wk` 别名前缀）。
响应包络以 `{success,data,message}` 为主；鉴权 JWT（Cookie `token` 或 Bearer）；
seed 自带演示账号 `admin@demo.com / admin123`。

## 二、目标架构（引擎优先）

```
SlideRule 左栏推演 ──► 五系统模型（结构闸通过）
                          │
                          ▼  「落地」= 模型 → 引擎 API 调用序列（python 转换器）
              ┌───────────────────────────────┐
              │   rbac-backend 引擎 · :3002    │   ← 唯一常驻新进程
              │   MySQL（必需）· Redis（不配） │
              │  数据中台=真表  工作流=真审批   │
              │  RBAC=真权限   页面/应用=真发布 │
              └───────────────────────────────┘
                          ▲
        SlideRule 右栏直接消费引擎 API 渲染「活画面」：
        实体表格可增删改（/api/data/*）· 流程可发起实例真审批 ·
        角色菜单是真的 · 应用可发布出版本快照
                          │
        五个微前端 = 可选的「专业编辑器」，需要深度设计时再单独起某一个

导出：现有固定格式一字不变；附加引擎侧应用快照（M3）
```

与 v1 的区别：**不再以五个前端 dev server 为主体**（每个 1-2GB 内存、五个端口）。
引擎是唯一新增常驻进程；右栏的"实时画面 + 可操作"由 SlideRule 自己的 UI 直连引擎 API 实现；
前端套件降级为按需启动的专业编辑器。

## 三、「落地」转换器（M0 的核心交付）

python 侧新增 `slide-rule-python/services/engine_seeder.py`：
输入 = 会话的五系统模型；输出 = 对引擎的幂等 API 调用序列（每话题一个命名空间前缀防冲突）：

1. **datamodel** → `POST /api/data-platform/models` + `/fields`（+`ref`→`/relations`）+ 发布
   → 引擎真建 `dm_*` 表，`/api/data/{model}` 立即可 CRUD
2. **rbac** → `POST /api/roles`、`/api/permissions`、`/api/menus`
3. **workflow** → 模型 nodes/transitions → X6 cells `flow_schema` → `POST /api/workflow/flow-templates`
   → `process-configs` + `:id/deploy` → 可发起真实审批实例
4. **page** → PageSchema（fieldBindings→组件）→ `POST /api/designer/pages` + `/schema` + 发布
5. **aigc** → Prompt 模板 + 节点定义（真执行接 FlowExecutor 留 M2+）
6. **appbundle** → `POST /api/applications` + 资源绑定 + `menuConfig` + `publishVersion`
   → 一个带版本快照的**真应用**

鉴权：seeder 用演示账号登录拿 JWT；右栏走同一 token。
幂等：以 `sr-{sessionId}` 前缀命名资源，重复落地先清后建。

## 四、分阶段路线（v2）

- **M0 · 引擎入仓 + 数据中台先活**
  vendor `engine/`（18MB 源码）→ 启动配方（本地 MySQL + 免 Redis + :3002 端口，避开本仓库
  Node 的 :3001）→ seeder 实现 datamodel 落地 → 右栏 DataModel 屏新增「打开活数据」：
  真实体表格 + 增删改行（直连 `/api/data/*`）。
  验收：健身房话题闭环 → 落地 → 右栏能给 `dm_*` 表插一行真数据。
- **M1 · 工作流 + RBAC + 应用中心落地**
  flow_schema 转换器（模型→X6 cells）→ deploy → 右栏可发起实例、审批推进（真状态机）；
  roles/menus 落地；application 绑定 + publishVersion。
- **M2 · 双向 + 页面运行时**
  引擎侧修改（如在专业编辑器里改了流程）→ 反向转换回模型段 → 重新过结构闸 →
  闭环证据更新（改坏如实 blocked）。designer renderPage 输出嵌入右栏。
- **M3 · 导出收口**
  固定格式不变；交付包附加引擎应用快照（appVersion snapshot JSON）。

## 五、启动配方（M0 目标形态）

```
# 依赖：本地 MySQL（原 cube_pets_office 项目同款依赖，机器上大概率已有）
engine/.env:  DB_HOST=127.0.0.1 DB_NAME=sliderule_engine DB_USER=... DB_PASSWORD=...
              PORT=3002  JWT_SECRET=<随机>   # 不配任何 REDIS_*
cd engine && npm i && npm run db:migrate && npm run db:seed   # admin@demo.com/admin123
npm run dev                                                    # :3002
# dev:all 增加 engine 可选启动（检测 engine/.env 存在才起），vite 代理 /api/engine → :3002
```

已知代价与对策：
- **MySQL 必需**（动态建表引擎的正当依赖）。SQLite 改造为数周级重构（107 模型、
  两套共 98 个 MySQL 方言 migration、动态 DDL 全站），明确不做。
- **Redis 不配**：代码已优雅降级；仅失去队列类功能（超时提醒/异步导入导出），可接受。
  唯一小改：`config/redis.ts` 关掉启动即连（降噪）。
- **端口**：引擎默认 3001 与本仓库 Node 冲突 → 统一 3002。
- **AIGC 大编排只存不跑**：M0/M1 只落 Prompt/节点定义，不承诺编排执行。

## 六、附：五前端套件（v1 遗产，按需使用）

web-main(:8100 RBAC 门户) / web-workflow(:8200) / web-dataplatform(:8300) /
web-designer(:8400) / web-aigc(:8500)，全部 qiankun slave + standalone 双模式，
`/api` 代理指到引擎即可用。作为「专业编辑器」按需单个启动，不进常驻链路。
调查细节（数据契约、schema 形状、挂载方式）见 git 历史中本文件的 v1 版本。
