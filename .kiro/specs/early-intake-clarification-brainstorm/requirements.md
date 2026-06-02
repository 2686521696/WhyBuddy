# Requirements Document

## Introduction

本 spec 定义 `early-intake-clarification-brainstorm` 能力：在用户输入需求和澄清阶段启动完整的多智能体早期会话，让系统先协同理解需求、识别风险、生成高价值澄清问题，并把会话过程通过现有 Socket.IO relay 与 3D blueprint 场景可视化出来。

现有 `brainstorm-pipeline-hookup` 已把 brainstorm 接入 `route_generation`、`spec_tree`、`spec_docs`、`effect_preview`、`prompt_packaging`、`engineering_handoff` 等后续产物阶段，但尚未覆盖 `input` 与 `clarification`。本 spec 将 early brainstorm 作为独立早期控制层，不改变后续 6 阶段 wrapper 的边界。

## Glossary

- **Early_Brainstorm_Session**: 在 input / clarification 阶段启动的多智能体会话，用于需求理解、风险识别、澄清问题生成与充分性判断。
- **Intake_Decision_Gate**: 早期决策门，判断用户输入是否可以进入 route generation，或是否需要澄清/收缩范围/补充上下文。
- **Clarification_Brainstorm**: 多角色协同生成澄清问题的流程。
- **Sufficiency_Check**: 用户回答澄清问题后，判断信息是否足够进入 `route_generation` 的检查。
- **Early_Brainstorm_Artifact**: 持久化早期会话结论的 artifact，包含 understanding summary、assumptions、open questions、risk notes 与 next action。
- **Brainstorm_Wall_Graph**: 3D 场景中用于展示 brainstorm 节点、边、角色与 synthesis 状态的可视化图谱。
- **Single_Flow_Fallback**: early brainstorm 关闭或失败时回退到现有 input / clarification 行为。

## Requirements

### Requirement 1: Early Brainstorm Environment Gates

**User Story:** As a platform engineer, I want early brainstorm to be independently gated, so that input / clarification multi-agent behavior can be rolled out without changing existing generation behavior.

#### Acceptance Criteria

1. THE system SHALL support `BLUEPRINT_EARLY_BRAINSTORM_ENABLED` as a master switch for early-stage brainstorm.
2. THE system SHALL support `BLUEPRINT_EARLY_BRAINSTORM_INPUT_ENABLED` for input-stage early sessions.
3. THE system SHALL support `BLUEPRINT_EARLY_BRAINSTORM_CLARIFICATION_ENABLED` for clarification-stage sessions.
4. WHEN `BUILD_TARGET === "test"`, THE early brainstorm context SHALL be disabled by default unless a test explicitly injects it.
5. WHEN early brainstorm is disabled, THE current input / clarification / route_generation behavior SHALL remain unchanged.

### Requirement 2: Input Decision Gate

**User Story:** As a user, I want the system to understand whether my initial request is clear enough, so that it asks useful questions instead of generating an incorrect plan.

#### Acceptance Criteria

1. WHEN a user submits an intake request and input early brainstorm is enabled, THE system SHALL run an `Intake_Decision_Gate` before `route_generation`.
2. THE gate SHALL produce one of: `proceed_to_route_generation`, `ask_clarification`, `narrow_scope`, or `fetch_context`.
3. THE gate SHALL include a short `reason` explaining the selected action.
4. THE gate SHALL include `missingInformation` entries when clarification is needed.
5. IF the gate fails, THE system SHALL fall back to the existing input flow without blocking job creation.

### Requirement 3: Complete Early Multi-Agent Session

**User Story:** As a user, I want several specialized agents to inspect my request before the system asks questions, so that the questions are fewer, clearer, and more useful.

#### Acceptance Criteria

1. WHEN the gate selects `ask_clarification` or `narrow_scope`, THE system SHALL start an `Early_Brainstorm_Session`.
2. THE session SHALL include at least these roles: `product_strategist`, `system_architect`, `risk_auditor`, `delivery_planner`, and `ux_interviewer`.
3. EACH role SHALL produce a structured note containing `summary`, `concerns`, `questions`, and `confidence`.
4. THE session SHALL emit `brainstorm.session.started`, `brainstorm.node.created`, `brainstorm.node.updated`, and `brainstorm.session.completed` events through the existing event bus.
5. THE session SHALL be time bounded and SHALL degrade to existing clarification behavior if it exceeds the configured timeout.

### Requirement 4: Clarification Question Synthesis

**User Story:** As a user, I want the system to ask only the highest-value questions, so that the clarification phase helps instead of becoming a questionnaire.

#### Acceptance Criteria

