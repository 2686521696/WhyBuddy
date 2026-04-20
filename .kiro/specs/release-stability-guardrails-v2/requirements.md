# 发布稳定性护栏方案 v2

## 目标

给当前收敛后的主线产品补齐最小工程护栏，确保上线前至少具备：

- 可重复构建
- 可重复测试
- 最小 CI
- 最小恢复能力
- 最小部署文档

## 当前状态（2026-04-20）

- 本 spec 当前完成度约 `40%`
- 仓库已具备 `build`、`check`、`test:client`、`test:server`、`test:executor`、`test:release` 等基础命令
- README 已补齐 Quick Start、环境变量样例、执行器启动方式和常用命令
- 当前最主要缺口仍是统一 `lint / typecheck / test / build` 聚合入口与真正串联质量门禁的 CI

## 范围

本轮覆盖：

- npm scripts
- typecheck / lint / test 入口
- GitHub Actions 最小 CI
- 关键链路最小测试
- 错误恢复与重连
- README quick start

不覆盖：

- 全量观测平台升级
- 多环境复杂发布流水线
- K8s 或云原生编排
- 一次性重写所有历史脚本体系

## 必须满足

- 仓库必须有统一的 `lint`、`typecheck`、`test`、`build` 聚合入口
- 当前仓库仅部分具备：`build` 已存在，`typecheck` 现阶段由 `check` 承接，`test` 仍以分拆脚本与 `test:release` 为主，`lint` 尚未建立
- 聚合入口优先建立在现有脚本之上，不要求一次性替换所有历史拆分命令
- 必须存在 CI 入口
- 至少覆盖任务状态机、executor 调用、decision 流
- websocket 断开必须有自动重连
- executor 超时必须 fail，不允许静默卡死
- server 重启后至少支持任务 attach 或任务状态恢复
- README 必须提供 3 步内跑起来的 quick start
- CI 与文档需要对齐仓库声明的 package manager，并说明与其他包管理器的兼容策略

## 发布门禁

至少需要通过：

1. 目标门禁：`npm run lint`
2. 目标门禁：`npm run typecheck`
3. 目标门禁：`npm run test`
4. 当前已具备的构建门禁：`npm run build`

当前替代口径：

- 类型检查可先使用 `npm run check`
- 测试可先使用 `npm run test:client`、`npm run test:server`、`npm run test:executor` 或 `npm run test:release`
- 如仓库继续保留拆分测试入口，也必须最终补出统一别名汇总

## 验收标准

- 新同事可以按 README 在短时间内跑起项目
- PR 具备自动化基础校验
- 关键运行链路失败时，用户不会无提示卡死
