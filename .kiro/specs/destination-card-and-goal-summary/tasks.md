# 任务清单：目的地卡片与目标摘要

- [x] 定义目的地卡片的统一字段结构，包括目标概述、成功标准、约束、预期交付物、置信度、缺失信息
- [x] 明确目标概述的摘要原则，区分结果目标与执行手段
- [x] 定义成功标准与约束的展示边界，避免混淆完成判定与执行限制
- [x] 定义预期交付物的展示口径，并与 workflow 输出和任务产物建立映射
- [x] 定义置信度的展示方式与解释规则，避免只有分值没有语义
- [x] 定义缺失信息的展示结构，包括缺失内容、影响范围与阻塞性
- [x] 明确目的地卡片与现有 `mission-first / workflow / runtime` 的兼容映射关系
- [x] 明确卡片字段的刷新规则，区分稳定字段与动态字段
- [x] 将本 spec 作为后续路线推荐、接管面板和驾驶舱主界面的输入约束

## 审计备注（2026-04-24）

- 当前主仓已经存在一张可直接消费的最小“目的地卡片”实现：`TaskAutopilotPanel` 中的 `Destination` 区块。
- 该区块当前稳定消费 `autopilotSummary.destination`，并按固定顺序展示：
  - 目标概述
  - 约束
  - 成功标准
  - 预期交付物
  - 缺失信息
- 因此本轮可以保守勾选 `定义成功标准与约束的展示边界`：
  - `client/src/components/tasks/TaskAutopilotPanel.tsx` 已把 `destination.constraints` 与 `destination.successCriteria` 分别渲染成独立前缀段落，而不是混成一段通用文案
  - `client/src/components/tasks/__tests__/TaskAutopilotPanel.test.tsx` 已覆盖 destination 区块对 `constraints / successCriteria / deliverables / missingInfo` 的消费
- `shared/mission/autopilot.ts`、`server/tasks/mission-projection.ts`、`client/src/lib/tasks-store.ts` 也已经形成最小字段链路，确保这些字段能从 shared builder 经由 server projection 和 client normalize 进入 UI。
- 本轮还可以保守补勾 `明确目标概述的摘要原则，区分结果目标与执行手段`：
  - `shared/mission/autopilot.ts` 已明确把 `destination.goal` 与 `destination.request` 分开生成，其中 `goal` 优先来自 `mission.title`，`request` 优先来自 `mission.sourceText / mission.summary`
  - `client/src/lib/tasks-store.ts` 已稳定 normalize 这两个字段，不会在 client 端把两者重新混成一个自由文本
  - `client/src/components/tasks/TaskAutopilotPanel.tsx` 已将 `destination.goal` 作为 Destination 区块主值，把 `destination.request` 仅在与主值不同的时候作为 detail 展示，形成“结果目标优先、执行请求次之”的最小摘要规则
  - `client/src/components/tasks/__tests__/TaskAutopilotPanel.test.tsx` 已覆盖 `goal` 与 `request` 同时存在时的 destination 区块渲染
- 本轮也可以保守补勾 `定义预期交付物的展示口径，并与 workflow 输出和任务产物建立映射`：
  - `shared/mission/autopilot.ts` 已通过 `buildDeliverables()` 从 mission artifacts 构建 `destination.deliverables`；
  - `server/tests/mission-routes.test.ts`、`client/src/lib/tasks-store.autopilot.test.ts` 已覆盖 projection / normalize 链路上的 destination 字段承接；
  - `TaskAutopilotPanel` 同时消费 `destination.deliverables` 与 `outputs.deliverables`，并在 `Destination` 区块中稳定展示 `Deliverables`，因此“最小交付物展示口径”已经成立。
- 当前仍不能保守勾选的项包括：
  - 含 `confidence` 在内的完整目的地卡片统一字段结构
  - 缺失信息的影响范围与阻塞性建模
  - 字段刷新规则
