/**
 * 自然语言指挥中心契约
 *
 * 定义 NL Command Center 的所有核心类型。
 * 指挥中心在现有 Mission Runtime 之上构建战略指令层，
 * 用户输入战略级自然语言指令，系统通过 LLM 解析意图和约束，
 * 自动分解为多个 Mission，生成执行计划并提供审批、监控、告警、
 * 决策支持和动态调整的完整闭环。
 */

export const NL_COMMAND_CONTRACT_VERSION = '2026-06-01' as const;

// ─── 战略指令 ───

export type CommandPriority = 'critical' | 'high' | 'medium' | 'low';

export type CommandStatus =
  | 'draft'
  | 'analyzing'
  | 'clarifying'
  | 'finalized'
  | 'decomposing'
  | 'planning'
  | 'approving'
  | 'executing'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface StrategicCommand {
  commandId: string;
  commandText: string;
  userId: string;
  timestamp: number;
  status: CommandStatus;
  parsedIntent?: string;
  constraints: CommandConstraint[];
  objectives: string[];
  priority: CommandPriority;
  timeframe?: CommandTimeframe;
}

export interface CommandConstraint {
  type: 'budget' | 'time' | 'quality' | 'resource' | 'custom';
  description: string;
  value?: string;
  unit?: string;
}

export interface CommandTimeframe {
  startDate?: string;
  endDate?: string;
  durationEstimate?: string;
}

// ─── 指令分析 ───

export interface CommandAnalysis {
  intent: string;
  entities: CommandEntity[];
  constraints: CommandConstraint[];
  objectives: string[];
  risks: IdentifiedRisk[];
  assumptions: string[];
  confidence: number;
  needsClarification: boolean;
  clarificationTopics?: string[];
}

export interface CommandEntity {
  name: string;
  type: 'module' | 'service' | 'team' | 'technology' | 'concept' | 'custom';
  description?: string;
}

// ─── 澄清对话 ───

export interface ClarificationDialog {
  dialogId: string;
  commandId: string;
  questions: ClarificationQuestion[];
  answers: ClarificationAnswer[];
  clarificationRounds: number;
  status: 'active' | 'completed';
}

export interface ClarificationQuestion {
  questionId: string;
  text: string;
  type: 'free_text' | 'single_choice' | 'multi_choice';
  options?: string[];
  context?: string;
}

export interface ClarificationAnswer {
  questionId: string;
  text: string;
  selectedOptions?: string[];
  timestamp: number;
}

export interface FinalizedCommand {
  commandId: string;
  originalText: string;
  refinedText: string;
  analysis: CommandAnalysis;
  clarificationSummary?: string;
  finalizedAt: number;
}

// ─── Mission 分解 ───

export interface MissionDecomposition {
  decompositionId: string;
  commandId: string;
  missions: DecomposedMission[];
  dependencies: MissionDependency[];
  executionOrder: string[][];  // 二维数组，每层可并行
  totalEstimatedDuration: number;
  totalEstimatedCost: number;
}

export interface DecomposedMission {
  missionId: string;
  title: string;
  description: string;
  objectives: string[];
  constraints: CommandConstraint[];
  estimatedDuration: number;  // 分钟
  estimatedCost: number;
  priority: CommandPriority;
}

export interface MissionDependency {
  fromMissionId: string;
  toMissionId: string;
  type: 'blocks' | 'depends_on' | 'related';
  description?: string;
}

// ─── Task 分解 ───

export interface TaskDecomposition {
  decompositionId: string;
  missionId: string;
  tasks: DecomposedTask[];
  dependencies: TaskDependency[];
  executionOrder: string[][];
}

export interface DecomposedTask {
  taskId: string;
  title: string;
  description: string;
  objectives: string[];
  constraints: CommandConstraint[];
  estimatedDuration: number;
  estimatedCost: number;
  requiredSkills: string[];
  priority: CommandPriority;
}

export interface TaskDependency {
  fromTaskId: string;
  toTaskId: string;
  type: 'blocks' | 'depends_on';
}

