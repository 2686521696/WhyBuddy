# 后端 NodeJS 到 Python 迁移：Web AIGC AI PPT runtime 97

## 执行状态

- 状态：待执行
- 目标：把 AI PPT route/provider 从 Node-only 长尾推进到 Python runtime bridge，并保留 outline、slide plan、degraded/error 语义。
- 角色分工：worker 负责 Python AI PPT adapter、Node adapter/route bridge 和测试；reviewer 确认没有调用真实 LLM、PPT 生成器或外部文件服务。

### 状态清单

- [ ] Python runtime 支持 outline/slide-plan/export-intent success/degraded/error envelope。
- [ ] Node AI PPT route/adapter 能映射 Python result，并保留 provenance、permission、audit metadata。
- [ ] degraded/error 不伪装成 generated。
- [ ] gate 全绿。
- [ ] Codex review 确认没有真实生成 PPT 文件或调用外部 provider。

## 目标

AI PPT 是 Web AIGC 长尾里用户可见度高、分母较大的 route。这个任务只迁 Python decision/runtime boundary：outline、slide plan、export intent 和错误语义，不做真实 PPT 生成。

## 允许修改的文件

- `tws-ai-slide-rule-python/services/web_aigc_ai_ppt_adapter.py`
- `tws-ai-slide-rule-python/tests/test_web_aigc_ai_ppt_runtime.py`
- `server/routes/ai-ppt.ts`
- `server/routes/node-adapters/ai-ppt-node-adapter.ts`
- `server/core/ai-ppt-generation-provider.ts`
- `server/tests/ai-ppt-python-runtime.test.ts`
- `server/tests/ai-ppt-routes.test.ts`
- `server/tests/ai-ppt-node-adapter.test.ts`
- `server/tests/ai-ppt-generation-provider.test.ts`
- `shared/web-aigc-ai-ppt.ts`
- `agent-loop/tasks/backend-python-web-aigc-ai-ppt-runtime-97.md`

## 禁止扩大范围

- 不调用真实 LLM、office/PPT SDK、文件存储、下载服务或外部 provider。
- 不生成或提交真实 PPT、图片、截图、用户文件。
- 不迁 OCR/static/image/graph search 或其它 Web AIGC route。
- 不降低 permission/audit/provenance 语义。
- 不提交 `.agent-loop` 运行产物。
- 不更新整体迁移百分比。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `webAigcAiPptRuntime97Gates`。

## 成功标准

- Python 测试覆盖 outline、slide plan、export intent、degraded、provider_missing、error。
- Node 测试确认 AI PPT route/adapter/provider 能稳定映射 Python result。
- 现有 AI PPT route/provider 测试继续通过。
- 产生真实业务代码 diff，不能以 `HALT_NO_CHANGES` 收口。
- 所有 gate 通过。
