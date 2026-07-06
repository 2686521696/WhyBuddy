# Autopilot（Legacy · v4 演示）

> **状态：已封存（2026-07）。** 见 [`docs/NORTH_STAR.md`](../../../../docs/NORTH_STAR.md)。

这是 SlideRule 的前身（v4 架构）：模糊想法 → 可执行规格，带 three.js 3D 蓝图墙。
它只连接 Node 后端（`/api/blueprint`），**不会迁移到 Python**。

封存约定：

- 路由 `/autopilot` 保留，可用于演示与对比。
- 不修 bug、不加功能、不做重构；相关 spec 不再推进。
- 可复用的部分（如推理视图模型 `derive-reasoning-view-model`）已被 SlideRule 共享，
  后续如需复用其它模块，抽取到共享位置后在主线迭代，不在本目录内改动。

当前主线是 `/sliderule`（`client/src/pages/sliderule/` + `slide-rule-python/`）。