- 当前也仍不能保守勾选“将本 spec 作为后续路线推荐、接管面板和驾驶舱主界面的输入约束”：
  - 现有 destination 字段已经被 task detail 中的 autopilot panel 消费，但还没有看到其他相关界面以这个 spec 的字段契约作为直接输入，并配套测试闭环
- 原因是：现状的 `destination` 仍是 mission 派生摘要字段，尚未形成完整 `Destination` 卡片契约；尤其 `confidence` 目前主要出现在 `driveState`，不是 `destination` 的稳定字段。
- 同时，这里的“已勾选”只代表：
  - 已存在 `mission artifacts -> destination.deliverables -> projection/normalize -> panel` 的最小展示链；
  - 还不代表完整 workflow 输出 schema、交付格式治理或结果验收协议已经定义完成。

## 续审备注（2026-04-24，destination/card conservative 复核）

- 本轮继续只读复核当前工作树中的 destination/card 事实链，并重新跑通以下直接测试：
  - `shared/__tests__/mission-autopilot.test.ts`
  - `server/tests/mission-routes.test.ts`
  - `client/src/lib/tasks-store.autopilot.test.ts`
  - `client/src/components/tasks/__tests__/TaskAutopilotPanel.test.tsx`
- 复核后结论保持不变：本 spec 在当前 `4 / 9` 基础上，没有新增安全可勾选项。
- 这轮没有继续补勾 `定义目的地卡片的统一字段结构，包括目标概述、成功标准、约束、预期交付物、置信度、缺失信息`，原因是共享 `autopilotSummary.destination` 仍稳定停留在 `goal / request / constraints / successCriteria / deliverables / missingInfo` 这一组摘要字段，`confidence` 仍未作为 destination 卡片自己的稳定合同输出。
- 这轮没有继续补勾 `定义缺失信息的展示结构，包括缺失内容、影响范围与阻塞性`，原因是当前 `missingInfo` 仍是字符串列表；shared / server / client / panel 都还没有把“影响范围”“是否阻塞”做成结构化字段或展示规则。
- 这轮没有继续补勾 `明确卡片字段的刷新规则，区分稳定字段与动态字段`，原因是虽然 design 中已经写出刷新原则，但当前代码与测试只证明 destination 摘要可被投影和展示，还没有把字段级刷新语义、稳定/动态分层或 refresh/replan 联动做成直接契约与回归测试。
- 这轮也没有继续补勾 `将本 spec 作为后续路线推荐、接管面板和驾驶舱主界面的输入约束`，原因是当前可直接验证的 destination consumer 仍主要是 `TaskAutopilotPanel` 这条任务详情切片；还没有看到 route recommendation、takeover panel 与 cockpit 主骨架共同依赖 destination card 字段合同的直接代码与测试闭环。

## 再审备注（2026-04-24，confidence / missing-info detail 链路）

- 本轮继续复核后，本 spec 的安全结论仍然是 `4 / 9`，没有新增勾选。
- 新增确认到的事实是：
  - `shared/mission/autopilot.ts` 已实际生成 `destination.confidence` 与 `destination.missingInfoDetails`
  - `TaskAutopilotPanel` 已能直接消费 `destination.confidence.level` 与 `destination.missingInfoDetails`
  - `server/tasks/mission-projection.ts` 的 `/projection` 对 destination 子树只有透传，没有额外改写
- 但这仍不足以补勾 `置信度展示规则` 与 `缺失信息结构`，因为：
  - `client/src/lib/tasks-store.ts` 还没有稳定保留 `destination.confidence` 的对象结构
  - 同一层也还会把 `missingInfoDetails` 折叠为遗留兼容字段 `impact / blockingReason`
- 因此，这轮新增的是“shared/server/panel 已具备结构化字段基础”的审计结论，而不是新的 done task。

## 续补备注（2026-04-24，structured missing-info detail 闭环）