// ─── 执行计划 ───

export interface NLExecutionPlan {
  planId: string;
  commandId: string;
  status: 'draft' | 'pending_approval' | 'approved' | 'executing' | 'completed' | 'failed';
  missions: DecomposedMission[];
  tasks: DecomposedTask[];
  timeline: PlanTimeline;
  resourceAllocation: ResourceAllocation;
  riskAssessment: RiskAssessment;
  costBudget: CostBudget;
  contingencyPlan: ContingencyPlan;
  createdAt: number;
  updatedAt: number;
}

export interface PlanTimeline {
  startDate: string;
  endDate: string;
  criticalPath: string[];  // mission/task IDs on critical path
  milestones: TimelineMilestone[];
  entries: TimelineEntry[];
}

export interface TimelineEntry {
  entityId: string;
  entityType: 'mission' | 'task';
  startTime: number;
  endTime: number;
  duration: number;
  isCriticalPath: boolean;
  parallelGroup?: number;
}

export interface TimelineMilestone {
  id: string;
  label: string;
  date: string;
  entityId: string;
}

export interface ResourceAllocation {
  entries: ResourceEntry[];
  totalAgents: number;
  peakConcurrency: number;
}

export interface ResourceEntry {
  taskId: string;
  agentType: string;
  agentCount: number;
  requiredSkills: string[];
  startTime: number;
  endTime: number;
}

export interface RiskAssessment {
  risks: IdentifiedRisk[];
  overallRiskLevel: 'low' | 'medium' | 'high' | 'critical';
}

export interface IdentifiedRisk {
  id: string;
  description: string;
  level: 'low' | 'medium' | 'high' | 'critical';
  probability: number;
  impact: number;
  mitigation: string;
  contingency?: string;
  relatedEntityId?: string;
}

export interface CostBudget {
  totalBudget: number;
  missionCosts: Record<string, number>;
  taskCosts: Record<string, number>;
  agentCosts: Record<string, number>;
  modelCosts: Record<string, number>;
  currency: string;
}

export interface ContingencyPlan {
  alternatives: ContingencyAlternative[];
  degradationStrategies: string[];
  rollbackPlan: string;
}

export interface ContingencyAlternative {
  id: string;
  description: string;
  trigger: string;
  action: string;
  estimatedImpact: string;
}

// ─── 审批 ───

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'revision_requested';

export interface PlanApprovalRequest {
  requestId: string;
  planId: string;
  requiredApprovers: string[];
  approvals: ApprovalDecision[];
  status: ApprovalStatus;
  createdAt: number;
  updatedAt: number;
}

export interface ApprovalDecision {
  approverId: string;
  decision: 'approved' | 'rejected' | 'revision_requested';
  comments?: string;
  timestamp: number;
}

// ─── 动态调整 ───

export interface PlanAdjustment {
  adjustmentId: string;
  planId: string;
  reason: string;
  changes: AdjustmentChange[];
  impact: AdjustmentImpact;
  approvalRequired: boolean;
  status: 'proposed' | 'approved' | 'applied' | 'rejected';
  createdAt: number;
}

export interface AdjustmentChange {
  entityId: string;
  entityType: 'mission' | 'task' | 'resource' | 'timeline';
  field: string;
  oldValue: unknown;
  newValue: unknown;
}

export interface AdjustmentImpact {
  timelineImpact: string;
  costImpact: string;
  riskImpact: string;
}

// ─── 告警 ───

export type AlertType = 'TASK_DELAYED' | 'COST_EXCEEDED' | 'RISK_ESCALATED' | 'ERROR_OCCURRED' | 'APPROVAL_REQUIRED';
export type AlertPriority = 'critical' | 'warning' | 'info';

export interface Alert {
  alertId: string;
  type: AlertType;
  priority: AlertPriority;
  message: string;
  entityId: string;
  entityType: 'command' | 'mission' | 'task' | 'plan';
  triggeredAt: number;
  acknowledged: boolean;
  metadata?: Record<string, unknown>;
}

