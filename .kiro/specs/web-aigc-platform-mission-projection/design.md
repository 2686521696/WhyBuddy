# 设计文档：Web-AIGC 平台任务投影

## 设计概述

Cube 不应同时维护两套用户可见执行模型。图编排应作为底层执行结构，任务系统仍然作为用户操作主界面。

## 投影设计

1. `workflow` 作为编排请求入口
2. `mission` 作为操作与执行壳
3. `task/event/replay` 承载可见进度与证据链

## 接口映射

- `server/routes/workflows.ts`：编排入口与编排详情
- `server/routes/tasks.ts`：操作、决策、产物、取消
- `server/routes/replay.ts`：执行过程回放
- `server/routes/aigc-monitoring.ts`：监控兼容接口；实例详情、会话与终止能力都从 `workflow + mission + graph` 投影派生，不引入独立事实源

## 设计约束

- 不拆出第二套前台控制台
- 不允许图实例脱离 mission 独立漂移
- `MissionProjectionView.monitoring` 仅承载摘要字段，完整监控详情继续通过兼容接口派生
- replay 路由路径参数虽然命名为 `missionId`，但在任务投影链路中应视为 replay timeline key 使用
