# 后端 NodeJS 到 Python 迁移：Blueprint job runtime proxy

## 执行状态
- 状态：待执行
- 目标：为 Blueprint job runtime 建立 Python proxy contract，让 Node 能安全委托 start/status/cancel/read。
- 角色分工：worker 负责 proxy contract 和测试；reviewer 确认 Node 仍是主控，Python 只是受控 runtime。

### 状态清单
- [x] Python 侧有 job runtime contract endpoint 或 service。
- [x] Node 侧有 start/status/cancel/read 代理测试。
- [x] timeout/cancel/failed 形状稳定。
- [x] gate 全绿。
- [x] Codex review 确认没有绕过 Node 主控。

## 目标

这一步把 Blueprint job runtime 从“只做局部 proxy”推进到更接近后端主流程的 job runtime 边界。它仍然是 proxy contract，不是完整替换 Node job store。

## 允许修改的文件
- `agent-loop/tasks/backend-python-blueprint-job-runtime-proxy.md`
- `tws-ai-slide-rule-python/routes/blueprint_jobs.py`
- `tws-ai-slide-rule-python/services/blueprint_job_runtime.py`
- `tws-ai-slide-rule-python/tests/test_blueprint_job_runtime_proxy.py`
- `server/routes/blueprint/jobs/service.ts`
- `server/routes/blueprint/jobs/service.test.ts`
- `server/routes/__tests__/blueprint.job-runtime-python-proxy.test.ts`
- `shared/blueprint/jobs/types.ts`

## 禁止扩大范围
- 不迁完整 artifact store。
- 不启动真实外部 worker。
- 不吞掉 Node 侧权限、审计和取消语义。
- 不提交运行产物。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `blueprintJobRuntimeProxyGates`。

## 成功标准

- Python 返回 start/status/cancel/read 四类稳定响应。
- Node proxy 测试覆盖 success、not_found、cancelled、runtime_error。
- cancel 不能伪装成 done。
- gate 全绿。
