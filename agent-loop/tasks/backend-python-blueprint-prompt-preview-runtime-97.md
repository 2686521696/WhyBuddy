# 后端 NodeJS 到 Python 迁移：Blueprint prompt/preview runtime 97

## 执行状态

- 状态：待执行
- 目标：把 Blueprint prompt package 和 preview/effect preview 的最小运行时边界推进到 Python，不宣称完整 Blueprint 生成链路迁移完成。
- 角色分工：worker 负责 Python prompt/preview runtime、Node service bridge 和测试；reviewer 确认没有调用真实图像、LLM、Docker 或外部渲染服务。

### 状态清单

- [ ] Python runtime 支持 prompt package normalize/render/validation envelope。
- [ ] Python runtime 支持 preview request 的 safe plan/result/degraded/error envelope。
- [ ] Node prompt-package/effect-preview service 能映射 Python result，并保留 provenance、policy、cost metadata。
- [ ] degraded/error 不伪装成 preview succeeded。
- [ ] gate 全绿。
- [ ] Codex review 确认这只是 prompt/preview 小切片。

## 目标

Blueprint prompt package、effect preview、preview audit 仍是整体 95 的阻塞项。这个任务只做最小可测 runtime：把 prompt/preview 的输入输出、policy、degraded/error 语义交给 Python 表达，Node 保留路由和安全边界。

## 允许修改的文件

- `tws-ai-slide-rule-python/services/blueprint_prompt_preview.py`
- `tws-ai-slide-rule-python/tests/test_blueprint_prompt_preview_runtime.py`
- `server/routes/blueprint/prompt-package/service.ts`
- `server/routes/blueprint/prompt-package/normalize.ts`
- `server/routes/blueprint/prompt-package/render.ts`
- `server/routes/blueprint/effect-preview/service.ts`
- `server/routes/blueprint/preview-audit/service.ts`
- `server/routes/__tests__/blueprint.prompt-preview-python-runtime.test.ts`
- `server/routes/blueprint/prompt-package/service.test.ts`
- `server/routes/blueprint/effect-preview/service.test.ts`
- `server/routes/blueprint/preview-audit/service.test.ts`
- `shared/blueprint/preview-audit/types.ts`
- `agent-loop/tasks/backend-python-blueprint-prompt-preview-runtime-97.md`

## 禁止扩大范围

- 不发真实 LLM、image、Docker、browser、Mermaid 或外部 preview 请求。
- 不迁完整 spec-tree、spec-documents、engineering-handoff 或 replan。
- 不放宽 policy、cost、provenance 或 audit metadata。
- 不提交生成图片、日志、缓存或 `.agent-loop` 产物。
- 不更新整体迁移百分比。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `blueprintPromptPreviewRuntime97Gates`。

## 成功标准

- Python 测试覆盖 prompt package success/invalid/degraded/error 和 preview safe-failure。
- Node 测试确认 prompt-package/effect-preview/preview-audit 能稳定映射 Python result。
- 现有 prompt package 和 preview service 测试继续通过。
- 产生真实业务代码 diff，不能以 `HALT_NO_CHANGES` 收口。
- 所有 gate 通过。
