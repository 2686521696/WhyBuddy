# 办公室主壳收敛方案 v1 设计

## 根因

当前不好用的根因不是单页缺陷，而是信息架构发散：

- `App.tsx` 同时暴露 `/`、`/tasks`、`/command-center`、`/command-center/legacy`、`/lineage`
- `Toolbar` 继续强化“office / tasks / more”三入口心智
- `Home`、`TasksPage`、`CommandCenterPage` 都在部分承担任务主流程
- 用户必须先判断“我要去哪一页”，而不是直接开始任务

## 目标路由结构

本轮收敛后的推荐结构：

- `/` -> 唯一主入口
- `/tasks` -> 全屏工作台 / 队列与深度跟进页，不承担发起任务职责
- `/tasks/:taskId` -> 深链详情页
- `/replay/:missionId` -> 回放页
- `/debug` -> 隐藏调试页，承接 lineage / audit / permission / config 等低频能力

兼容阶段允许短期保留：

- `/tasks`
- `/lineage`

但这些页面不再作为主导航高频入口。

## 路由处理策略

### `/`

保留为主入口，并扩充为任务操作系统壳。

### `/command-center`

不再保留独立主流程语义。
短期策略：

- 直接重定向到 `/`
- 或渲染一个极轻的兼容提示页，说明功能已并入首页

推荐直接 redirect。

### `/command-center/legacy`

直接退场，不再保留显式入口。
如有兼容需要，可在代码层短期保留 route，但页面只做跳转，不再渲染完整 UI。

### `/tasks`

降级为全屏任务工作台，不再承担发起与补问入口。
允许保留队列、详情、运行跟进和深度任务检查能力，但默认心智必须是“跟进”而不是“开始”。

### `/lineage`

从主导航移出，迁入 `/debug` 或更多隐藏入口。

### `/debug`

本 spec 只负责定义 `/debug` 的路由壳和隐藏入口策略。
不要求在同一轮里完成 lineage / audit / permission / config 的全部内容迁移，具体内容归口可由后续 spec 接续完成。

## 导航收敛策略

### Toolbar

目标是把 Toolbar 从“页面分发器”改成“全局工具条”：

- 主导航优先只保留首页
- 深链详情不在主导航常驻暴露
- 低频能力归入 debug / more / hidden surface

### navigation-config

不再把 `/tasks` 视为与 `/` 同等级主入口。
不再把 `/lineage` 视为需要直达的普通路径。

## 代码落点

- `client/src/App.tsx`
- `client/src/components/Toolbar.tsx`
- `client/src/components/navigation-config.ts`
- `client/src/pages/Home.tsx`
- `client/src/pages/tasks/TasksPage.tsx`
- `client/src/pages/nl-command/CommandCenterPage.tsx`
- `client/src/pages/nl-command/LegacyCommandCenterPage.tsx`

## 风险与约束

- 本轮不能把太多低频能力物理删除，否则回归风险过高
- 应优先做“入口收口”而不是“功能删库”
- 允许保留旧实现，但不能继续暴露为主线入口
- `App.tsx`、`Toolbar.tsx`、`navigation-config.ts` 是热点文件，应避免与其他导航 spec 同时改动

## 手工验证重点

- 首页是否成为唯一明确入口
- 旧命令中心是否不再可见
- 任务详情深链是否仍可打开
- 回放与 debug 是否仍可访问