1. THE early synthesizer SHALL merge role outputs into a deduplicated `openQuestions` list.
2. EACH question SHALL include `id`, `question`, `reason`, `priority`, `impactStage`, and optional `defaultAssumption`.
3. THE system SHALL cap high-priority user-facing questions to a configurable maximum, defaulting to 5.
4. THE synthesizer SHALL preserve lower-priority questions internally as assumptions or risk notes rather than showing all of them to the user.
5. IF no user-facing question is required, THE result SHALL set `recommendedNextAction` to `proceed_to_route_generation`.

### Requirement 5: Sufficiency Check After Answers

**User Story:** As a user, I want the system to know when my answers are enough, so that it does not keep asking questions unnecessarily.

#### Acceptance Criteria

1. WHEN clarification answers are submitted, THE system SHALL run a sufficiency check if clarification early brainstorm is enabled.
2. THE check SHALL evaluate original intake, generated questions, user answers, assumptions, and risk notes.
3. THE check SHALL return `sufficient`, `needs_followup`, or `narrow_scope_required`.
4. WHEN sufficient, THE system SHALL persist an early brainstorm context package for downstream route generation.
5. WHEN follow-up is needed, THE system SHALL ask only the smallest necessary set of follow-up questions.

### Requirement 6: Early Brainstorm Artifact

**User Story:** As a platform engineer, I want early reasoning artifacts persisted, so that downstream stages can reuse the understanding instead of re-inferring user intent.

#### Acceptance Criteria

1. THE system SHALL persist an `early_brainstorm` artifact when a session completes.
2. THE artifact SHALL include `sessionId`, `stage`, `understandingSummary`, `assumptions`, `openQuestions`, `answeredQuestions`, `riskNotes`, and `recommendedNextAction`.
3. THE artifact SHALL be attached to the blueprint job or intake record without replacing existing artifacts.
4. THE route_generation stage SHALL receive the latest early brainstorm understanding as context when available.
5. THE artifact SHALL be retrievable through a replay endpoint.

### Requirement 7: 3D Brainstorm Wall Graph Integration

**User Story:** As a user, I want to see the agents collaborate in the 3D blueprint scene, so that early reasoning is visible rather than hidden behind a loading spinner.

#### Acceptance Criteria

1. THE `BrainstormWallGraphConnected` component SHALL be mounted in the active blueprint 3D scene when an early brainstorm session is active or completed.
2. THE graph SHALL render session nodes, parent-child edges, role labels, node statuses, and synthesis state.
3. THE graph SHALL not render when `sessionStatus === "idle"`.
4. THE graph SHALL not overlap incoherently with existing runtime agents, floor markers, or stage UI.
5. THE graph SHALL be visible in the default input / clarification flow without requiring a hidden debug toggle.

### Requirement 8: Frontend Event Store Wiring

**User Story:** As a frontend engineer, I want brainstorm socket events to update the graph store, so that the 3D graph reflects live backend progress.

#### Acceptance Criteria

1. THE frontend SHALL subscribe to relayed `brainstorm.*` events from the existing blueprint realtime store or socket relay.
2. `brainstorm.session.started` SHALL reset and initialize the brainstorm graph store.
3. `brainstorm.node.created` SHALL add a node and optional edge.
4. `brainstorm.node.updated` SHALL update node status/content/confidence.
5. `brainstorm.session.completed` and `brainstorm.degraded` SHALL transition the graph to a terminal or degraded state.
6. Event handling SHALL be idempotent and SHALL tolerate duplicate or out-of-order events.

### Requirement 9: Clarification UI Integration

**User Story:** As a user, I want synthesized clarification questions shown in the normal workflow, so that I can answer them without leaving the blueprint page.

#### Acceptance Criteria

1. THE clarification UI SHALL show early brainstorm generated questions when available.
2. EACH question SHALL expose its user-facing text and may show a concise reason or impact stage.
3. THE UI SHALL allow the user to accept a default assumption when provided.
4. THE UI SHALL submit answers through the existing clarification answer path or an explicitly documented compatible endpoint.
5. THE UI SHALL show fallback clarification questions if early brainstorm degrades.

### Requirement 10: Backward Compatibility and Degradation

**User Story:** As a QA engineer, I want the current flow to remain reliable, so that early brainstorm never blocks blueprint generation.

#### Acceptance Criteria

1. WHEN early brainstorm is disabled, existing input and clarification behavior SHALL be identical.
2. IF any early brainstorm component fails, THE system SHALL emit `brainstorm.degraded` and continue through the existing single-flow fallback.
3. IF the 3D graph fails to render, THE page SHALL remain usable and clarification questions SHALL still be accessible.
4. Existing tests unrelated to early brainstorm SHALL not require updates.
5. New tests SHALL cover enabled, disabled, degraded, and replay scenarios.

