# 任务清单：结束节点

- [x] 定义最终输出结构
  - `server/core/workflow-runtime-engine.ts` 已注册 `end` 内置适配器，统一收敛 `status / summary / artifacts / result / finalVariables`。
  - `end` 节点支持通过配置模板引用上游变量，并将最终结果写入 `WebAigcGraphInstance.output`。
- [x] 打通实例完成与报告收敛
  - `server/core/workflow-runtime-engine.ts` 在实例进入 `EXECUTED` 后已自动调用 runtime reportRepo 生成 `final_report`。
  - 运行时完成报告已回写到 `workflow.results.final_report`，可由现有 `/api/workflows/:id/report` 读取链路复用。
- [x] 写入结束事件
  - `server/core/workflow-runtime-engine.ts` 在 runtime 完成时已发射 `workflow_complete` 事件。
  - 当前事件会进入既有 `eventEmitter -> socket` 通道，形成 Web-AIGC runtime 的最小完成事件闭环。
- [x] 验证多分支收敛场景
  - `server/tests/workflow-runtime-engine.test.ts` 已新增 `selection -> end-approved / end-rejected` 的运行时测试。
  - 已验证分支选择后命中正确 `end` 节点、实例完成、最终输出收敛、`final_report` 持久化以及 `workflow_complete` 事件发射。

现状说明见：`.kiro/specs/web-aigc-node-end/现状核查.md`