- 本轮可以保守新增勾选 `定义缺失信息的展示结构，包括缺失内容、影响范围与阻塞性`，因为这条链路已经具备直接代码与测试闭环：
  - `shared/mission/autopilot.ts` 已产出 `destination.missingInfoDetails[*].item / impact / blocking`
  - `server/tests/mission-routes.test.ts` 已直接断言 `/projection` 返回 `destination.confidence` 与 `destination.missingInfoDetails`
  - `client/src/lib/tasks-store.ts` 现已在 normalize 时稳定保留 `destination.missingInfoDetails`，并把结构化 `item` 回填进 `destination.missingInfo`
  - `client/src/lib/tasks-store.autopilot.test.ts` 已覆盖“只有 structured missingInfoDetails、没有 flat missingInfo”时的 normalize 行为
  - `client/src/components/tasks/TaskAutopilotPanel.tsx` 已在无扁平 `impact / blockingReason` 时，优先使用 `missingInfoDetails[*].impact` 展示 impact
  - `client/src/components/tasks/__tests__/TaskAutopilotPanel.test.tsx` 已覆盖 item / impact / blocking 的直接展示
- 这里的勾选仍需保守限定：
  - 当前闭环针对的是 destination card 所消费的最小结构化缺口字段
  - 还不代表已经存在完整的 clarification policy、缺口分类器、或更上游 `Destination parser` 的系统化缺失信息建模
- 因此本轮只新增这一项，不外推到 `定义目的地卡片的统一字段结构` 或 `定义置信度的展示方式与解释规则`。

## 续审补注（2026-04-25，统一字段结构复核）

- 本轮继续复核后，可以保守新增勾选 `定义目的地卡片的统一字段结构，包括目标概述、成功标准、约束、预期交付物、置信度、缺失信息`。
- 依据是当前主仓已经具备一条带直接测试锚点的结构化字段闭环，而不再只是散落的摘要字符串：
  - `shared/mission/autopilot.ts` 已在 `MissionAutopilotDestinationSummary` 中稳定定义并构建：
    - `goal`
    - `request`
    - `constraints`
    - `successCriteria`
    - `deliverables`
    - `missingInfo`
    - `confidence`
    - `missingInfoDetails`
  - `shared/__tests__/mission-autopilot.test.ts` 已直接断言 active / waiting / blocked 场景下的 `destination.confidence` 与 `destination.missingInfoDetails`
  - `server/tests/mission-routes.test.ts` 已直接断言 `/projection` 返回 `destination.confidence` 与 `destination.missingInfoDetails`
  - `client/src/lib/tasks-store.ts` 现已保留 `destination.confidence` 的对象结构，并稳定承接 `missingInfoDetails`
  - `client/src/lib/tasks-store.autopilot.test.ts` 已覆盖 `confidence`、`missingInfoDetails` 以及由结构化 detail 回填 `missingInfo` 的 normalize 行为
  - `client/src/components/tasks/TaskAutopilotPanel.tsx` 已直接消费：
    - `goal / request`
    - `constraints / successCriteria / deliverables`
    - `confidence.level`
    - `missingInfoDetails[*].item / impact / blocking`
  - `client/src/components/tasks/__tests__/TaskAutopilotPanel.test.tsx` 已覆盖 confidence 展示与 structured missing-info detail 展示
- 这里的勾选仍需保守限定：
  - 当前完成的是“目的地卡片可消费的统一字段结构”
  - 不是更上游独立 `Destination` 实体、parser、或跨更多产品面的强约束 schema
- 因此本轮只补勾“统一字段结构”，仍不补勾：
  - `定义置信度的展示方式与解释规则，避免只有分值没有语义`
  - `明确卡片字段的刷新规则，区分稳定字段与动态字段`
  - `将本 spec 作为后续路线推荐、接管面板和驾驶舱主界面的输入约束`

## 续审补注（2026-04-25，lane 1 confidence / refresh / cockpit 复核）

