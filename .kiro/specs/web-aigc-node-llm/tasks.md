# 任务清单：LLM 节点

> 本次对账依据 2026-04-22 当前仓库实现与测试重新核查，重点核对了：
> `shared/workflow-runtime.ts`、`shared/runtime-agent.ts`、`shared/llm/contracts.ts`、`shared/telemetry/contracts.ts`、`server/runtime/server-runtime.ts`、`server/core/llm-client.ts`、`server/routes/telemetry.ts`、`server/routes/cost.ts`。
> 本轮结论：4 项任务当前都已有实现与测试支撑，可继续保持已完成状态。

- [x] 定义通用 LLM 输入输出结构
- [x] 接入现有模型抽象
- [x] 支持结构化输出
- [x] 写入成本与延迟指标

> 复核补充：
> 本轮实际运行通过：
> `server/tests/llm-client.provider-fallback.test.ts` `1/1`、
> `server/tests/telemetry.test.ts` `10/10`、
> `server/tests/cost-tracker.test.ts` `77/77`、
> `server/tests/cost-api.test.ts` `8/8`、
> `server/tests/agent-vision-events.test.ts` `5/5`、
> `server/tests/nl-command/decision-support.test.ts` `18/18`、
> `server/tests/nl-command/command-analyzer.test.ts` `16/16`。
