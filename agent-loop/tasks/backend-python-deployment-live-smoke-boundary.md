# 后端 NodeJS 到 Python 迁移：Deployment live smoke boundary

## 执行状态
- 状态：待执行
- 目标：补齐 Node 到 Python 部署/live smoke 的边界验证，确保代理链路、health、timeout、配置缺失都有可见结果。
- 角色分工：worker 负责 live smoke contract 和测试；reviewer 确认测试不依赖真实外部服务或本机偶然状态。

### 状态清单
- [x] Python health/live smoke 覆盖必要 runtime config。
- [x] Node route/client 能区分 healthy、unhealthy、timeout、misconfigured。
- [x] smoke 不触发真实 LLM/外部 agent。
- [x] gate 全绿。
- [x] Codex review 确认部署边界可用于后续生产检查。

## 目标

薄代理链路已经接近闭合，但部署可见性还不够。这个任务只做 live smoke boundary，让运行时配置和健康状态可测试。

## 允许修改的文件
- `tws-ai-slide-rule-python/tests/test_deployment_live_smoke_boundary.py`
- `server/routes/__tests__/python-deployment-live-smoke.test.ts`
- `server/tests/persistence-health-routes.test.ts`
- `agent-loop/tasks/backend-python-deployment-live-smoke-boundary.md`

## 禁止扩大范围
- 不调用真实 LLM、外部 agent 或生产服务。
- 不修改部署平台配置。
- 不把 smoke 做成全量端到端测试。
- 不提交 `.agent-loop` 运行产物。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `deploymentLiveSmokeBoundaryGates`。

## 成功标准

- health/live smoke 能区分 healthy、unhealthy、timeout、misconfigured。
- Node 测试覆盖 Python mode 的部署边界。
- smoke 只验证边界，不触发真实外部副作用。
- 所有 gate 通过。