- 本轮按 lane 1 约束，只读复核并重新跑通以下实现/测试锚点：
  - `shared/mission/autopilot.ts`
  - `server/tasks/mission-projection.ts`
  - `client/src/lib/tasks-store.ts`
  - `client/src/components/tasks/TaskAutopilotPanel.tsx`
  - `shared/__tests__/mission-autopilot.test.ts`
  - `server/tests/mission-routes.test.ts`
  - `client/src/lib/tasks-store.autopilot.test.ts`
  - `client/src/components/tasks/__tests__/TaskAutopilotPanel.test.tsx`
- 定向复跑结果保持通过；在这一轮 lane 复核时点，本 spec 的阶段状态仍是 `6 / 9`。随后基于本文末新增的 confidence UI 闭环审计，当前状态已推进到 `7 / 9`。
- 这轮重点复核后，`定义置信度的展示方式与解释规则，避免只有分值没有语义` 仍不能补勾：
  - `shared/mission/autopilot.ts` 已稳定产出 `destination.confidence.level / reason / signals`
  - `server/tests/mission-routes.test.ts`、`client/src/lib/tasks-store.autopilot.test.ts` 已直接断言 `reason / signals` 经 projection 与 normalize 保留下来
  - `client/src/lib/tasks-store.ts` 现在也确实保留了 `destination.confidence` 的对象结构
  - 但 `client/src/components/tasks/TaskAutopilotPanel.tsx` 的 `parseDestination()` 当前只直接读取并展示 `destination.confidence.level`，没有把 `destination.confidence.reason / signals` 做成 destination 区块的稳定展示合同
  - `client/src/components/tasks/__tests__/TaskAutopilotPanel.test.tsx` 当前也只覆盖了 `Confidence: Medium` 这一类 level 展示，而没有覆盖“reason 如何解释”“signals 如何展示”的 UI 语义
- `明确卡片字段的刷新规则，区分稳定字段与动态字段` 这轮也仍不能补勾：
  - 现有代码与测试已经把 `route.replan`、`route.selectionStatus`、`explanation.remainingSteps.replanChangeSummary` 做成了 shared -> server -> client -> panel 的闭环
  - 但这组证据证明的是路线/恢复语义，而不是 destination 字段自身的刷新合同
  - 当前还没有直接代码与回归测试去约束：
    - `goal` 仅在目标重解析或用户明确修改时变化
    - `constraints / successCriteria` 在澄清后如何补齐
    - `deliverables` 如何随路线收敛而细化
    - `missingInfo` 如何在补充输入后关闭
  - `client/src/lib/tasks-store.ts` 的 `refresh()` 与 shared/server projection 现状更接近“整棵 summary 重新归一化”，而不是字段级稳定/动态分层合同
- `将本 spec 作为后续路线推荐、接管面板和驾驶舱主界面的输入约束` 仍不补勾，但这轮新增了一条更精确的审计边界：
  - 已有直接代码证据表明 `TaskAutopilotPanel` 已接入 `TaskDetailView`
  - `TaskDetailView` 同时存在默认视图与 `variant="cockpit"` 视图
  - `client/src/components/tasks/__tests__/TaskAutopilotPanel.test.tsx` 已覆盖 `TaskDetailView` 中 autopilot panel 的接线
  - 这说明 destination/autopilot summary 已进入 task detail 与 cockpit detail 这条复用链
  - 但它仍然是“同一个 autopilot panel 被复用”，不是 route recommendation、独立 takeover panel、或 cockpit 主骨架中的多个下游模块分别把这份 destination card 字段合同当作稳定输入
  - 当前还缺少“其他 consumer 直接依赖 destination card contract 且有配套测试”的证据闭环，因此不能把这条 spec 外推为更广泛的输入约束

## 续审补注（2026-04-25，destination summary / success signal / constraint summary 复核）

- 本轮按 lane 限定，只复核以下直接证据链，不扩展到其他未指定文件：
  - `client/src/components/tasks/TaskDetailView.tsx`
  - `client/src/components/tasks/TaskAutopilotPanel.tsx`
  - `client/src/components/tasks/__tests__/TaskAutopilotPanel.test.tsx`
  - `client/src/lib/tasks-store.ts`
  - `client/src/lib/tasks-store.autopilot.test.ts`
  - `shared/mission/api.ts`
  - `shared/mission/index.ts`
  - `server/tasks/mission-projection.ts`
  - `server/tests/mission-routes.test.ts`
