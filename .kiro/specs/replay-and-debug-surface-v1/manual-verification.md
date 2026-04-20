# 回放与调试面收口方案 v1 手工验证

## 当前验证口径（2026-04-20）

- 回放能力已经真实可用，手工验证重点是入口与内容是否稳定
- `/debug` 已形成隐藏内部入口，当前应至少承接 `overview / config / permissions / audit / lineage`
- `config / permissions / audit` 当前应从 `MoreDrawer` 收口到 `/debug/*`
- 旧 `/lineage` 深链当前应只保留兼容跳转到 `/debug/lineage`
- `help` 当前也应从 `MoreDrawer` 收口到 `/debug/help`

## 1. 回放入口验证

1. 完成一个任务
2. 从任务详情页或任务结果中的“查看回放”入口进入 `/replay/:missionId`
3. 验证回放页可正常加载

## 2. 回放内容验证

1. 验证可以看到计划
2. 验证可以看到关键步骤
3. 验证可以看到决策点与结果
4. 验证可以看到输出结果或关键证据

## 3. Debug 面验证

1. 进入 `/debug`
2. 验证当前至少能看到 `overview / config / permissions / audit / lineage / help` 的隐藏调试面结构
3. 分别访问 `/debug/config`、`/debug/permissions`、`/debug/audit`、`/debug/lineage`、`/debug/help`
4. 验证对应分区可以打开，且普通主导航中不再高频暴露这些能力
5. 访问 `/lineage`
6. 验证旧深链会兼容跳转到 `/debug/lineage`

## 4. 主流程干扰验证

1. 作为普通用户重新走一次首页主流程
2. 验证不会因为低频调试能力而分散注意力
3. 打开 `MoreDrawer`
4. 验证 `config / permissions / audit / help` 已属于低频导向入口，不再抢占主导航主流程