export interface AlertRule {
  ruleId: string;
  type: AlertType;
  condition: AlertCondition;
  priority: AlertPriority;
  enabled: boolean;
}

export interface AlertCondition {
  metric: string;
  operator: 'gt' | 'lt' | 'eq' | 'gte' | 'lte';
  threshold: number;
  unit?: string;
}

// ─── 协作 ───

export interface Comment {
  commentId: string;
  entityId: string;
  entityType: 'command' | 'mission' | 'task' | 'plan';
  authorId: string;
  content: string;
  mentions: string[];
  versions: CommentVersion[];
  createdAt: number;
  updatedAt: number;
}

export interface CommentVersion {
  content: string;
  editedAt: number;
  editedBy: string;
}

// ─── 审计 ───

export type AuditOperationType =
  | 'command_created' | 'command_analyzed' | 'command_finalized'
  | 'clarification_question' | 'clarification_answer'
  | 'decomposition_completed' | 'plan_generated'
  | 'approval_submitted' | 'approval_completed'
  | 'adjustment_proposed' | 'adjustment_applied'
  | 'alert_triggered' | 'comment_created' | 'comment_edited'
  | 'permission_changed' | 'report_generated'
  | 'suggestion_generated' | 'suggestion_applied' | 'template_saved';

export interface AuditEntry {
  entryId: string;
  operationType: AuditOperationType;
  operator: string;
  content: string;
  timestamp: number;
  result: 'success' | 'failure';
  entityId?: string;
  entityType?: string;
  metadata?: Record<string, unknown>;
}

export interface AuditQueryFilter {
  startTime?: number;
  endTime?: number;
  operator?: string;
  operationType?: AuditOperationType;
  entityId?: string;
  limit?: number;
  offset?: number;
}

// ─── 报告 ───

export interface ExecutionReport {
  reportId: string;
  planId: string;
  summary: string;
  progressAnalysis: ProgressAnalysis;
  costAnalysis: CostAnalysisResult;
  riskAnalysis: RiskAssessment;
  generatedAt: number;
}

export interface ProgressAnalysis {
  totalMissions: number;
  completedMissions: number;
  totalTasks: number;
  completedTasks: number;
  overallProgress: number;
  delayedItems: string[];
  onTrackItems: string[];
}

export interface CostAnalysisResult {
  plannedCost: number;
  actualCost: number;
  variance: number;
  variancePercentage: number;
  costByMission: Record<string, { planned: number; actual: number }>;
  costByAgent: Record<string, number>;
  costByModel: Record<string, number>;
}

// ─── 模板 ───