- 复核结论保持收敛：在这一轮 lane 限定复核时点，本轮不新增勾选，阶段状态仍为 `6 / 9`；随后已在本文末基于 confidence UI 闭环补勾到 `7 / 9`。
- `destination summary` 这条链路的最小闭环已经成立，但边界也需要写得更准：
  - `server/tasks/mission-projection.ts` 通过 `buildMissionAutopilotSummary()` 为 projection 产出 `destination.goal / request / constraints / successCriteria / deliverables / confidence / missingInfo / missingInfoDetails`
  - `client/src/lib/tasks-store.ts` 会在 normalize 时保留上述 destination 结构，并继续保留 `confidence`、`missingInfoDetails`、`impact`、`blockingReason`
  - `client/src/components/tasks/TaskAutopilotPanel.tsx` 的 `parseDestination()` 已按“`goal` 优先、`request` 作为 detail、其他字段按摘要段落拼接”的方式消费 destination block
  - `client/src/lib/tasks-store.autopilot.test.ts`、`server/tests/mission-routes.test.ts`、`client/src/components/tasks/__tests__/TaskAutopilotPanel.test.tsx` 已覆盖 goal / confidence / constraints / deliverables / missingInfo 的直接断言
  - 但目前还缺少一条更直接的 UI 回归去锁定“当 `request !== goal` 时，request 以 destination detail 语义稳定展示”，所以这条完成项仍应理解为“结果目标优先的最小 contract 已成立”，而不是更完整的 destination summary 组件规范已经封板
- `success signal` 当前仍有明确欠缺，虽然不影响已完成项的最小闭环判断：
  - `server/tests/mission-routes.test.ts` 与 `client/src/lib/tasks-store.autopilot.test.ts` 已证明 `destination.successCriteria` 会经 projection / normalize 保留下来
  - `client/src/components/tasks/TaskAutopilotPanel.tsx` 也已把 `destination.successCriteria` 独立拼入 `Success` 段
  - 但 `client/src/components/tasks/__tests__/TaskAutopilotPanel.test.tsx` 当前还没有直接断言 `Success` 段的最终文案与展示位置
  - 因此现状更接近“successCriteria 字段与最小展示实现已存在”，还不是“success signal 的展示语义、验收口径、解释方式都已有完整 UI 回归”
- `constraint summary` 的最小展示闭环成立，但仍停留在摘要层：
  - `server/tests/mission-routes.test.ts` 已直接断言 `destination.constraints`
  - `client/src/lib/tasks-store.autopilot.test.ts` 已断言 normalize 不会丢掉 constraints
  - `client/src/components/tasks/__tests__/TaskAutopilotPanel.test.tsx` 已直接断言 `Constraints: ...` 文案出现在 destination 区块
  - 但当前 constraint summary 仍主要是平铺字符串列表，尚未做成预算 / 权限 / 风格 / 合规等结构化分类，也还没有与 route recommendation / takeover consumer 形成同一份 contract 的跨模块测试闭环
- 因此，本轮继续保持不补勾：
  - `定义置信度的展示方式与解释规则，避免只有分值没有语义`
    - 原因：当前 panel 仍只稳定展示 `confidence.level`，未把 `reason / signals` 做成 destination 区块的稳定 UI 合同，也没有对应 UI 断言
  - `明确卡片字段的刷新规则，区分稳定字段与动态字段`
    - 原因：现有测试覆盖的是 projection / normalize / panel 渲染闭环，而不是 `goal / constraints / successCriteria / deliverables / missingInfo` 各字段的刷新时机合同
  - `将本 spec 作为后续路线推荐、接管面板和驾驶舱主界面的输入约束`
    - 原因：当前有直接证据的 consumer 仍主要是 `TaskAutopilotPanel` 与 `TaskDetailView`，还没有 route recommendation / 独立 takeover panel / cockpit 主骨架其他模块直接复用同一份 destination card contract 的测试闭环

