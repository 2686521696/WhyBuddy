# 迁移 SlideRule 的 synthesis.merge 到 Python 真脑子

## 执行状态

- 状态：已完成 — Python native LLM + Node 委托已落地，gate 全绿
- 目标 capability：`synthesis.merge`
- 预期 provenance：`python-llm`

- 最近执行：2026-06-17
- 最近确认：2026-06-17
- AgentLoop run id：`2026-06-17T14-08-51-623Z`
- AgentLoop 本地时间：`2026-06-17 22:08:51 (Asia/Shanghai)`
- AgentLoop 结果：`HALT_NO_CHANGES`
- AgentLoop 运行模式：`halt-no-changes`
- Grok 已运行：`true`
- Codex 已运行：`false`
- gate 结果：最近状态为 `HALT_NO_CHANGES`
### 状态清单

- [x] Python `synthesis.merge` 走 `sliderule_llm.capabilities.execute_capability()`
- [x] Python 返回 `provenance="python-llm"`
- [x] Node python mode 委托 Python，跳过 Node LLM/pool
- [x] Python / Node / TS gate 通过

## 目标

把 `synthesis.merge` 从 Python mapped/RAG 路径迁到真 LLM markdown 输出（审议收敛类，沿用 critique 模板，非 JSON schema）。

不要顺手迁 `rebuttal.resolve` 或其它 cap。

## 允许修改的文件

- `tws-ai-slide-rule-python/sliderule_llm/capabilities.py`
- `tws-ai-slide-rule-python/routes/sliderule_full.py`（仅当路由未走 native）
- `tws-ai-slide-rule-python/tests/test_capabilities.py`
- `tws-ai-slide-rule-python/tests/test_v5_contract_expansion.py`
- `server/routes/sliderule.ts`
- `server/routes/__tests__/sliderule.execute-capability.test.ts`

## 实现提示

1. prompt 三段：综合结论、仍存分歧、下一步最小动作
2. 从 `test_v5_contract_expansion.py` RAG 矩阵移除 `synthesis.merge`，加入 native 组
3. Node `isPythonV5Cap` 加入 `synthesis.merge`（若尚未包含）

## 必跑 gate

```powershell
cd tws-ai-slide-rule-python; .\.venv\Scripts\python.exe -m pytest tests/test_capabilities.py tests/test_config.py tests/test_v5_smoke.py tests/test_v5_contract_expansion.py -q --tb=short
```

```powershell
pnpm exec vitest run --config vitest.config.server.ts server/routes/__tests__/sliderule.execute-capability.test.ts --reporter=dot
```

```powershell
pnpm exec tsc --noEmit --pretty false
```

```powershell
node agent-loop/src/check-mojibake.js tws-ai-slide-rule-python server/routes/__tests__/sliderule.execute-capability.test.ts
```

## 成功标准

- All required gates listed above pass.
- `synthesis.merge` runs through the Python native LLM path and returns `provenance="python-llm"`.
- Node delegates `synthesis.merge` to Python when `SLIDERULE_V5_BACKEND=python`; Node LLM and Node pool are not called for this capability.
- The output remains markdown-oriented synthesis content, not a forced JSON schema response.
- The diff stays within the allowed files listed in this task.
