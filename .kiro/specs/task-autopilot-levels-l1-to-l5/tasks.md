# 任务清单：任务自动驾驶 L1-L5 分级

- [x] 补齐 `L1-L5` 的统一术语表，确保与 `task-autopilot-core-concepts` 中的 `Destination / Route / Drive State / Fleet / Takeover` 保持一致。
- [x] 在 steering 层补一份自动驾驶分级摘要，统一 README、项目总览、主线规划文档的等级口径。
- [x] 为 `L1` 定义“路线建议级”的最小产品行为，包括任务发起、路线推荐、用户确认与人工启动执行的边界。
- [x] 为 `L2` 定义“部分自动执行级”的最小产品行为，包括低风险自动推进与关键节点接管的边界。
- [x] 为 `L3` 定义“标准任务自动闭环级”的最小产品行为，包括标准任务范围、自动 review / revise、异常降级与交付策略。
- [x] 为 `L4` 定义“限定任务域高自动化级”的白名单约束模型，包括任务域白名单、权限白名单、预算白名单与策略版本。
- [x] 明确 `L5` 仅作为远期研究目标，统一禁止在 README、架构图、项目总览和产品文案中把当前能力写成 `L5` 已实现。
- [x] 设计任务级 `autopilotLevel` 与运行时 `effectiveAutopilotLevel` 的元数据模型，明确其在 `Mission`、`Workflow`、runtime context 中的挂载位置。
- [x] 设计自动驾驶等级与十阶段工作流阶段的映射表，明确每个阶段在 `L1-L4` 下允许的自动化动作范围。
- [x] 设计自动驾驶等级与 Web-AIGC 节点族 / route family 的映射表，至少覆盖导航节点、执行节点、治理节点三类。
- [x] 设计自动驾驶等级与 runtime governance 的对接方案，明确预算、权限、风险动作、外部副作用对等级降级或接管的触发条件。
- [x] 设计自动驾驶等级与 HITL / DecisionPanel 的对接方案，明确澄清、路线确认、风险审批、交付确认四类接管点。
- [x] 在驾驶舱信息架构中加入“目标等级 / 当前等级 / 降级原因 / 接管原因”的展示位置与展示语义。
- [x] 为 replay / audit / observability 设计等级证据字段，包括等级宣告、等级变更、接管原因、降级原因与交付确认信息。
- [x] 设计等级变更时间线，支持在回放与审计面板中查看任务从 `L3` 降级到 `L2` 等关键事件。
- [x] 为标准任务场景制定首批试点清单，明确哪些任务可以先按 `L2` 或 `L3` 推进，哪些任务必须停留在 `L1`。
- [x] 为高风险动作制定首批“必须接管”清单，至少覆盖外部写操作、向量删除、宿主打开动作、权限升级、成本越界等场景。
- [x] 补一份等级验收矩阵，按“任务类型 × 风险等级 × 自动驾驶等级 × 接管要求”统一验收口径。
- [x] 规划前后端实现顺序，先完成等级定义与展示，再推进 runtime metadata 与治理接线，最后扩展到白名单高自动化场景。

## 审计锚点补充（2026-04-24）

本轮已勾选项在 `design.md` 中的直接锚点如下：

- `L1-L5` 统一术语对应 `0. 与 task-autopilot-core-concepts 的统一术语锚点`。
- `L1-L4` 最小产品行为与 `L5` 远期目标对应 `分级策略设计` 各等级策略段，以及 `2.1 L1-L5 总览矩阵`。
- runtime governance / HITL 对接分别对应 `与 Mission Runtime 的映射`、`与 HITL / 接管链路的映射`、`与 Web-AIGC 节点 / adapter 的映射`。
- 驾驶舱展示对应 `驾驶舱展示设计`。
- 实现顺序对应 `分阶段落地与实现顺序`。

本轮补充了结构化矩阵与落地波次表，用来把已勾选任务从叙述性设计收敛为可核对的设计锚点；但仍未把未勾选项升级为已完成。

## 审计锚点补充（2026-04-25，Lane 3 二次收口）

本轮基于 `requirements.md`、`design.md` 与当前 `MissionAutopilotSummary` / route / takeover / recovery / evidence / governance 展示链路，新增安全可勾选项如下：

- `设计任务级 autopilotLevel 与运行时 effectiveAutopilotLevel 的元数据模型`
  - `design.md` 已新增 `4. 等级元数据模型`、`4.1 建议字段`、`4.2 建议挂载分层`、`4.3 当前可直接锚定的过渡合同`
  - 这里完成的是“设计任务”，不是宣称真实 runtime 字段已经落码
- `设计自动驾驶等级与十阶段工作流阶段的映射表`
  - `design.md` 已新增 `3.1 十阶段工作流 × 等级动作范围矩阵`
  - 已覆盖 `direction / planning / execution / review / meta_audit / revision / verify / summary / feedback / evolution`
- `设计自动驾驶等级与 Web-AIGC 节点族 / route family 的映射表`
  - `design.md` 已新增 `6.1 节点族 / route family × 等级边界矩阵` 与 `6.2 route.mode 的过渡语义`
  - 已覆盖导航节点、执行节点、治理节点三类，并明确 `route.mode` 只是过渡锚点
- `为 replay / audit / observability 设计等级证据字段`
  - `design.md` 已补齐 `审计与回放设计` 下的“当前可直接复用的证据与时间线锚点”
  - 已把 `evidence.timeline / correlation / route.evidence / takeover / recovery / recommendationDetails` 收敛为等级证据源
- `设计等级变更时间线`
  - `design.md` 已新增“等级时间线的建议事件模型”
  - 已定义 `level.declared / level.recommended / level.effective / level.degraded / level.recovered / level.delivered`
- `为标准任务场景制定首批试点清单`
  - `design.md` 已新增“首批试点清单”
  - 试点边界与 README / steering / runtime coverage 保持一致，没有把高风险副作用任务冒充为高等级已落地
- `为高风险动作制定首批必须接管清单`
  - `design.md` 已新增“强制接管与禁止绕过清单”
  - 已覆盖路线选择、预算审批、approval gate、外部写、高风险副作用、交付放行、恢复耗尽
- `补一份等级验收矩阵`
  - `design.md` 已新增“统一验收矩阵”
  - 已按“任务类型 × 风险等级 × 自动驾驶等级 × 接管要求”给出统一口径

本轮仍需明确的保守边界：

- 当前没有真实落地的 `declaredAutopilotLevel / effectiveAutopilotLevel` 代码字段；
- 当前没有专门的等级时间线 UI 或 `level.*` audit event；
- 因此本轮勾选的是设计收口，不是实现完成。
