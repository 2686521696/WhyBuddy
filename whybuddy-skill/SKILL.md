---
name: whybuddy-closed-loop
description: Turn a user idea into a closed-loop, reviewable WhyBuddy spec package. It normalizes inputs, clarifies gaps, compares routes, decides solo vs multi-agent collaboration, generates a SPEC tree that is validated by RUNNING a bundled deterministic script (not by eyeballing), derives requirements/design/tasks documents, prepares preview/handoff artifacts, and manages review, invalidation, and replan budgets with deterministic fallbacks. Use this when you want the full WhyBuddy loop — from a vague idea to a validated, buildable, reviewable spec — not a single-step answer.
---

# WhyBuddy Skill（闭环 · 修订版）

把一句话想法压成一条可回放、可回炉、可交付的闭环。本 skill 承载 **方法、规则、产物约定，以及由脚本强制执行的确定性校验**。

> **运行时不在本 skill 内。** 事件总线、Socket 推送、状态仓、回放 UI、工作台、3D 墙、容器编排属于宿主系统，其设计见 `docs/architecture.mmd` 与宿主自己的设计文档；本文件**不规定它们的接口**。本 skill 只产出结构化对象与文档，怎么存、怎么推、怎么显示由宿主决定。

## 适用场景

- 用户给出一句话目标，希望从想法走到规格、预览与交付。
- 需求存在歧义，需要先澄清、再选路线，而不是直接执行。
- 任务可能简单也可能复杂，需要在单 Agent 与多角色协作之间切换。
- 需要把"失败、回炉、失效、重算"纳入流程，而不是只画主链路。

## 不适用场景

- 单次问答、单文件改字、单步脚本执行。
- 不需要规格树、不需要评审闭环的极小任务。
- 仅涉及宿主运行时改造、不需要 WhyBuddy 方法论产物的工作。

## Skill 边界

- **Skill 内**：输入归一化、澄清、路线规划、模式决策、规格树生成、文档派生、预览/交付产物约定、评审与重规划规则、**确定性校验脚本的调用**。
- **Skill 外**：一切运行时与基础设施（Job Store、Event Bus、Socket、Realtime Store、回放 UI、工作台、3D 墙、容器编排、权限托管）。

## 输入契约

- 必填：用户想法或目标描述。
- 可选：GitHub 仓库链接、代码文件路径或目录片段、截图/日志/背景、用户约束/预算/成功标准。

## 输出契约

- `project_context`、`clarified_brief`、`route_options` 与 `selected_route`、`decision_mode`
- `spec_tree.json`（结构见下方 **规格树 Schema**，是生成器与校验器的唯一契约）
- `requirements.md`、`design.md`、`tasks.md`（章节见下方 **文档章节契约**）
- `prompt_pack.md`、`effect_preview.md`、`handoff_manifest.json`、`review_result`

## 规格树 Schema（生成器与校验器的唯一契约）

`spec_tree.json` **必须**长这样，`scripts/validate_spec_tree.py` 按此校验：

```json
{
  "rootNodeId": "n0",
  "version": 1,
  "nodes": [
    { "id": "n0", "parentId": null, "type": "requirement", "title": "顶层目标", "acceptance": "可验收的成功标准" },
    { "id": "n1", "parentId": "n0",  "type": "design",      "title": "...", "notes": "..." },
    { "id": "n2", "parentId": "n1",  "type": "task",        "title": "...", "verify": "..." },
    { "id": "n3", "parentId": "n0",  "type": "evidence",    "title": "...", "source": "..." }
  ],
  "provenance": {
    "generationSource": "llm",
    "promptId": "...",
    "model": "...",
    "fingerprint": "..."
  }
}
```

硬约束（校验器会逐条查）：

- 节点数 3–50；`id` 唯一且非空；唯一根（`parentId` 为 `null`），且根 `type` 必须是 `requirement`。
- `type` 只能是 `requirement` / `design` / `task` / `evidence`；每个非根节点的 `parentId` 必须指向存在的节点；无环；深度 ≤ 4。
- **`generationSource` 必须放在 `provenance` 对象里（不是顶层），取值只能是 `llm` / `llm_fallback` / `template`。**
- **必须如实填写来源**：LLM 正常产出填 `llm`；兜底脚本产出填 `template`。**禁止给 LLM 内容手写 `template` 蒙混**——这正是校验存在的意义。

## 文档章节契约

文档生成器与 `scripts/check_content_quality.py` 共用这套标题，必须一致：

- `requirements.md`：`## 目标`、`## 范围`、`## 功能要求`、`## 验收标准`
- `design.md`：`## 设计目标`、`## 模块划分`、`## 失败处理策略`、`## 质量控制`
- `tasks.md`：`## 里程碑`、`## 任务清单`、`## 完成定义`

每份文档正文不少于 200 字，否则视为尚未成形。

## 主流程

### 1. 输入 / Input

- 归一化、去重、抽取证据。**仅当存在仓库链接时**才解析仓库；没有则直接归一化。
- 仓库不可访问或权限失败 → 记降级状态，**不阻塞**主流程。
- 产出 `project_context`（目标·摘要·来源·证据）。

### 2. 澄清 / Clarification