export interface PlanTemplate {
  templateId: string;
  name: string;
  description: string;
  plan: Omit<NLExecutionPlan, 'planId' | 'commandId' | 'status' | 'createdAt' | 'updatedAt'>;
  version: number;
  versions: TemplateVersion[];
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

export interface TemplateVersion {
  version: number;
  description: string;
  createdAt: number;
  createdBy: string;
}

// ─── 权限 ───

export type Permission = 'view' | 'create' | 'edit' | 'approve' | 'execute' | 'cancel';
export type UserRole = 'admin' | 'manager' | 'operator' | 'viewer';

export interface PermissionConfig {
  role: UserRole;
  permissions: Permission[];
  scope?: {
    entityType?: string;
    entityId?: string;
  };
}

// ─── 学习与优化 ───

export interface ExecutionMetrics {
  planId: string;
  actualDuration: number;
  actualCost: number;
  plannedDuration: number;
  plannedCost: number;
  durationDeviation: number;
  costDeviation: number;
  completedAt: number;
}

export interface OptimizationReport {
  reportId: string;
  period: { start: number; end: number };
  durationAccuracy: number;
  costAccuracy: number;
  decompositionQuality: number;
  recommendations: string[];
  generatedAt: number;
}

// ---------------------------------------------------------------------------
// Python Contract Slice: NL Command Runtime
// ---------------------------------------------------------------------------

export const NL_COMMAND_PYTHON_RUNTIME_CONTRACT_VERSION =
  "nl-command.runtime.v1" as const;

export type NLCommandPythonRuntimeOperation =
  | "analyze"
  | "clarify"
  | "plan"
  | "approval"
  | "report";

export interface NLCommandPythonRuntimePermission {
  allowed: boolean;
  reason?: string;
  auditId?: string;
  [key: string]: unknown;
}

export interface NLCommandPythonRuntimeAudit {
  eventId: string;
  operationType: string;
  actorId: string;
  entityId: string;
  entityType: string;
  timestamp: number;
  result: "success" | "failure";
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface NLCommandPythonRuntimePlan {
  planId: string;
  commandId: string;
  status: "draft" | "pending_approval" | "approved";
  summary: string;
  steps: Array<{
    stepId: string;
    title: string;
    kind: string;
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
}

export interface NLCommandPythonRuntimeApproval {
  requestId: string;
  planId: string;
  status: ApprovalStatus;
  requiredApprovers: string[];
  approvals: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export interface NLCommandPythonRuntimeReport {
  reportId: string;
  planId: string;
  summary: string;
  sections: Record<string, string>;
  [key: string]: unknown;
}

export interface NLCommandPythonRuntimeError {
  code: string;
  message: string;
}

interface NLCommandPythonRuntimeBaseResult {
  contractVersion: typeof NL_COMMAND_PYTHON_RUNTIME_CONTRACT_VERSION;
  runtime: "python-contract";
  operation: NLCommandPythonRuntimeOperation;
  commandId: string;
  planId?: string;
  permission: NLCommandPythonRuntimePermission;
  audit: NLCommandPythonRuntimeAudit;
}

export type NLCommandPythonRuntimeCompletedResult =
  | (NLCommandPythonRuntimeBaseResult & {
      ok: true;
      status: "completed";
      operation: "analyze";
      analysis: CommandAnalysis;
    })
  | (NLCommandPythonRuntimeBaseResult & {
      ok: true;
      status: "completed";
      operation: "clarify";
      clarification: ClarificationDialog;
    })
  | (NLCommandPythonRuntimeBaseResult & {
      ok: true;
      status: "completed";
      operation: "plan";
      plan: NLCommandPythonRuntimePlan;
    })
  | (NLCommandPythonRuntimeBaseResult & {
      ok: true;
      status: "completed";
      operation: "approval";
      approval: NLCommandPythonRuntimeApproval;
    })
  | (NLCommandPythonRuntimeBaseResult & {
      ok: true;
      status: "completed";
      operation: "report";
      report: NLCommandPythonRuntimeReport;
    });

export type NLCommandPythonRuntimeDeniedResult =
  NLCommandPythonRuntimeBaseResult & {
    ok: false;
    status: "permission_denied";
    error: NLCommandPythonRuntimeError;
  };

export type NLCommandPythonRuntimeResult =
  | NLCommandPythonRuntimeCompletedResult
  | NLCommandPythonRuntimeDeniedResult;

const NL_COMMAND_PYTHON_RUNTIME_OPERATIONS: readonly NLCommandPythonRuntimeOperation[] = [
  "analyze",
  "clarify",
  "plan",
  "approval",
  "report",
];

export function isNLCommandPythonRuntimeResult(
  value: unknown,
): value is NLCommandPythonRuntimeResult {
  const record = nlRuntimeAsRecord(value);
  if (!record) return false;
  if (record.contractVersion !== NL_COMMAND_PYTHON_RUNTIME_CONTRACT_VERSION) {
    return false;
  }
  if (record.runtime !== "python-contract") return false;
  if (!nlRuntimeOneOf(record.operation, NL_COMMAND_PYTHON_RUNTIME_OPERATIONS)) {
    return false;
  }
  const operation = record.operation;
  if (!nlRuntimeNonEmptyString(record.commandId)) return false;
  if (record.planId !== undefined && !nlRuntimeNonEmptyString(record.planId)) {
    return false;
  }
  const permission = nlRuntimeAsRecord(record.permission);
  if (!isNLCommandRuntimePermission(permission)) return false;
  const audit = nlRuntimeAsRecord(record.audit);
  if (!isNLCommandRuntimeAudit(audit, operation)) return false;

  if (record.status === "permission_denied") {
    const error = nlRuntimeAsRecord(record.error);
    return (
      record.ok === false &&
      permission.allowed === false &&
      audit.result === "failure" &&
      error !== null &&
      nlRuntimeNonEmptyString(error.code) &&
      nlRuntimeNonEmptyString(error.message) &&
      !hasAnyNLCommandRuntimePayload(record)
    );
  }

  if (record.status !== "completed" || record.ok !== true) return false;
  if (permission.allowed !== true || audit.result !== "success") return false;
  if (record.error !== undefined) return false;
  if (!hasOnlyExpectedNLCommandRuntimePayload(record, operation)) return false;

  if (operation === "analyze") return isNLCommandRuntimeAnalysis(record.analysis);
  if (operation === "clarify") return isNLCommandRuntimeClarification(record.clarification);
  if (operation === "plan") return isNLCommandRuntimePlan(record.plan, record.commandId);
  if (operation === "approval") return isNLCommandRuntimeApproval(record.approval);
  return isNLCommandRuntimeReport(record.report);
}

function isNLCommandRuntimePermission(
  value: Record<string, unknown> | null,
): value is Record<string, unknown> & NLCommandPythonRuntimePermission {
  if (!value) return false;
  if (typeof value.allowed !== "boolean") return false;
  if (value.reason !== undefined && !nlRuntimeNonEmptyString(value.reason)) return false;
  if (value.auditId !== undefined && !nlRuntimeNonEmptyString(value.auditId)) return false;
  return true;
}

function isNLCommandRuntimeAudit(
  value: Record<string, unknown> | null,
  operation: NLCommandPythonRuntimeOperation,
): value is Record<string, unknown> & NLCommandPythonRuntimeAudit {
  if (!value) return false;
  if (!nlRuntimeNonEmptyString(value.eventId)) return false;
  if (value.operationType !== `nl_command_${operation}`) return false;
  if (!nlRuntimeNonEmptyString(value.actorId)) return false;
  if (!nlRuntimeNonEmptyString(value.entityId)) return false;
  if (!nlRuntimeNonEmptyString(value.entityType)) return false;
  if (typeof value.timestamp !== "number" || !Number.isFinite(value.timestamp)) return false;
  if (value.result !== "success" && value.result !== "failure") return false;
  if (value.metadata !== undefined && !nlRuntimeAsRecord(value.metadata)) return false;
  return true;
}

function isNLCommandRuntimeAnalysis(value: unknown): value is CommandAnalysis {
  const analysis = nlRuntimeAsRecord(value);
  if (!analysis) return false;
  if (!nlRuntimeNonEmptyString(analysis.intent)) return false;
  if (!Array.isArray(analysis.entities)) return false;
  if (!Array.isArray(analysis.constraints)) return false;
  if (!Array.isArray(analysis.objectives)) return false;
  if (!Array.isArray(analysis.risks)) return false;
  if (!Array.isArray(analysis.assumptions)) return false;
  if (!nlRuntimeUnitNumber(analysis.confidence)) return false;
  if (typeof analysis.needsClarification !== "boolean") return false;
  if (analysis.clarificationTopics !== undefined && !Array.isArray(analysis.clarificationTopics)) {
    return false;
  }
  return true;
}

function isNLCommandRuntimeClarification(
  value: unknown,
): value is ClarificationDialog {
  const dialog = nlRuntimeAsRecord(value);
  if (!dialog) return false;
  if (!nlRuntimeNonEmptyString(dialog.dialogId)) return false;
  if (!nlRuntimeNonEmptyString(dialog.commandId)) return false;
  if (!Array.isArray(dialog.questions)) return false;
  if (!Array.isArray(dialog.answers)) return false;
  if (typeof dialog.clarificationRounds !== "number" || dialog.clarificationRounds < 0) {
    return false;
  }
  if (dialog.status !== "active" && dialog.status !== "completed") return false;
  return dialog.questions.every(isNLCommandRuntimeQuestion);
}

function isNLCommandRuntimeQuestion(value: unknown): value is ClarificationQuestion {
  const question = nlRuntimeAsRecord(value);
  if (!question) return false;
  if (!nlRuntimeNonEmptyString(question.questionId)) return false;
  if (!nlRuntimeNonEmptyString(question.text)) return false;
  if (
    question.type !== "free_text" &&
    question.type !== "single_choice" &&
    question.type !== "multi_choice"
  ) {
    return false;
  }
  if (question.options !== undefined && !Array.isArray(question.options)) return false;
  return true;
}

function isNLCommandRuntimePlan(
  value: unknown,
  commandId: unknown,
): value is NLCommandPythonRuntimePlan {
  const plan = nlRuntimeAsRecord(value);
  if (!plan) return false;
  if (!nlRuntimeNonEmptyString(plan.planId)) return false;
  if (plan.commandId !== commandId) return false;
  if (
    plan.status !== "draft" &&
    plan.status !== "pending_approval" &&
    plan.status !== "approved"
  ) {
    return false;
  }
  if (!nlRuntimeNonEmptyString(plan.summary)) return false;
  if (!Array.isArray(plan.steps)) return false;
  return plan.steps.every(stepValue => {
    const step = nlRuntimeAsRecord(stepValue);
    return (
      step !== null &&
      nlRuntimeNonEmptyString(step.stepId) &&
      nlRuntimeNonEmptyString(step.title) &&
      nlRuntimeNonEmptyString(step.kind)
    );
  });
}

function isNLCommandRuntimeApproval(
  value: unknown,
): value is NLCommandPythonRuntimeApproval {
  const approval = nlRuntimeAsRecord(value);
  if (!approval) return false;
  if (!nlRuntimeNonEmptyString(approval.requestId)) return false;
  if (!nlRuntimeNonEmptyString(approval.planId)) return false;
  if (
    approval.status !== "pending" &&
    approval.status !== "approved" &&
    approval.status !== "rejected" &&
    approval.status !== "revision_requested"
  ) {
    return false;
  }
  if (!Array.isArray(approval.requiredApprovers)) return false;
  if (!Array.isArray(approval.approvals)) return false;
  return true;
}

function isNLCommandRuntimeReport(
  value: unknown,
): value is NLCommandPythonRuntimeReport {
  const report = nlRuntimeAsRecord(value);
  if (!report) return false;
  if (!nlRuntimeNonEmptyString(report.reportId)) return false;
  if (!nlRuntimeNonEmptyString(report.planId)) return false;
  if (!nlRuntimeNonEmptyString(report.summary)) return false;
  const sections = nlRuntimeAsRecord(report.sections);
  if (!sections) return false;
  return Object.values(sections).every(section => typeof section === "string");
}

function hasAnyNLCommandRuntimePayload(record: Record<string, unknown>): boolean {
  return ["analysis", "clarification", "plan", "approval", "report"].some(
    field => record[field] !== undefined,
  );
}

function hasOnlyExpectedNLCommandRuntimePayload(
  record: Record<string, unknown>,
  operation: NLCommandPythonRuntimeOperation,
): boolean {
  const expected = {
    analyze: "analysis",
    clarify: "clarification",
    plan: "plan",
    approval: "approval",
    report: "report",
  }[operation];
  return ["analysis", "clarification", "plan", "approval", "report"].every(
    field => (field === expected ? record[field] !== undefined : record[field] === undefined),
  );
}

function nlRuntimeAsRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function nlRuntimeNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function nlRuntimeUnitNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function nlRuntimeOneOf<T extends string>(
  value: unknown,
  options: readonly T[],
): value is T {
  return typeof value === "string" && options.includes(value as T);
}