## 续审补注（2026-04-25，lane 定向复跑确认）

- 本轮按 lane 限定重新核对并复跑了这组直接证据：
  - `npx vitest run client/src/lib/tasks-store.autopilot.test.ts client/src/components/tasks/__tests__/TaskAutopilotPanel.test.tsx`
  - `npx vitest run --config vitest.config.server.ts shared/__tests__/mission-autopilot.test.ts server/tests/mission-routes.test.ts`
- 复跑结果通过：
  - client 侧 `27` 个测试通过
  - shared / server 侧 `23` 个测试通过
- 复跑后结论保持收紧：在这一轮定向复跑时点，本 spec 仍安全维持 `6 / 9`；随后已在本文末基于 confidence UI 闭环补勾到 `7 / 9`。
- `定义置信度的展示方式与解释规则，避免只有分值没有语义` 仍不能补勾，原因在于这条链路虽然已经具备 shared -> server -> client store 的结构化字段闭环，但 UI 合同仍停在 level 层：
  - `shared/mission/autopilot.ts` 会产出 `destination.confidence.level / reason / signals`
  - `shared/__tests__/mission-autopilot.test.ts` 与 `server/tests/mission-routes.test.ts` 已直接断言 `reason / signals`
  - `client/src/lib/tasks-store.ts` 与 `client/src/lib/tasks-store.autopilot.test.ts` 已确认 normalize 后仍保留 `reason / signals`
  - 但 `client/src/components/tasks/TaskAutopilotPanel.tsx` 的 `parseDestination()` 当前只稳定拼出 `Confidence: <level>`
  - `client/src/components/tasks/__tests__/TaskAutopilotPanel.test.tsx` 当前也只断言了 level 展示，没有断言 `reason / signals` 的最终 UI 语义
- `明确卡片字段的刷新规则，区分稳定字段与动态字段` 仍不能补勾，原因在于现有证据证明的是“summary 会被重新投影和归一化”，而不是“字段级刷新合同已经落成”：
  - `client/src/lib/tasks-store.ts` 的 `refresh()` 现状是重新 hydrate / normalize summary
  - 本轮复跑的测试也主要覆盖 projection / normalize / panel 渲染稳定性
  - 仍缺少直接代码加回归测试去约束 `goal / constraints / successCriteria / deliverables / missingInfo` 在澄清、重解析、replan、补充输入后的各自刷新时机
- `将本 spec 作为后续路线推荐、接管面板和驾驶舱主界面的输入约束` 仍不能补勾，原因在于当前已验证的是“同一个 autopilot panel 被 task detail 与 cockpit detail 复用”，不是“多个独立 consumer 共同依赖 destination card contract”：
  - `client/src/components/tasks/TaskDetailView.tsx` 已在默认视图和 `variant="cockpit"` 视图接入 `TaskAutopilotPanel`
  - `client/src/components/tasks/__tests__/TaskAutopilotPanel.test.tsx` 已覆盖 `TaskDetailView` 中的接线
  - 但还没有 route recommendation、独立 takeover panel、或 cockpit 其他子模块直接消费 destination card 字段合同并配套测试的证据闭环
- 本轮也顺带确认一条需要继续保守描述的边界：
  - `goal` 与 `request` 的分离、以及“结果目标优先”的消费策略已经存在
  - 但当前 UI 测试仍缺少一条更直接的断言，专门锁定 `request !== goal` 时 request 作为 destination detail 的稳定展示语义
  - 因此这里仍只应表述为“最小 destination summary contract 成立”，不应外推成更完整的 destination summary 组件规范已封板

## 续审补注（2026-04-25，confidence 展示闭环落地）