- 区分阻塞 / 非阻塞缺失，生成澄清问题，收答案后判就绪度。
- **未就绪必须回到缺失信息收集，不能带着关键歧义进规划。**
- 产出 `clarified_brief`（目标·约束·成功标准）。成功标准要留好，第 6 步验收要回链它。

### 3. 路线规划 / Route Planning

- 生成多条候选路线（至少 标准 / 深度 / 升级），比较成本·风险·收益。
- **先比再选**；选后过轻量确认闸，允许退回重选。
- 产出 `selected_route` 与备选引用。

### 4. 决策与协作 / Decision & Collaboration

- 路线确认**后**判简单 / 复杂。简单 → 单 Agent；复杂 → 头脑风暴（决策·规划·架构·执行·审计·UI），综合器输出方案·信心分·分歧意见（不压平分歧）。
- 单 Agent 与多角色都可调工具。决策超时 / 编排异常 / 工具不可达 → 降级回单 Agent。

### 5. 规格树生成核心 / SPEC Tree Generation Core

顺序：提示词构造 → 脱敏 → LLM 出 JSON → **运行校验脚本** → 通过即用 / 不过即兜底。

**校验是强制步骤，不许在脑子里判：**

1. 生成 JSON，写入 `spec_tree.json`（结构见上方 Schema，`provenance.generationSource = "llm"`）。
2. **运行** `python scripts/validate_spec_tree.py spec_tree.json`。
   - 退出码 `0` → 通过，进入第 6 步。
   - 退出码非 `0` → 读它打印的违规项，**据此重新生成一次**（仅一次）。
3. 重试仍不过 → **运行** `python scripts/fallback_tree.py "<目标描述>" > spec_tree.json`。
   - 兜底树按构造即合法、`provenance.generationSource = "template"`，**不再回校验**，避免 reject→兜底→reject 死循环。
- 不允许跳过校验直接用 LLM 输出；不允许手填 `generationSource` 绕过来源追踪。

### 6. 规格文档 / SPEC Document

1. 从规格树派生 `requirements.md` / `design.md` / `tasks.md`，**章节严格按上方"文档章节契约"**；验收标准从 `clarified_brief.success_criteria` 回链。
2. **运行** `python scripts/check_content_quality.py docs/requirements.md docs/design.md docs/tasks.md`。
   - 不过 → 按它指出的缺失章节补齐后重跑，直到通过。

### 7. 效果预览与交付 / Preview & Handoff

- 从树与文档生成提示词包、效果预览、交付包（`md` / `zip` / 在线对象描述）。
- 预览不满意走反馈与重规划，不直接视作完成。

### 8. 评审与反馈闭环 / Review & Feedback

- 通过 → 交付完成；不通过 → 收集反馈进重规划。
- 重规划**按问题层级回退**到澄清 / 路线 / 规格树 / 模式决策。
- 维护预算与收敛阈值；**超预算或不收敛转人工**。

## 硬规则

- 每个菱形判断闸必须同时定义通过支路与拦下支路。
- **不变量校验由脚本强制执行（见第 5 步），不得跳过、不得用模型主观判代替。**
- **`generationSource` 必须如实填写，禁止给 LLM 内容写 `template`。**
- LLM 自带一次重试，自环要显式可见。
- 脱敏必须是独立步骤，不能混进提示词构造一笔带过。
- 状态只能由单一来源派生，不能多处直接写最终状态。
- 回放与实时状态必须按会话隔离。
- 失效不只标红，还要驱动下游自动重算。
- 规格树兜底必须天然合法，避免失败后再被守卫拒绝。

## 随附脚本 / Bundled Scripts（含调用时机）

- `scripts/validate_spec_tree.py` —— **第 5 步生成 JSON 后必跑**。校验唯一根·父可达·无环·深度·节点类型·节点数·`provenance.generationSource`。
  `python scripts/validate_spec_tree.py spec_tree.json`
- `scripts/fallback_tree.py` —— **第 5 步重试仍不过时跑**。产出按构造合法的兜底树。
  `python scripts/fallback_tree.py "<目标描述>" > spec_tree.json`
- `scripts/check_content_quality.py` —— **第 6 步生成文档后必跑**。查三份文档的必备章节与最小篇幅。
  `python scripts/check_content_quality.py docs/requirements.md docs/design.md docs/tasks.md`

## 推荐目录结构

```text
whybuddy-closed-loop/
  SKILL.md
  docs/
    architecture.mmd        # 仅作参考/证明，描述宿主系统，不是 skill 的执行内容
    requirements.md
    design.md
    tasks.md
    prompt_pack.md
    effect_preview.md
  scripts/
    validate_spec_tree.py
    fallback_tree.py
    check_content_quality.py
  examples/
    handoff_manifest.json
```

## 使用方式

1. 把用户想法、仓库、文件、截图作为输入注入第 1 步。
2. 按 1→8 顺序推进；**第 5、6 步的脚本必须真实运行，不能用文字描述代替执行。**
3. 规格树以 `validate_spec_tree.py` 的退出码为准；文档以 `check_content_quality.py` 的退出码为准。
4. 运行时（存储/推送/回放/自动重算）交给宿主，本 skill 不内嵌。
5. 最终把文档、预览与交付包交给评审闭环。
