# SlideRule Python 迁移只读审计

## 执行状态

- 状态：任务模板已补中文，当前文件本身不是“已完成迁移”的证明
- 用途：只读审计当前 Node 到 Python 迁移状态
- 要求：不改文件、不暂存、不提交、不清理文件
- 运行产物：AgentLoop 报告会写到 `.agent-loop/latest/` 和 `.agent-loop/runs/`，运行产物不提交

目标：运行一次只读 AgentLoop 审计，检查当前 SlideRule Node 到 Python 迁移基线。

这个任务只用于看状态。它不能编辑文件、暂存文件、提交文件或清理文件。

## 审计范围

- 检查 `tws-ai-slide-rule-python/`、`server/routes/sliderule.ts`、`server/sliderule/python-delegation.ts` 和相关 server 测试。
- 报告必须分层，不要把所有进度压成一个百分比：
  - 整体 NodeJS 后端迁 Python。
  - SlideRule V5 子系统迁移。
  - Node 到 Python 薄代理链路。
  - Python V5 可运行基线。
  - 测试契约健康度。
  - RAG/vector 成熟度。
- 整体 NodeJS 后端迁 Python 是最大分母，不能因为 SlideRule 局部较成熟就说整体迁移已经很高。

## 已知起始估计

把这些数字当作起点。只有 gate 或代码审计证明状态变化时，才调整它们：

- 整体 NodeJS 后端迁 Python：约 8-12%。
- SlideRule V5 子系统迁移：约 58-62%。
- SlideRule V5 Node 到 Python 薄代理链路：约 85%。
- Python V5 可运行基线：约 70%。

## 必跑 gate

```powershell
cd tws-ai-slide-rule-python; .\.venv\Scripts\python.exe -m pytest tests/test_config.py tests/test_v5_smoke.py tests/test_v5_contract_expansion.py -q --tb=short
```

```powershell
pnpm exec vitest run --config vitest.config.server.ts server/routes/__tests__/sliderule.execute-capability.test.ts server/routes/__tests__/sliderule.live-delegation.test.ts --reporter=dot
```

```powershell
pnpm exec tsc --noEmit --pretty false
```

## AgentLoop 命令

从仓库根目录运行：

```powershell
node agent-loop/src/loop.js `
  --cwd C:\Users\wangchunji\Documents\cube-pets-office `
  --task agent-loop/tasks/sliderule-python-audit-only.md `
  --gate "cd tws-ai-slide-rule-python; .\.venv\Scripts\python.exe -m pytest tests/test_config.py tests/test_v5_smoke.py tests/test_v5_contract_expansion.py -q --tb=short" `
  --gate "pnpm exec vitest run --config vitest.config.server.ts server/routes/__tests__/sliderule.execute-capability.test.ts server/routes/__tests__/sliderule.live-delegation.test.ts --reporter=dot" `
  --gate "pnpm exec tsc --noEmit --pretty false" `
  --skip-review `
  --max-iterations 1
```

## 报告要求

最终报告要先列发现，再给分层进度表，最后列下一片迁移建议。

不要凭记忆宣称完成。必须用 gate 输出和当前代码审计作为证据。
