# 后端 NodeJS 到 Python 迁移：runtime config boundary

## 执行状态

- 状态：已完成
- 目标：明确 Python service（Python 服务）运行配置、端口、代理、health check（健康检查）和 Node 调用边界
- 前置：SlideRule Python proxy 和 Blueprint/spec-docs proxy 至少有一条 smoke gate

### 状态清单

- [x] 已执行 AgentLoop
- [x] Python runtime env（运行环境变量）边界已文档化
- [x] Node 调 Python 的 base URL / timeout / proxy 规则已验证
- [x] health check（健康检查）和错误分类已覆盖
- [x] gate 全绿
- [x] 人工 review（审查）已确认 diff 干净

## 目标

把“Python 后端怎么启动、Node 怎么找它、代理怎么处理、失败怎么报”这些运行边界固化下来，避免后续迁移切片在端口/env/proxy 上各自发明规则。

## 允许修改的文件

- `tws-ai-slide-rule-python/config/settings.py`
- `tws-ai-slide-rule-python/tests/test_runtime_config_boundary.py`
- `server/sliderule/python-delegation.ts`
- `server/routes/__tests__/python-runtime-config-boundary.test.ts`
- `docs/backend-python-runtime-config-boundary.md`
- `agent-loop/tasks/backend-python-runtime-config-boundary.md`

## 禁止扩大范围

- 不改生产部署脚本，除非测试证明必须补最小配置。
- 不提交真实 `.env`。
- 不改业务 capability。
- 不迁新的 route。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `runtimeConfigGates`。

## 成功标准

- Python runtime 配置边界有文档和测试。
- Node delegation 在 base URL、timeout、proxy、health failure 上行为清楚。
- TypeScript 和 Python runtime config 测试全绿。
