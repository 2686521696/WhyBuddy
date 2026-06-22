# 后端 NodeJS 到 Python 迁移：Web AIGC dynamic chart runtime 96

## 执行状态
- 状态：待执行
- 目标：把 `/api/dynamic-chart` 从 node-only 推进到 Python runtime bridge，覆盖 chart spec decision envelope。
- 角色分工：worker 负责 Python dynamic chart adapter、Node adapter/route 映射和测试；reviewer 确认没有接真实图表渲染服务或扩大到全部 Web AIGC。

### 状态清单
- [x] Python runtime 支持 chart spec、data validation、warning/error envelope。
- [x] Node dynamic-chart adapter/route 能映射 Python chart_ready/invalid/degraded/error。
- [x] invalid/degraded/error 不伪装成 chart_ready。
- [x] gate 全绿。
- [x] Codex review 确认没有迁真实可视化渲染、外部图表平台或其它 Web AIGC 路由。

## 目标

Web AIGC long-tail 中 dynamic chart 当前仍是 node-only。本任务只迁 dynamic chart decision envelope，让 Python 负责规范化 chart spec、校验输入和返回可诊断错误。

## 允许修改的文件
- `tws-ai-slide-rule-python/services/web_aigc_dynamic_chart_adapter.py`
- `tws-ai-slide-rule-python/tests/test_web_aigc_dynamic_chart_runtime.py`
- `server/routes/dynamic-chart.ts`
- `server/routes/node-adapters/dynamic-chart-node-adapter.ts`
- `server/tests/dynamic-chart-python-runtime.test.ts`
- `server/tests/dynamic-chart-routes.test.ts`
- `server/tests/dynamic-chart-node-adapter.test.ts`
- `shared/web-aigc-dynamic-chart.ts`
- `agent-loop/tasks/backend-python-web-aigc-dynamic-chart-runtime-96.md`

## 禁止扩大范围
- 不迁 `/api/ai-ppt`、`/api/web-qa`、OCR、image/graph search 或其它 Web AIGC 路由。
- 不接真实图表渲染服务、浏览器截图、外部 BI 平台或数据库。
- 不改权限/audit 全局策略，只保留 metadata。
- 不提交 `.agent-loop` 运行产物。
- 不更新总迁移百分比。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `webAigcDynamicChartRuntime96Gates`。

## 成功标准

- Python 测试覆盖 chart spec success、invalid data、unsupported chart、degraded provider、runtime error。
- Node 测试确认 route/adapter 对 Python 状态映射稳定。
- 现有 dynamic-chart route/adapter 测试继续通过。
- 产生真实业务代码 diff，不能以 `HALT_NO_CHANGES` 收口。
- 所有 gate 通过。
