# Requirements Document: Skill-aware Agent Sandbox

## Introduction

强镜像可以让 Docker 容器具备常用工具，但长期看不能把所有能力都塞进一个镜像。本 spec 定义 Skill-aware Agent Sandbox：技能以 manifest 描述能力、入口、依赖和产物规则；route planner 可以按 capability 选择 skill；executor 将 skill 注入或挂载到容器执行；日志与产物回流到 mission/project。

本 spec 是 Docker V2 的 P2 阶段，依赖能力契约、强镜像和浏览器 artifact 闭环。

## Requirements

### Requirement 1: Skill Manifest

**User Story:** 作为平台开发者，我需要用 manifest 描述一个 skill 会什么、怎么运行、会产出什么。

#### Acceptance Criteria

1. THE repository SHALL define a skill manifest schema.
2. THE manifest SHALL include name, version, capabilities, entrypoint, runtime, dependencies, inputs, outputs, artifact rules, and security hints.
3. THE manifest SHALL validate capability names against the executor capability vocabulary.
4. Invalid manifests SHALL fail validation with clear errors.

### Requirement 2: Skill Registry

**User Story:** 作为调度系统，我需要查询可用 skills，以便为任务选择合适能力。

#### Acceptance Criteria

1. THE server SHALL load local skill manifests from a configured directory.
2. THE registry SHALL expose skill list, detail, and capability index.
3. THE registry SHALL support disabled or incompatible skills.
4. THE registry SHALL not execute skill code during discovery.

### Requirement 3: Skill Injection into Sandbox

**User Story:** 作为 executor，我需要把选中的 skill 放进容器并运行它。

#### Acceptance Criteria

1. THE job payload SHALL be able to reference a skill by name and version.
2. THE executor SHALL mount or copy skill files into a controlled container path.
3. THE executor SHALL run the skill entrypoint with structured input.
4. THE executor SHALL collect skill outputs and artifacts.

### Requirement 4: Planner Capability Matching

**User Story:** 作为自动驾驶系统，我需要按任务意图和 required capabilities 选择 skill。

#### Acceptance Criteria

1. THE planner SHALL be able to map required capabilities to candidate skills.
2. IF multiple skills match, THE planner SHALL rank by capability coverage and safety.
3. IF no skill matches, THE mission SHALL surface a clear missing-skill reason.
4. Manual override SHALL be possible in advanced mode.

### Requirement 5: Skill Governance

**User Story:** 作为系统管理员，我需要限制 skill 权限，避免任意代码变成安全风险。

#### Acceptance Criteria

1. Skill manifests SHALL declare filesystem, network, browser, and credential needs.
2. Executor SHALL compare skill security hints with job security level.
3. Unsafe or overprivileged skills SHALL be rejected unless explicitly allowed.
4. Skill execution logs SHALL include skill name and version for audit.

