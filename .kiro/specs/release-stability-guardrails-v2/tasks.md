# 发布稳定性护栏方案 v2 任务拆解

## 当前状态快照（2026-04-20，已按仓库脚本与 CI 现状复核）

- 总体状态：进行中，约 40%
- 已有落地：
  - `package.json` 已提供 `build`、`check`、`test:client`、`test:server`、`test:executor` 与 `test:release`
  - `.github/workflows/deploy-pages.yml` 已存在基础 GitHub Actions，但当前仅用于 Pages 构建发布
  - README 已补齐 Quick Start、环境变量样例、执行器单独启动方式与常用命令
  - 恢复能力已有基础：浏览器侧恢复流程、`MissionRuntime.recoverInterruptedMissions(...)` 与 `mission-restart-smoke.mjs`
  - 关键链路测试已有一定覆盖：mission routes / operator actions / HITL decision / executor smoke / restart recovery
- 当前剩余：
  - 缺少统一 `lint`、`typecheck`、`test` 聚合入口；`lint` 脚本尚未建立
  - CI 尚未串联 install / lint / typecheck / test / build 最小质量门禁
  - 决策 approve / reject / modify 的统一关键链路回归仍未按本 spec 收口
  - websocket 自动重连与任务重新 attach 仍缺少明确的 spec 级验收闭环

## Tasks

- [ ] 1. 收口仓库脚本
  - [x] 1.1 盘点现有脚本与 package manager 口径
  - [ ] 1.2 统一 `lint`
  - [ ] 1.3 统一 `typecheck`
  - [ ] 1.4 统一 `test`
  - [x] 1.5 统一 `build`
  - [ ] 1.6 保留历史拆分命令兼容性，并通过聚合入口对外收口

- [ ] 2. 建立最小 CI
  - [x] 2.1 新增 GitHub Actions
  - [ ] 2.2 按仓库声明的 package manager 串联 install / lint / typecheck / test / build

- [ ] 3. 补齐关键链路测试
  - [x] 3.1 任务状态机测试
  - [x] 3.2 executor 成功 / 超时 / 失败测试
  - [ ] 3.3 decision approve / reject / modify 测试

- [ ] 4. 补齐错误恢复
  - [ ] 4.1 websocket 自动重连
  - [x] 4.2 executor 超时 fail
  - [ ] 4.3 任务重新 attach
  - [x] 4.4 server 重启后最小状态恢复

- [ ] 5. 补齐 README
  - [x] 5.1 Quick Start
  - [x] 5.2 环境变量说明
  - [x] 5.3 可选 executor 启动说明
  - [ ] 5.4 package manager 与命令口径说明
  - [ ] 5.5 常见问题

- [ ] 6. 发布门禁回归
  - [ ] 6.1 本地跑通 lint
  - [ ] 6.2 本地跑通 typecheck
  - [ ] 6.3 本地跑通 test
  - [ ] 6.4 本地跑通 build