- 以下结论覆盖上文同日更早、基于旧 UI 状态给出的“confidence explanation 仍未完成”判断。
- 基于本轮新落地的 destination UI 改动，这条 spec 现在可以保守补勾 `定义置信度的展示方式与解释规则，避免只有分值没有语义`。
- 直接代码锚点已经成立：
  - `client/src/components/tasks/TaskAutopilotPanel.tsx` 的 `parseDestination()` 现在不再只展示 `destination.confidence.level`，而是同时消费并展示：
    - `destination.confidence.level`
    - `destination.confidence.reason`
    - `destination.confidence.signals`
  - 其中 `reason` 被拼为 `Reason:` 段，`signals` 被拼为 `Signals:` 段，进入 destination 区块的稳定 detail 合同。
- 直接测试锚点也已经成立：
  - `client/src/components/tasks/__tests__/TaskAutopilotPanel.test.tsx` 现已把 destination confidence 用结构化对象输入，并直接断言：
    - `Confidence: Medium`
    - `Reason: ...`
    - `Signals: owner-confirmation:pending; external-write:human-gated`
- 因此，这次补勾针对的是“destination card 已经把置信度做成有语义解释的展示规则”这一层最小闭环，而不再停留在只有 level 的状态。
- 这次补勾不外推到其余未完成项：
  - 不代表 `destination` 字段刷新规则已经落成；
  - 不代表 route recommendation / takeover / cockpit 其他模块都已把这份 destination card contract 作为统一输入；
  - 也不代表更上游的 destination parser / clarification policy 已经全部完成。

## 续审补注（2026-04-25，refresh contract / downstream consumer contract 收口）

- 本轮基于 `design.md` 的新增设计合同，可以保守补勾以下两项：
  - `明确卡片字段的刷新规则，区分稳定字段与动态字段`
  - `将本 spec 作为后续路线推荐、接管面板和驾驶舱主界面的输入约束`

- 补勾 `明确卡片字段的刷新规则，区分稳定字段与动态字段` 的直接依据是：
  - `design.md` 已新增 `字段层级与来源优先级`
  - `design.md` 已新增 `刷新触发矩阵`
  - `design.md` 已新增 `字段冻结与重算边界`
  - `design.md` 已新增 `局部刷新与整卡重算`
- 这几段已经把本 spec 需要承担的设计责任写成显式合同，而不再只是原则性描述：
  - `goal / request` 被定义为稳定锚点字段
  - `successCriteria / constraints` 被定义为稳定补齐字段
  - `deliverables` 被定义为路线联动细化字段
  - `confidence / missingInfo / missingInfoDetails` 被定义为动态评估字段
  - 并明确了 `MissionInitialized / ClarificationAnswered / GovernanceChanged / RouteSelectionCommitted / ReplanCommitted / ExecutionCheckpointUpdated / DestinationRedefined` 等事件对字段刷新的允许边界

- 补勾 `将本 spec 作为后续路线推荐、接管面板和驾驶舱主界面的输入约束` 的直接依据是：
  - `design.md` 已新增 `统一输入口径`
  - `design.md` 已新增 `Route Recommendation 合同`
  - `design.md` 已新增 `Takeover Panel 合同`
  - `design.md` 已新增 `Cockpit Main View 合同`
  - `design.md` 已新增 `下游回写边界`
- 这意味着本 spec 现在已经明确规定了后续 specs 应如何消费目的地卡片：
  - 统一使用 canonical `autopilotSummary.destination`
  - 统一使用相同的来源优先级与 fallback 顺序
  - 统一遵守 proposal / decision / answer 先回流、再经 refresh / replan 重算 summary 的边界
  - 禁止各下游模块自行维护冲突的目标摘要

- 这次补勾仍需保守限定：
  - 勾选的是“本 spec 作为设计合同已经补齐”
  - 不是“路线推荐、接管面板、驾驶舱主界面都已经在代码层完整实现并通过端到端测试”
  - 后续各 consumer 的真实实现进度，仍需在各自 spec 与代码审计中单独确认
