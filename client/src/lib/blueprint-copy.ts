import type { AppLocale } from "./locale";

const BLUEPRINT_COPY: Record<string, string> = {
  // Navigation and workbench chrome.
  Autopilot: "自动驾驶",
  Deduction: "推导",
  "Blueprint progress": "蓝图进度",
  "Spec execution overview": "SPEC 执行概览",
  "SPEC asset overview": "SPEC 资产概览",
  "RouteSet factory": "RouteSet 工厂",
  "Autopilot route": "自动驾驶路线",
  "Generate RouteSet": "生成 RouteSet",
  "Autopilot RouteSet": "自动驾驶 RouteSet",
  "Route chosen for deduction": "已选择用于推导的路线",
  "Ready for SPEC tree": "可生成 SPEC 树",
  "Route draft": "路线草稿",
  "Reset route": "重置路线",
  Refresh: "刷新",
  Generate: "生成",
  Retry: "重试",
  "Goal or GitHub URLs": "执行目标或 GitHub 地址",
  "No RouteSet generated yet": "尚未生成 RouteSet",
  "Waiting for /api/blueprint/specs": "等待 /api/blueprint/specs 返回规格进度",
  "Loading blueprint specs...": "正在加载蓝图规格...",
  "No blueprint specs returned yet.": "暂未返回蓝图规格。",
  "Pending sync": "待同步",
  "Preview draft": "预览草稿",
  All: "全部",

  // Generic labels.
  Docs: "文档",
  Req: "需求",
  Requirements: "需求",
  Design: "设计",
  Tasks: "任务",
  Specs: "规格",
  "Docs complete": "文档完成",
  "Task progress": "任务进度",
  "No task totals yet": "暂无任务统计",
  Selected: "已选",
  Primary: "主路",
  Alternative: "备选",
  Chosen: "已选择",
  Choose: "选择",
  Risk: "风险",
  Cost: "成本",
  Depth: "深度",
  Registry: "能力注册表",
  Invocations: "调用记录",
  Evidence: "证据",
  Blocked: "已阻塞",
  Capability: "能力",
  Security: "安全级别",
  Status: "状态",
  Kind: "类型",
  Gate: "安全门",
  Artifact: "资产",
  artifact: "资产",
  "Artifact memory": "资产记忆",
  "artifact memory": "资产记忆",
  Lineage: "血缘",
  Snapshots: "快照",
  Feedback: "反馈",
  Preview: "预演",
  preview: "预演",
  previews: "预演",
  Recorded: "已记录",
  "Runtime Projection": "运行时投影",
  "Runtime capability projection": "运行时能力投影",
  "3D Scene": "3D 场景",
  "Waiting for scene snapshot": "等待场景快照",
  "Scene snapshot is linked.": "场景快照已连接。",
  "No scene snapshot yet.": "暂无场景快照。",
  HUD: "HUD",
  "Waiting for HUD state": "等待 HUD 状态",
  Logs: "日志",
  "Waiting for runtime logs": "等待运行时日志",
  Browser: "浏览器",
  "Waiting for browser preview": "等待浏览器预览",
  "No browser preview link yet.": "暂无浏览器预览链接。",
  "Agent Crew": "智能体团队",
  "Companion role surface": "协作角色面板",
  "Companion roles are aligned with runtime capabilities, logs, browser preview artifacts, and evidence.":
    "协作角色已与运行时能力、日志、浏览器预览资产和证据对齐。",
  "Waiting for role event": "等待角色事件",
  "No capability bound": "未绑定能力",
  "No artifact yet": "暂无资产",
  "No evidence yet": "暂无证据",
  "Log / Preview": "日志 / 预演",
  "Role Event Source": "角色事件来源",
  "Awaiting runtime log": "等待运行时日志",
  Active: "活跃",
  Watching: "观察中",
  Reviewing: "评审中",
  Sleeping: "休眠",
  standby: "待命",

  // Status and token values.
  pending: "待处理",
  running: "进行中",
  completed: "已完成",
  reviewing: "评审中",
  review: "评审",
  draft: "草稿",
  seed: "种子",
  ready: "就绪",
  accepted: "已接受",
  approved: "已批准",
  rejected: "已拒绝",
  declined: "已拒绝",
  selected: "已选",
  passed: "通过",
  failed: "失败",
  blocked: "阻塞",
  planned: "计划中",
  allowed: "已允许",
  verified: "已验证",
  needs_backfill: "待回填",
  backfilled: "已回填",
  recorded: "已记录",
  replayed: "已回放",
  available: "可用",
  requires_approval: "需要审批",
  readonly: "只读",
  sandboxed: "沙盒隔离",
  positive: "正向",
  neutral: "中性",
  negative: "负向",
  mixed: "混合",
  input: "输入",
  intake: "输入",
  planning: "规划",
  route_generation: "路线生成",
  spec_tree: "SPEC 树",
  spec_documents: "规格文档",
  effect_preview: "效果预演",
  prompt_package: "提示词包",
  runtime_capability: "运行时能力",
  engineering_landing: "工程落地",
  artifact_memory: "资产记忆",
  route_set: "RouteSet",
  route_selection: "路线选择",
  clarification_session: "澄清会话",
  github_url: "GitHub 地址",
  intake_text: "输入文本",
  product_goal: "产品目标",
  domain_note: "领域备注",
  github_repository: "GitHub 仓库",
  root: "根节点",
  route_step: "路线步骤",
  alternative_route: "备选路线",
  spec_document: "规格文档",
  engineering_plan: "工程计划",
  add_node: "添加节点",
  move_node: "移动节点",
  merge_nodes: "合并节点",
  split_node: "拆分节点",
  delete_node: "删除节点",
  set_current_version: "设为当前版本",
  mcp: "MCP",
  docker: "Docker",
  skill: "技能",
  role: "角色",
  aigc_node: "AIGC 节点",
  analysis: "分析",
  document: "文档",
  log: "日志",
  logs: "日志",
  derived_from: "源自",
  source: "来源",
  domain: "领域",
  goal: "目标",

  // Autopilot and RouteSet data.
  "Primary SPEC asset route": "主执行路径：SPEC 资产路线",
  "Documentation-first conservative route": "次选路径：文档优先稳妥路线",
  "Preview-first exploratory route": "次选路径：效果预演探索路线",
  "Primary and alternative routes prepared for SPEC tree derivation.":
    "已为 SPEC 树推导准备主路径和备选路径。",
  "Blueprint Intake": "蓝图输入",
  "Normalized target input and GitHub sources captured before route generation.":
    "已在路线生成前捕获并规范化执行目标与 GitHub 来源。",
  "Clarification Session": "澄清会话",
  "Project Domain Context": "项目领域上下文",
  // 自动驾驶 3D 场景融合 follow-up i18n（2026-05-13）：补齐截图里仍走英文的
  // artifact title。后端 createArtifact 会把仓库 URL 拼到 GitHub Source 后面
  // （例如 "GitHub Source: 666ghj/MiroFish"），由 blueprintCopy 的 prefix
  // matcher 兜底翻译；其余固定字面量直接进表。
  "GitHub Source": "GitHub 仓库源",
  "Capability registry": "能力注册表",
  "Capability registry snapshot": "能力注册表快照",
  "Capability invocation": "能力调用记录",
  "Capability evidence": "能力证据",
  "Route generation sandbox derivation": "路线生成沙盒推导",
  "Sandbox derivation job": "沙盒推导任务",
  "Effect preview snapshot": "效果预演快照",
  "Prompt package": "提示词包",
  "Engineering plan": "工程计划",
  "Engineering run": "工程运行",
  "Role timeline": "角色时间线",
  "Agent crew": "Agent 团队",
  // 注：Feedback / Replay 已由表头部 line 63 / 别处覆盖，不在此重复声明，
  // 避免 TS1117「object literal multiple properties with same name」。
  "Derived SPEC tree": "已推导 SPEC 树",
  "Initial durable SPEC tree generated from the selected primary or alternative route.":
    "已根据所选主路径或备选路径生成可沉淀的初始 SPEC 树。",
  "Durable tree asset derived from the selected autopilot route. Downstream menus bind to this tree instead of recomputing the route.":
    "从已选择的自动驾驶路线推导出的可沉淀树资产。后续菜单会绑定到这棵树，而不是重复推算路线。",
  "Expand the selected SPEC tree into requirements, design, and tasks for each important node.":
    "将已选择的 SPEC 树扩展成每个重要节点的需求、设计和任务。",
  "Preview architecture, progress plan, expected UI/prototype direction, and step-by-step implementation effect before coding.":
    "在编码前预演架构、进度规划、预期 UI/原型方向，以及分步骤实现效果。",
  "Package the selected future implementation into prompts that can be used by Cursor, Kiro, Trae, Windsurf, Codex, Claude, and similar tools.":
    "将选定的未来实现打包为可用于 Cursor、Kiro、Trae、Windsurf、Codex、Claude 等工具的提示词。",
  "Reserve the later execution bridge that turns accepted SPEC assets into repository changes and run evidence.":
    "预留后续执行桥，将已接受的 SPEC 资产转换为仓库变更和执行证据。",
  "SPEC tree": "SPEC 树",
  "requirements seed": "需求种子",
  "design seed": "设计种子",
  "tasks seed": "任务种子",
  "node map": "节点映射",
  "clarification decisions": "澄清决策",
  "success criteria": "成功标准",
  "route evidence": "路线证据",
  "Clarify execution intent": "澄清执行意图",
  "Scan GitHub source": "扫描 GitHub 源码",
  "Map capability pool": "映射能力池",
  "Derive SPEC tree seed": "推导 SPEC 树种子",
  "Plan previews and prompts": "规划效果预演与提示词",
  "Product strategist": "产品策略角色",
  "Source analyst": "源码分析角色",
  Orchestrator: "编排器",
  "SPEC curator": "SPEC 策展角色",
  "Preview planner": "效果预演规划角色",
  "Docker analysis sandbox": "Docker 分析沙盒",
  "GitHub source reader": "GitHub 源码读取器",
  "SVG architecture skill": "SVG 架构图能力",
  "AIGC SPEC derivation node": "AIGC SPEC 推导节点",
  "Product strategy role": "产品策略角色",
  "System architecture role": "系统架构角色",
  "Read repository context before route generation.":
    "在路线生成前读取仓库上下文。",
  "Clarify user intent, boundaries, and acceptance signals.":
    "澄清用户意图、边界和验收信号。",
  "Shape modules, dependencies, and engineering landing risks.":
    "梳理模块、依赖和工程落地风险。",
  "Run repository inspection and artifact generation in isolation.":
    "在隔离环境中运行仓库检查与资产生成。",
  "Produce architecture diagrams and route evidence artifacts.":
    "产出架构图与路线证据资产。",
  "Turn route nodes into SPEC tree candidates.":
    "将路线节点转成 SPEC 树候选节点。",
  "Run isolated repository analysis and deterministic command previews.":
    "运行隔离仓库分析与可复现命令预览。",
  "Read network-backed repository context through an MCP adapter.":
    "通过 MCP 适配器读取网络仓库上下文。",
  "Produce architecture diagram evidence from SPEC and preview inputs.":
    "根据 SPEC 与预演输入产出架构图证据。",
  "Derive SPEC node alternatives and evidence summaries.":
    "推导 SPEC 节点备选方案与证据摘要。",
  "Evaluate architecture risks, handoff readiness, and role coverage.":
    "评估架构风险、交接就绪度与角色覆盖。",
  "Specification document generation": "规格文档生成",
  "Effect preview": "效果预演",
  "Implementation prompt package": "实现提示词包",
  "Engineering landing plan": "工程落地计划",
  "Engineering landing": "工程落地",
  "RouteSet outline": "RouteSet 大纲",
  "Decision evidence": "决策证据",
  "SPEC tree seed": "SPEC 树种子",
  "Architecture notes": "架构说明",
  "Implementation prompt seed": "实现提示词种子",
  "architecture diagram": "架构图",
  "prototype notes": "原型说明",
  "progress plan": "进度规划",
  "platform prompts": "平台提示词",
  "acceptance checklist": "验收清单",
  "landing plan": "落地计划",
  "run evidence": "执行证据",
  "requirements.md": "requirements.md",
  "design.md": "design.md",
  "tasks.md": "tasks.md",
  "2-4 analysis passes": "2-4 轮分析",
  "1-3 analysis passes": "1-3 轮分析",
  "1-2 review passes": "1-2 轮评审",
  "3-5 exploration passes": "3-5 轮探索",
  "Use the selected RouteSet path as the source asset for the Deduction menu and SPEC tree workbench.":
    "将已选择的 RouteSet 路径作为推导菜单和 SPEC 树工作台的源资产。",
  "Use the selected RouteSet path as the SPEC tree seed.":
    "将已选择的 RouteSet 路径作为 SPEC 树种子。",
  "Clarify, derive SPEC tree, then package prompts.":
    "先澄清目标，再推导 SPEC 树，最后打包实现提示词。",
  "Balanced path.": "均衡路径。",
  "Lower risk.": "更低风险。",
  "Freeze docs before preview.": "在预演前冻结文档。",
  "Analyze source safely in an isolated runtime.":
    "在隔离运行时中安全分析源码。",
  "Analyze source in isolation.": "在隔离环境中分析源码。",
  "Build RBAC with audit evidence.": "构建带审计证据的 RBAC。",
  "Input GitHub ingestion": "输入与 GitHub 接入",
  "Normalize user goals and GitHub sources.": "规范化用户目标与 GitHub 来源。",
  "Spec tree workbench": "SPEC 树工作台",
  "Refine and persist the derived SPEC tree.": "微调并持久化已推导的 SPEC 树。",
  "Task breakdown": "任务拆分",
  "Split the SPEC into implementation-ready chunks.":
    "将 SPEC 拆分成可实现的任务块。",
  "task checklist": "任务清单",
  "Permission System": "权限系统",
  "Initial Spec": "初始规格",
  "Permission Spec": "权限规格",
  "Track audit evidence.": "跟踪审计证据。",
  "SPEC tree root": "SPEC 树根节点",
  "Root node for the workbench.": "工作台根节点。",
  "Generate requirements, design, and tasks.": "生成需求、设计和任务。",
  "Requirements summary.": "需求摘要。",
  "User-facing requirements for the permission system.":
    "权限系统面向用户的需求。",
  "Preview of architecture, prototype cues, and implementation progress.":
    "架构、原型提示和实现进度的预演。",
  "Keep policy evaluation behind an auditable service boundary.":
    "将策略评估保持在可审计的服务边界之后。",
  "Persist review evidence with immutable timestamps.":
    "使用不可变时间戳沉淀评审证据。",
  "Show role assignment and denied-action replay in the prototype.":
    "在原型中展示角色分配和拒绝动作回放。",
  "Model permission resources": "建模权限资源",
  "Define roles, grants, denials, and audit joins.":
    "定义角色、授权、拒绝和审计关联。",
  "Resources are ready for implementation prompts.":
    "资源已准备好生成实现提示词。",
  "Cursor implementation prompt package": "Cursor 实现提示词包",
  "Copy-ready prompt package for implementing the permission system.":
    "用于实现权限系统的可复制提示词包。",
  "Implement the permission system with auditable role grants, denied-action replay, and immutable review evidence.":
    "实现具备可审计角色授权、拒绝动作回放和不可变评审证据的权限系统。",
  Objective: "目标",
  "Build the permission workflow from accepted SPEC documents and the effect preview.":
    "根据已接受的 SPEC 文档和效果预演构建权限工作流。",
  "Acceptance checklist": "验收清单",
  "Verify role assignment, denied-action replay, and audit evidence persistence.":
    "验证角色分配、拒绝动作回放和审计证据持久化。",
  "Cursor engineering landing plan": "Cursor 工程落地计划",
  "Hand off the permission system package to a Cursor workspace.":
    "将权限系统包交接到 Cursor 工作区。",
  "Cursor workspace handoff": "Cursor 工作区交接",
  "Open the prompt package in Cursor and apply the permission workflow.":
    "在 Cursor 中打开提示词包并应用权限工作流。",
  "Use the Objective and Acceptance checklist sections.":
    "使用目标和验收清单部分。",
  "Keep audit persistence changes scoped to permission files.":
    "将审计持久化变更限定在权限相关文件中。",
  "Apply permission schema": "应用权限模式",
  "Implement auditable role grants and denied-action replay.":
    "实现可审计角色授权和拒绝动作回放。",
  "Permission tests": "权限测试",
  "Permission workflow tests pass.": "权限工作流测试通过。",
  "Cursor handoff implemented and verified.": "Cursor 交接已实现并验证。",
  "Green test run.": "测试运行通过。",
  "Applied permission schema.": "已应用权限模式。",
  "RouteSet generated": "RouteSet 已生成",
  "Engineering run recorded": "工程执行记录",
  "Primary SPEC asset route was generated.":
    "主执行路径：SPEC 资产路线已生成。",
  "Cursor handoff implementation evidence was stored.":
    "Cursor 交接实现证据已存储。",
  "Run evidence derives from the RouteSet.": "执行证据来自 RouteSet。",
  "Permission project replay": "权限项目回放",
  "Recovered RouteSet to engineering run timeline.":
    "将 RouteSet 恢复到工程执行时间线。",
  "Route to run diff": "路线到执行差异",
  "Engineering run adds implementation evidence.":
    "工程执行记录补充了实现证据。",
  "Execution evidence approved for future SPEC evolution.":
    "执行证据已批准，可用于未来 SPEC 演进。",
  "Bind this run back into the asset memory.": "将本次执行绑定回资产记忆。",
  "Permission boundary analysis": "权限边界分析",
  "Runtime evidence confirms permission checks have auditable service boundaries.":
    "运行时证据确认权限校验具有可审计的服务边界。",
  "Docker sandbox found auditable permission boundaries.":
    "Docker 沙盒发现了可审计的权限边界。",
  "Skill evidence publisher": "技能证据发布器",
  "Publish reusable skill evidence for later handoff.":
    "发布可复用技能证据，供后续交接使用。",
  "Normalizes generated notes into runtime capability evidence.":
    "将生成说明规范化为运行时能力证据。",
  "Collect target users and boundaries.": "收集目标用户和边界条件。",
  "Collect target users, product boundary, constraints, and success criteria before route choice.":
    "在路线选择前收集目标用户、产品边界、约束和成功标准。",
  "Inspect repositories and extract technology stack, module boundaries, and reusable assets.":
    "检查仓库并提取技术栈、模块边界和可复用资产。",
  "Choose Docker, MCP, skills, AIGC nodes, and specialist roles for analysis coverage.":
    "选择 Docker、MCP、技能、AIGC 节点和专家角色来覆盖分析任务。",
  "Transform primary and alternative route nodes into an editable SPEC tree asset.":
    "将主路径与备选路径节点转成可编辑的 SPEC 树资产。",
  "Prepare the downstream effect preview, architecture diagram, and implementation prompt package.":
    "准备下游效果预演、架构图和实现提示词包。",
  "Balances product clarification, architecture analysis, and asset persistence so the selected path can become the long-lived SPEC tree.":
    "平衡产品澄清、架构分析和资产沉淀，让所选路径可以演化成长期可维护的 SPEC 树。",
  "Reduces downstream churn when the business boundary is still broad or governance matters more than speed.":
    "当业务边界仍然较宽、治理比速度更重要时，降低后续返工。",
  "Useful when the user needs to see the future system effect before locking detailed specifications.":
    "适合在锁定详细规格前，先看到未来系统的大致效果。",
  "Clarify the requested product direction, derive the durable SPEC tree, then expand documents, preview, and implementation prompts.":
    "澄清产品方向，推导可沉淀的 SPEC 树，再扩展规格文档、效果预演和实现提示词。",
  "Create a narrower SPEC tree first, freeze requirements/design/tasks, then preview and package prompts after review.":
    "先创建更收敛的 SPEC 树，冻结需求/设计/任务，再评审后生成预演和提示词。",
  "Push route analysis toward effect preview early, then backfill SPEC documents from the selected prototype direction.":
    "更早推进到效果预演，再从选定的原型方向回填 SPEC 文档。",

  // Clarification prompts.
  "What outcome should the blueprint optimize for first?":
    "这份蓝图应该优先优化什么结果？",
  "Who is the primary user or operator for this project?":
    "这个项目的主要用户或操作者是谁？",
  "What constraints, integrations, or risks must the route preserve?":
    "这条路线必须保留哪些约束、集成或风险边界？",
  "How should the GitHub repository influence the first RouteSet?":
    "GitHub 仓库应该如何影响第一版 RouteSet？",
  "Which durable domain assets should be carried into later stages?":
    "哪些可沉淀的领域资产需要带入后续阶段？",

  // Common generated workbench labels.
  "Runtime capability registry": "运行时能力注册表",
  "Project Context": "项目上下文",
  "Implementation Brief": "实现简报",
  Constraints: "约束",
  "Verification Plan": "验证计划",
  Handoff: "交接",
  "Source bindings": "来源绑定",
  "Primary user-facing change": "主要用户可见变化",
  "Architecture visibility": "架构可视化",
  "Operational checkpoint": "运行检查点",
  "Confirm source SPEC coverage": "确认源 SPEC 覆盖",
  "Draft architecture effect": "草拟架构效果",
  "Plan prototype and landing progress": "规划原型与落地进度",
  "Bind landing sources": "绑定落地来源",
  "Apply repository bridge": "应用仓库桥接",
  "Capture run evidence": "捕获执行证据",

  // ── autopilot-v4-frontend-alignment 任务 64：v4 信任层术语表（保持 v4 措辞）──
  // 集中登记信任层 UI 术语，保证 zh-CN / en-US 措辞统一、可被 blueprintCopy 复用。
  Trust: "信任层",
  "Checks Ledger": "校验台账",
  "Checks ledger summary": "校验台账摘要",
  Traceability: "可追溯",
  "Traceability Matrix": "可追溯矩阵",
  "traceability matrix": "可追溯矩阵",
  Companion: "伴随发现",
  "Companion Findings": "伴随发现",
  Critic: "挑刺者",
  Grounding: "接地者",
  Coverage: "覆盖率",
  Gaps: "缺口",
  "Open items": "未决项",
  "Trust Bundle": "信任层交付包",
  "Merge gate (human-judged)": "合并门（人判定）",
  "Route confirm gate": "路线确认闸",
  "Confirm route": "确认路线",
  "Abort / Escalate": "中止 / 转人工",
  "Abort & escalate": "中止并转人工",
  "review signals · human is the gate": "评审信号，人是闸",
  "Review signal; never auto-blocks or auto-merges.":
    "评审信号，不自动拦截 / 不自动合并。",
  "preview · unverified": "预览·未验证",
  "Export MD": "导出 MD",
  Stale: "已失效",
};

