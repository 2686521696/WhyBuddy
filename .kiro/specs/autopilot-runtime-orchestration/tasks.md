# 任务清单：任务自动驾驶 Runtime 编排层
## 编排模型

- [x] 梳理 `Destination / Route / Fleet / Takeover` 四类对象进入 runtime 的最小编排字段集合
- [x] 定义 `RuntimeOrchestrationRecord` 的最小结构与关联键
- [x] 定义编排层与 `Mission Runtime`、`workflow runtime`、`decision / approval`、`executor` 的关联接口路径
- [x] 明确哪些编排字段适合放在服务端 `projection`，哪些适合放在前端 view model

## Destination 绑定

- [x] 梳理 `Destination` 到 Mission 创建、理解、规划上下文的字段映射
- [x] 定义 `Destination` 缺失信息如何触发澄清类 `Takeover`
- [x] 定义 `Destination` 变更时如何触发重绑定、重规划或重新进入等待态
- [x] 明确 `Destination` 的成功标准与交付物如何进入 Mission finalize 链路

## Route 绑定

- [x] 梳理 `Route` 到 `workflow definition`、`workflow instance`、`workflow phase` 的映射口径
- [x] 定义 `Route Stage` 与 Mission 六阶段、workflow 阶段之间的对齐关系
- [x] 定义 `Route Step` 到 `node`、`adapter`、`decision point`、`executor action` 的映射方式
- [x] 定义主路线、候选路线、路线切换与 `replanHistory` 的最小记录结构
- [x] 明确 `Route` 暂停、恢复、失败、重规划时的编排状态更新规则

## Fleet 绑定

- [x] 梳理 `Fleet` 角色到 `agents / skills / nodes / executors / adapters` 的映射表
- [x] 定义 Mission `provision` 阶段如何承接车队编组、资源准备与能力校验
- [x] 定义 `Fleet` 动态换绑、扩编、缩编与重规划后的更新规则
- [x] 明确 `Fleet` 运行健康、阻塞、负载如何反馈到高层状态投影

## Takeover 桥接

- [x] 梳理 `Takeover` 到 `MissionDecision`、`waiting`、`WAITING_INPUT`、`resume()`、`escalate()` 的映射
- [x] 定义阻塞型接管与建议型接管的 runtime 语义差异
- [x] 定义澄清、路线确认、预算确认、权限确认、风险接受、交付验收、异常接管的最小桥接模型
- [x] 明确接管提交后如何恢复原路径、切换路线或进入重规划
- [x] 明确高风险接管如何进入人工升级与审计链路

## 控制主线

- [x] 定义 `run / wait / resume / retry / escalate / terminate / replan` 七类控制动作的统一语义
- [x] 明确每类控制动作的作用范围是节点、步骤、路线还是整个 Mission
- [x] 梳理 `wait-resume`、`retry-escalate` 与 `replan` 的判定边界
- [x] 定义从正常执行转入等待、重试、升级、重规划的决策规则
- [x] 明确 Mission 六阶段中哪些阶段允许哪些控制动作生效

## 状态与证据

- [x] 定义编排层到 `Drive State` 的高层状态投影规则
- [x] 定义当前阶段、当前步骤、当前车队、当前接管、当前阻塞原因的统一投影口径
- [x] 定义 `OrchestrationEvent` 或等效事件结构以及关联键
- [x] 明确 replay 如何重建接管、重试、升级、重规划时间线
- [x] 明确 audit 如何记录权限、预算、风险接受与交付验收

## 接入与验证
- [x] 评估现有 Mission Runtime 事件流中需要新增或补齐的编排字段
- [x] 评估现有 workflow runtime 中 `WAITING_INPUT`、`resume()`、`retry / escalate / terminate` 的接入点
- [x] 评估 cockpit、task detail、replay、audit 对编排层投影的消费方式
- [x] 明确首轮落地采用服务端聚合、事件投影还是前端组合的实现路径
- [x] 补充围绕绑定、控制动作、状态投影、证据关联的测试清单

### 2026-04-25 审计备注（lane 6）

- `定义编排层与 Mission Runtime`、`workflow runtime`、`decision / approval`、`executor` 的关联接口路径`
  本轮已由 `design.md` 中的“编排层关联接口路径”章节直接收口：文档把任务级聚合读取、任务级控制写入、`workflow runtime` 原生控制、`approval / takeover` 桥接、`executor` 派发五类接口路径逐项展开，明确了接口路径、输入输出、字段来源、责任边界与首轮统一接口面。虽然当前实现仍以桥接路径和聚合投影为主，而不是独立 orchestration control surface，但这项设计定义本身已经完整覆盖，因此改为已勾选。

- `评估现有 Mission Runtime 事件流中需要新增或补齐的编排字段`
  本轮已由 `design.md` 中的“Mission Runtime 事件字段缺口清单”章节直接收口：文档先归纳当前已稳定可用的字段族，再拆分接口关联、事件语义、路线恢复、治理证据四类缺口，并逐项给出字段当前状态、推荐来源、推荐落点、用途与 `P0 / P1 / P2` 补齐优先级。与此同时，还补充了 `MissionRecord`、`MissionEvent / OrchestrationEvent`、`decision payload/history`、服务端 `projection`、前端 view model 的责任分层。因此本项改为已勾选。
