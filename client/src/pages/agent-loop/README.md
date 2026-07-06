# Agent Loop 页面（Workbench = SlideRule 的执行观察面板）

> **定位（2026-07 定案）：** `/agent-loop/workbench` 不是独立产品方向，
> 而是主线 SlideRule 的**执行观察面板**——用来查看 run 的 overview / detail / settings。
> 见 [`docs/NORTH_STAR.md`](../../../../docs/NORTH_STAR.md)。

- 数据全部来自 Python 后端 `/api/agent-loop/*`（`slide-rule-python/routes/agent_loop.py`）。
- 迭代原则：跟随主线需要（sliderule 推演的执行可视化）演进，不单独规划功能。
