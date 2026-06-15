# SlideRule Code Wiki

本目录是一套面向开发者的仓库级 Code Wiki，基于当前代码结构、入口文件、主要路由、共享契约、执行器服务与运行脚本整理，目标是帮助新成员快速回答以下问题：

- 这个仓库整体由哪些层组成
- 每个主模块负责什么
- 前后端如何通信
- `shared/` 为什么是整个项目的协议中心
- `lobster-executor` 在系统中的位置是什么
- 本地开发、构建、测试和部署该怎么跑

## 文档导航

- [`01-overview.md`](./01-overview.md)
  - 仓库整体架构、目录地图、主链路、依赖关系、关键入口
- [`02-frontend.md`](./02-frontend.md)
  - 前端应用结构、页面与状态管理、API 接入、实时更新链路
- [`03-backend.md`](./03-backend.md)
  - 服务端装配方式、核心路由、任务编排、权限、知识/RAG、关键类与函数
- [`04-shared-contracts.md`](./04-shared-contracts.md)
  - `shared/` 共享协议层设计、核心 contract、跨层依赖关系
- [`05-executor.md`](./05-executor.md)
  - `services/lobster-executor` 的结构、执行模式、API、与主服务协作方式
- [`06-runbook.md`](./06-runbook.md)
  - 环境变量、开发启动、构建发布、测试验证、常用排障入口

## 适用范围

- 仓库根包：`sliderule`
- 核心前端：`client/`
- 核心后端：`server/`
- 共享协议：`shared/`
- 独立执行器：`services/lobster-executor/`
- 开发与发布脚本：`scripts/`

## 建议阅读顺序

1. 先看 `01-overview.md`，建立整体心智模型
2. 再看 `02-frontend.md` 和 `03-backend.md`，理解两端职责
3. 然后看 `04-shared-contracts.md`，理解契约边界
4. 若涉及任务执行或沙箱运行，再看 `05-executor.md`
5. 实际启动与联调时，查 `06-runbook.md`

## 维护原则

- 当新增一级业务域、重要路由、核心 store、共享 contract、执行器能力或启动脚本时，同步更新对应 Wiki 文档
- 当接口路径、端口、环境变量或主入口发生变化时，优先更新 `01-overview.md` 与 `06-runbook.md`
- 当 `shared/` 中的导出路径或 barrel 结构变化时，优先更新 `04-shared-contracts.md`
