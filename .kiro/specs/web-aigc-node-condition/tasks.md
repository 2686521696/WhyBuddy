# 任务清单：条件节点

> 2026-04-22 现状核查：当前主仓除控制流快照投影外，已新增 `condition` 运行时内置适配器，能够在 `workflow-runtime-engine` 中直接执行表达式、输出 `conditionMatched / branchKey / rationale`，并在非法表达式时返回运行时异常；`node.completed` 与 `edge.transitioned` 也会随运行时分支推进一起发射。详见 `现状核查.md`。

- [x] 定义条件表达式模型
- [x] 实现分支命中结果结构
- [x] 写入条件判定事件
- [x] 验证异常表达式处理