export function blueprintCopy(
  value: string | undefined,
  locale: AppLocale = "zh-CN"
): string {
  if (!value) return "";
  if (locale === "en-US") return value;
  const direct = BLUEPRINT_COPY[value];
  if (direct) return direct;

  const normalized = value.trim();
  const normalizedDirect = BLUEPRINT_COPY[normalized];
  if (normalizedDirect) return normalizedDirect;

  const selectedRoute = normalized.match(/^Selected route:\s*(.+)$/);
  if (selectedRoute) {
    return `已选择路线：${blueprintCopy(selectedRoute[1])}`;
  }

  const specAssetTree = normalized.match(/^SPEC asset tree:\s*(.+)$/);
  if (specAssetTree) {
    return `SPEC 资产树：${blueprintCopy(specAssetTree[1])}`;
  }

  const clarifyRoute = normalized.match(
    /^Clarify\s+(.+?), derive the durable SPEC tree, then expand documents, preview, and implementation prompts\.$/
  );
  if (clarifyRoute) {
    return `澄清 ${clarifyRoute[1]}，推导可沉淀的 SPEC 树，再扩展规格文档、效果预演和实现提示词。`;
  }

  const requiredAnswers = normalized.match(
    /^(\d+)\/(\d+) required clarification answers recorded\.$/
  );
  if (requiredAnswers) {
    return `已记录 ${requiredAnswers[1]}/${requiredAnswers[2]} 条必答澄清。`;
  }

  const domainContext = normalized.match(
    /^(\d+) domain assets and (\d+) evidence items available for routing\.$/
  );
  if (domainContext) {
    return `当前有 ${domainContext[1]} 个领域资产和 ${domainContext[2]} 条证据可用于路线推导。`;
  }

  const repositoryParsed = normalized.match(
    /^GitHub repository URL parsed as (.+)\.$/
  );
  if (repositoryParsed) {
    return `已解析 GitHub 仓库地址：${repositoryParsed[1]}。`;
  }

  const repositoryPlaceholder = normalized.match(
    /^Repository context placeholder for (.+)\.$/
  );
  if (repositoryPlaceholder) {
    return `已为 ${repositoryPlaceholder[1]} 预留仓库上下文。`;
  }

  const selectedRouteStarted = normalized.match(
    /^Selected route (.+) and started SPEC tree derivation\.$/
  );
  if (selectedRouteStarted) {
    return `已选择路线「${blueprintCopy(selectedRouteStarted[1])}」并开始推导 SPEC 树。`;
  }

  const routeGenerated = normalized.match(/^(.+) was generated\.$/);
  if (routeGenerated) {
    return `${blueprintCopy(routeGenerated[1])} 已生成。`;
  }

  const effectPreview = normalized.match(/^Effect preview:\s*(.+)$/);
  if (effectPreview) {
    return `效果预演：${blueprintCopy(effectPreview[1])}`;
  }

  const architectureNote = normalized.match(/^Architecture note (\d+)$/);
  if (architectureNote) {
    return `架构说明 ${architectureNote[1]}`;
  }

  const milestone = normalized.match(/^Milestone:\s*(.+)$/);
  if (milestone) {
    return `里程碑：${blueprintCopy(milestone[1])}`;
  }

  const verifyTaskDocument = normalized.match(/^Verify task document:\s*(.+)$/);
  if (verifyTaskDocument) {
    return `验证任务文档：${blueprintCopy(verifyTaskDocument[1])}`;
  }

  const validateMilestone = normalized.match(/^Validate milestone:\s*(.+)$/);
  if (validateMilestone) {
    return `验证里程碑：${blueprintCopy(validateMilestone[1])}`;
  }

  const engineeringRun = normalized.match(/^Engineering run:\s*(.+)$/);
  if (engineeringRun) {
    return `工程执行：${blueprintCopy(engineeringRun[1])}`;
  }

  const capabilityInvocation = normalized.match(
    /^Capability invocation:\s*(.+)$/
  );
  if (capabilityInvocation) {
    return `能力调用：${blueprintCopy(capabilityInvocation[1])}`;
  }

  const artifactKind = normalized.match(/^Artifact\s+(.+):\s*(.+)$/);
  if (artifactKind) {
    return `资产${blueprintCopy(artifactKind[1])}：${blueprintCopy(artifactKind[2])}`;
  }

  // 自动驾驶 3D 场景融合 follow-up i18n（2026-05-13）：后端
  // server/routes/blueprint.ts 在 createArtifact() 时会把仓库 URL / 文档名
  // / 节点标识符直接拼进 title，例如：
  //   "GitHub Source: 666ghj/MiroFish"
  //   "Spec asset: requirements / Auth Module"
  //   "Replay: blueprint-job-xxx"
  // 这些 prefix + dynamic 后缀的组合不能逐条进 BLUEPRINT_COPY 表，
  // 改用 prefix matcher 兜底翻译头部，后缀（仓库名、节点 id 等）保留原样。
  const githubSource = normalized.match(/^GitHub Source:\s*(.+)$/);
  if (githubSource) {
    return `GitHub 仓库源：${githubSource[1]}`;
  }

  const replayPrefix = normalized.match(/^Replay:\s*(.+)$/);
  if (replayPrefix) {
    return `回放：${replayPrefix[1]}`;
  }

  const sandboxDerivation = normalized.match(
    /^(?:Route generation\s+)?[Ss]andbox derivation(?:\s+job)?(?::\s*(.+))?$/
  );
  if (sandboxDerivation) {
    const tail = sandboxDerivation[1];
    return tail ? `沙盒推导任务：${tail}` : "沙盒推导任务";
  }

  const phraseTranslated = value
    .replace(/^# Requirements\b/gm, "# 需求")
    .replace(/^# Design\b/gm, "# 设计")
    .replace(/^# Tasks\b/gm, "# 任务")
    .replace(/^# Permission Spec\b/gm, "# 权限规格")
    .replace(/^# Initial Spec\b/gm, "# 初始规格")
    .replace(/\bTrack audit evidence\./g, "跟踪审计证据。")
    .replace(/\bCapture user roles\./g, "捕获用户角色。")
    .replace(
      /\bImplement the permission system with auditable role grants, denied-action replay, and immutable review evidence\./g,
      "实现具备可审计角色授权、拒绝动作回放和不可变评审证据的权限系统。"
    );
  if (phraseTranslated !== value) return phraseTranslated;

  return value;
}
