# 办公室主壳收敛方案 v1 手工验证

## 当前验证口径（2026-04-20）

- 本文按当前实现回填，目标是验证“主入口与导航心智已收敛”，而不是要求所有历史低频页面在本轮彻底删除
- `/command-center` 当前应直接回到首页
- `/command-center/legacy` 当前应直接兼容跳转回首页，不应再表现为旧版主工作台或兼容说明页
- `/lineage` 当前应兼容跳转到 `/debug/lineage`
- `/debug` 已存在隐藏路由壳，当前应至少承接 `overview / config / permissions / audit / lineage`
- `help` 当前也应从 `MoreDrawer` 导向 `/debug/help`，不再以主壳 modal 形式单独存在

## 1. 唯一入口验证

1. 打开首页 `/`
2. 观察首屏是否明确告诉用户这里就是任务入口
3. 验证用户无需跳去 `/tasks` 或 `/command-center` 才能开始任务

## 2. 路由兼容验证

1. 访问 `/command-center`
2. 验证是否跳回首页或只出现极轻兼容提示
3. 访问 `/command-center/legacy`
4. 验证这里会直接跳回首页，而不是继续承载旧版完整指挥中心
5. 访问 `/lineage`
6. 验证是否跳转到 `/debug/lineage`

## 3. 深链验证

1. 访问 `/tasks/:taskId`
2. 验证任务详情仍可查看
3. 访问 `/replay/:missionId`
4. 验证回放仍可使用
5. 访问 `/debug`、`/debug/config`、`/debug/permissions`、`/debug/audit`、`/debug/lineage`、`/debug/help`
6. 验证隐藏调试面与各分区都可打开，且不会出现在普通主导航高频区

## 4. 导航验证

1. 打开桌面导航和移动端导航
2. 验证首页是唯一默认高频入口，`/tasks` 更偏查看和跟进
3. 验证低频能力不再占据主导航；如仍可从 `More` 或隐藏入口打开，也应属于降权状态
4. 打开 `MoreDrawer`
5. 验证 `config / permissions / audit / help` 已统一导向 `/debug/*`

## 5. 文案与心智验证

1. 检查首页、任务页、兼容页文案
2. 验证不会同时出现“办公室 / 任务台 / 指挥中心都是主入口”的冲突表达
