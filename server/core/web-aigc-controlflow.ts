import type {
  GraphEdgeTransitionSnapshot,
  GraphInstanceSnapshot,
  GraphNodeRunSnapshot,
} from "../../shared/workflow-graph.js";
import type { MissionRecord } from "../../shared/mission/contracts.js";
import type { WorkflowRecord } from "../../shared/workflow-runtime.js";

type ControlFlowScope = "global" | "local" | "temp";

type ControlFlowNodeType =
  | "start"
  | "variable_assignment"
  | "condition"
  | "end";

interface ControlFlowBaseNode {
  id: string;
  type: ControlFlowNodeType;
  label?: string;
}

interface ControlFlowStartNode extends ControlFlowBaseNode {
  type: "start";
}

interface ControlFlowVariableAssignmentNode extends ControlFlowBaseNode {
  type: "variable_assignment";
  config?: {
    target: string;
    scope?: ControlFlowScope;
    source?: string;
    value?: unknown;
    expression?: string;
  };
}

interface ControlFlowConditionNode extends ControlFlowBaseNode {
  type: "condition";
  config?: {
    expression?: string;
  };
}

interface ControlFlowEndNode extends ControlFlowBaseNode {
  type: "end";
  config?: {
    output?: string;
  };
}

type ControlFlowNode =
  | ControlFlowStartNode
  | ControlFlowVariableAssignmentNode
  | ControlFlowConditionNode
  | ControlFlowEndNode;

interface ControlFlowEdge {
  id?: string;
  source: string;
  target: string;
  branch?: string;
}

interface ControlFlowVariableSnapshot {
  global?: Record<string, unknown>;
  local?: Record<string, unknown>;
  temp?: Record<string, unknown>;
}

interface ControlFlowExecutionState {
  currentNodeId?: string;
  visitedNodeIds?: string[];
  branchHits?: Record<string, string>;
  variableChanges?: ControlFlowVariableChange[];
  output?: unknown;
  errors?: Record<string, string>;
}

interface ControlFlowVariableChange {
  nodeId: string;
  scope: ControlFlowScope;
  target: string;
  previousValue?: unknown;
  nextValue?: unknown;
}

interface ControlFlowAssignmentConfig {
  target?: string;
  scope?: ControlFlowScope;
  source?: string;
  value?: unknown;
  expression?: string;
}

interface ControlFlowDefinition {
  version?: number;
  nodes: ControlFlowNode[];
  edges: ControlFlowEdge[];
  input?: {
    directive?: string;
    attachments?: unknown[];
    variables?: ControlFlowVariableSnapshot;
  };
  execution?: ControlFlowExecutionState;
  metadata?: {
    name?: string;
    code?: string;
  };
}

interface VariableContextByScope {
  global: Record<string, unknown>;
  local: Record<string, unknown>;
  temp: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? { ...value } : {};
}

function normalizeNode(value: unknown): ControlFlowNode | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.type !== "string") {
    return null;
  }

  switch (value.type) {
    case "start":
    case "variable_assignment":
    case "condition":
    case "end":
      return {
        id: value.id,
        type: value.type,
        label: typeof value.label === "string" ? value.label : undefined,
        config: isRecord(value.config) ? value.config : undefined,
      } as ControlFlowNode;
    default:
      return null;
  }
}

function normalizeEdge(value: unknown): ControlFlowEdge | null {
  if (!isRecord(value)) {
    return null;
  }

  if (typeof value.source !== "string" || typeof value.target !== "string") {
    return null;
  }

  return {
    id: typeof value.id === "string" ? value.id : undefined,
    source: value.source,
    target: value.target,
    branch: typeof value.branch === "string" ? value.branch : undefined,
  };
}

function normalizeExecution(value: unknown): ControlFlowExecutionState {
  if (!isRecord(value)) {
    return {};
  }

  return {
    currentNodeId:
      typeof value.currentNodeId === "string" ? value.currentNodeId : undefined,
    visitedNodeIds: Array.isArray(value.visitedNodeIds)
      ? value.visitedNodeIds.filter(
          (item): item is string => typeof item === "string"
        )
      : undefined,
    branchHits: isRecord(value.branchHits)
      ? Object.fromEntries(
          Object.entries(value.branchHits).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string"
          )
        )
      : undefined,
    variableChanges: Array.isArray(value.variableChanges)
      ? value.variableChanges
          .filter((item): item is Record<string, unknown> => isRecord(item))
          .map(item => {
            const scope: ControlFlowScope =
              item.scope === "global" || item.scope === "local" || item.scope === "temp"
                ? item.scope
                : "global";
            return {
              nodeId: typeof item.nodeId === "string" ? item.nodeId : "",
              scope,
              target: typeof item.target === "string" ? item.target : "",
              previousValue: item.previousValue,
              nextValue: item.nextValue,
            };
          })
          .filter(item => item.nodeId && item.target)
      : undefined,
    output: value.output,
    errors: isRecord(value.errors)
      ? Object.fromEntries(
          Object.entries(value.errors).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string"
          )
        )
      : undefined,
  };
}

function normalizeDefinition(value: unknown): ControlFlowDefinition | null {
  if (!isRecord(value) || !Array.isArray(value.nodes) || !Array.isArray(value.edges)) {
    return null;
  }

  const nodes = value.nodes
    .map(normalizeNode)
    .filter((node): node is ControlFlowNode => Boolean(node));
  const edges = value.edges
    .map(normalizeEdge)
    .filter((edge): edge is ControlFlowEdge => Boolean(edge));

  if (nodes.length === 0) {
    return null;
  }

  const input = isRecord(value.input)
    ? {
        directive:
          typeof value.input.directive === "string"
            ? value.input.directive
            : undefined,
        attachments: Array.isArray(value.input.attachments)
          ? value.input.attachments
          : undefined,
        variables: isRecord(value.input.variables)
          ? {
              global: normalizeRecord(value.input.variables.global),
              local: normalizeRecord(value.input.variables.local),
              temp: normalizeRecord(value.input.variables.temp),
            }
          : undefined,
      }
    : undefined;

  const metadata = isRecord(value.metadata)
    ? {
        name: typeof value.metadata.name === "string" ? value.metadata.name : undefined,
        code: typeof value.metadata.code === "string" ? value.metadata.code : undefined,
      }
    : undefined;

  return {
    version: typeof value.version === "number" ? value.version : undefined,
    nodes,
    edges,
    input,
    execution: normalizeExecution(value.execution),
    metadata,
  };
}

function getControlFlowDefinition(workflow: WorkflowRecord): ControlFlowDefinition | null {
  const candidates = [
    workflow.results?.webAigcControlFlow,
    workflow.results?.web_aigc_controlflow,
    workflow.results?.controlFlow,
    workflow.results?.control_flow,
  ];

  for (const candidate of candidates) {
    const definition = normalizeDefinition(candidate);
    if (definition) {
      return definition;
    }
  }

  return null;
}

function sanitizePreview(value: unknown, maxLength = 160): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  let text: string;
  if (typeof value === "string") {
    text = value;
  } else {
    try {
      text = JSON.stringify(value, null, 0) || "";
    } catch {
      text = String(value);
    }
  }

  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return undefined;
  }

  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength - 3)}...`
    : normalized;
}

function cloneVariableContext(
  source?: ControlFlowVariableSnapshot
): VariableContextByScope {
  return {
    global: normalizeRecord(source?.global),
    local: normalizeRecord(source?.local),
    temp: normalizeRecord(source?.temp),
  };
}

function lookupVariable(
  key: string,
  context: VariableContextByScope
): unknown {
  if (key in context.temp) return context.temp[key];
  if (key in context.local) return context.local[key];
  if (key in context.global) return context.global[key];
  return undefined;
}

function resolveTokenValue(
  token: string,
  context: VariableContextByScope
): unknown {
  const trimmed = token.trim();
  if (!trimmed) {
    return undefined;
  }

  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null") return null;
  if (trimmed === "undefined") return undefined;

  const numberValue = Number(trimmed);
  if (Number.isFinite(numberValue) && trimmed !== "") {
    return numberValue;
  }

  if (trimmed.startsWith("$.")) {
    return lookupVariable(trimmed.slice(2), context);
  }

  return lookupVariable(trimmed, context);
}

function evaluateSimpleExpression(
  expression: string,
  context: VariableContextByScope
): unknown {
  const trimmed = expression.trim();
  if (!trimmed) {
    return undefined;
  }

  const fallbackOperators = ["===", "!==", ">=", "<=", "==", "!=", ">", "<"];
  for (const operator of fallbackOperators) {
    const operatorIndex = trimmed.indexOf(operator);
    if (operatorIndex <= 0) {
      continue;
    }

    const leftToken = trimmed.slice(0, operatorIndex);
    const rightToken = trimmed.slice(operatorIndex + operator.length);
    const leftValue = resolveTokenValue(leftToken, context);
    const rightValue = resolveTokenValue(rightToken, context);

    switch (operator) {
      case "===":
      case "==":
        return leftValue === rightValue;
      case "!==":
      case "!=":
        return leftValue !== rightValue;
      case ">":
        return Number(leftValue) > Number(rightValue);
      case "<":
        return Number(leftValue) < Number(rightValue);
      case ">=":
        return Number(leftValue) >= Number(rightValue);
      case "<=":
        return Number(leftValue) <= Number(rightValue);
      default:
        break;
    }
  }

  return resolveTokenValue(trimmed, context);
}

// --- Condition Rules (14 operators + AND/OR) ---

export type ConditionOperator =
  | "eq"
  | "neq"
  | "in"
  | "not_in"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "is_empty"
  | "is_not_empty"
  | "starts_with"
  | "ends_with"
  | "contains"
  | "regex";

export type ConditionRelation = "AND" | "OR";

export interface ConditionRule {
  leftValue: unknown;
  operator: ConditionOperator;
  rightValue?: unknown;
}

export interface ConditionRulesResult {
  matched: boolean;
  results: Array<{ rule: ConditionRule; result: boolean }>;
}

function isNullOrUndefined(value: unknown): boolean {
  return value === null || value === undefined;
}

function tryParseNumber(value: unknown): number | null {
  if (typeof value === "number" && !Number.isNaN(value)) {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return null;
    const num = Number(trimmed);
    if (!Number.isNaN(num)) return num;
  }
  return null;
}

function toArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    return value
      .split(",")
      .map(s => s.trim())
      .filter(s => s !== "");
  }
  if (isNullOrUndefined(value)) return [];
  return [value];
}

function evaluateOperatorEq(left: unknown, right: unknown): boolean {
  if (isNullOrUndefined(left) && isNullOrUndefined(right)) return true;
  if (isNullOrUndefined(left) || isNullOrUndefined(right)) return false;
  const numLeft = tryParseNumber(left);
  const numRight = tryParseNumber(right);
  if (numLeft !== null && numRight !== null) return numLeft === numRight;
  return String(left) === String(right);
}

function evaluateOperatorIn(left: unknown, right: unknown): boolean {
  if (isNullOrUndefined(left)) return false;
  const arr = toArray(right);
  if (arr.length === 0) return false;
  const leftStr = String(left);
  return arr.some(item => {
    if (isNullOrUndefined(item)) return false;
    const numLeft = tryParseNumber(left);
    const numItem = tryParseNumber(item);
    if (numLeft !== null && numItem !== null) return numLeft === numItem;
    return String(item) === leftStr;
  });
}

function evaluateOperatorGt(left: unknown, right: unknown): boolean {
  if (isNullOrUndefined(left) || isNullOrUndefined(right)) return false;
  const numLeft = tryParseNumber(left);
  const numRight = tryParseNumber(right);
  if (numLeft !== null && numRight !== null) return numLeft > numRight;
  return String(left) > String(right);
}

function evaluateOperatorGte(left: unknown, right: unknown): boolean {
  if (isNullOrUndefined(left) || isNullOrUndefined(right)) return false;
  const numLeft = tryParseNumber(left);
  const numRight = tryParseNumber(right);
  if (numLeft !== null && numRight !== null) return numLeft >= numRight;
  return String(left) >= String(right);
}

function evaluateOperatorLt(left: unknown, right: unknown): boolean {
  if (isNullOrUndefined(left) || isNullOrUndefined(right)) return false;
  const numLeft = tryParseNumber(left);
  const numRight = tryParseNumber(right);
  if (numLeft !== null && numRight !== null) return numLeft < numRight;
  return String(left) < String(right);
}

function evaluateOperatorLte(left: unknown, right: unknown): boolean {
  if (isNullOrUndefined(left) || isNullOrUndefined(right)) return false;
  const numLeft = tryParseNumber(left);
  const numRight = tryParseNumber(right);
  if (numLeft !== null && numRight !== null) return numLeft <= numRight;
  return String(left) <= String(right);
}

function evaluateOperatorIsEmpty(value: unknown): boolean {
  if (isNullOrUndefined(value)) return true;
  if (typeof value === "string" && value.trim() === "") return true;
  if (Array.isArray(value) && value.length === 0) return true;
  if (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 0
  ) {
    return true;
  }
  return false;
}

function evaluateOperatorStartsWith(left: unknown, right: unknown): boolean {
  if (isNullOrUndefined(left) || isNullOrUndefined(right)) return false;
  return String(left).startsWith(String(right));
}

function evaluateOperatorEndsWith(left: unknown, right: unknown): boolean {
  if (isNullOrUndefined(left) || isNullOrUndefined(right)) return false;
  return String(left).endsWith(String(right));
}

function evaluateOperatorContains(left: unknown, right: unknown): boolean {
  if (isNullOrUndefined(left) || isNullOrUndefined(right)) return false;
  return String(left).includes(String(right));
}

const REGEX_TIMEOUT_MS = 1000;

function evaluateOperatorRegex(left: unknown, right: unknown): boolean {
  if (isNullOrUndefined(left) || isNullOrUndefined(right)) return false;
  const pattern = String(right);
  const text = String(left);
  try {
    const regex = new RegExp(pattern);
    const startTime = Date.now();
    const result = regex.test(text);
    const elapsed = Date.now() - startTime;
    if (elapsed > REGEX_TIMEOUT_MS) {
      console.warn(
        `[evaluateConditionRules] Regex execution exceeded ${REGEX_TIMEOUT_MS}ms threshold: ${elapsed}ms`,
      );
      return false;
    }
    return result;
  } catch {
    return false;
  }
}

function evaluateSingleOperator(
  left: unknown,
  operator: ConditionOperator,
  right: unknown,
): boolean {
  switch (operator) {
    case "eq":
      return evaluateOperatorEq(left, right);
    case "neq":
      return !evaluateOperatorEq(left, right);
    case "in":
      return evaluateOperatorIn(left, right);
    case "not_in":
      return !evaluateOperatorIn(left, right);
    case "gt":
      return evaluateOperatorGt(left, right);
    case "gte":
      return evaluateOperatorGte(left, right);
    case "lt":
      return evaluateOperatorLt(left, right);
    case "lte":
      return evaluateOperatorLte(left, right);
    case "is_empty":
      return evaluateOperatorIsEmpty(left);
    case "is_not_empty":
      return !evaluateOperatorIsEmpty(left);
    case "starts_with":
      return evaluateOperatorStartsWith(left, right);
    case "ends_with":
      return evaluateOperatorEndsWith(left, right);
    case "contains":
      return evaluateOperatorContains(left, right);
    case "regex":
      return evaluateOperatorRegex(left, right);
    default:
      return false;
  }
}

function resolveConditionRuleValue(
  value: unknown,
  variables: Record<string, unknown>,
): unknown {
  if (typeof value === "string" && value.startsWith("$")) {
    const afterDollar = value.slice(1);
    if (afterDollar.startsWith(".")) {
      // "$.path.to.value" → resolve nested path from variables
      const path = afterDollar.slice(1); // remove leading "."
      return getNestedValue(variables, path);
    }
    // "$varName" → flat lookup from variables
    const context: VariableContextByScope = {
      global: { ...variables },
      local: {},
      temp: {},
    };
    return resolveTokenValue(afterDollar, context);
  }
  return value;
}

function getNestedValue(obj: unknown, path: string): unknown {
  const segments = path.split(".");
  let current: unknown = obj;
  for (const segment of segments) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

export function evaluateConditionRules(
  rules: ConditionRule[],
  relation: ConditionRelation,
  variables: Record<string, unknown>,
): ConditionRulesResult {
  if (!rules || rules.length === 0) {
    return { matched: false, results: [] };
  }

  const results: Array<{ rule: ConditionRule; result: boolean }> = [];

  for (const rule of rules) {
    const left = resolveConditionRuleValue(rule.leftValue, variables);
    const right = resolveConditionRuleValue(rule.rightValue, variables);
    let result = false;
    try {
      result = evaluateSingleOperator(left, rule.operator, right);
    } catch {
      result = false;
    }
    results.push({ rule, result });
  }

  const matched =
    relation === "AND"
      ? results.every(r => r.result)
      : results.some(r => r.result);

  return { matched, results };
}

// --- Legacy expression-based condition evaluation ---

export interface RuntimeConditionEvaluation {
  matched: boolean;
  rationale?: string;
  error?: string;
}

const RUNTIME_CONDITION_OPERATORS = [
  "===",
  "!==",
  ">=",
  "<=",
  "==",
  "!=",
  ">",
  "<",
] as const;

function findRuntimeConditionOperator(
  expression: string
): { operator?: (typeof RUNTIME_CONDITION_OPERATORS)[number]; index?: number } {
  for (const operator of RUNTIME_CONDITION_OPERATORS) {
    const index = expression.indexOf(operator);
    if (index > 0) {
      return { operator, index };
    }
  }

  return {};
}

export function evaluateRuntimeConditionExpression(
  expression: string,
  variables: Record<string, unknown>
): RuntimeConditionEvaluation {
  const trimmed = expression.trim();
  if (!trimmed) {
    return {
      matched: false,
      error: "Condition node requires a non-empty expression.",
    };
  }

  const context: VariableContextByScope = {
    global: normalizeRecord(variables),
    local: {},
    temp: {},
  };
  const operatorMatch = findRuntimeConditionOperator(trimmed);

  if (operatorMatch.operator && typeof operatorMatch.index === "number") {
    const leftToken = trimmed.slice(0, operatorMatch.index).trim();
    const rightToken = trimmed
      .slice(operatorMatch.index + operatorMatch.operator.length)
      .trim();

    if (
      !leftToken ||
      !rightToken ||
      /[><=!&|]$/.test(leftToken) ||
      /^[><=!&|]/.test(leftToken) ||
      /[><=!&|]$/.test(rightToken) ||
      /^[><=!&|]/.test(rightToken)
    ) {
      return {
        matched: false,
        rationale: trimmed,
        error: `Invalid condition expression: ${trimmed}`,
      };
    }

    return {
      matched: Boolean(evaluateSimpleExpression(trimmed, context)),
      rationale: trimmed,
    };
  }

  if (/[><=!&|]/.test(trimmed)) {
    return {
      matched: false,
      rationale: trimmed,
      error: `Unsupported condition expression: ${trimmed}`,
    };
  }

  return {
    matched: Boolean(resolveTokenValue(trimmed, context)),
    rationale: trimmed,
  };
}

function evaluateAssignmentValue(
  node: ControlFlowVariableAssignmentNode,
  context: VariableContextByScope
): unknown {
  const config: ControlFlowAssignmentConfig = isRecord(node.config)
    ? node.config
    : {};
  if (typeof config.expression === "string" && config.expression.trim()) {
    return evaluateSimpleExpression(config.expression, context);
  }

  if (typeof config.source === "string" && config.source.trim()) {
    return resolveTokenValue(config.source, context);
  }

  return config.value;
}

function evaluateConditionBranch(
  node: ControlFlowConditionNode,
  context: VariableContextByScope
): { matched: string; rationale?: string } {
  const expression =
    typeof node.config?.expression === "string"
      ? node.config.expression.trim()
      : "";

  const result = expression ? Boolean(evaluateSimpleExpression(expression, context)) : false;

  return {
    matched: result ? "true" : "false",
    rationale: expression || undefined,
  };
}

function buildStartNodePreview(definition: ControlFlowDefinition): string | undefined {
  const parts: string[] = [];
  if (definition.input?.directive) {
    parts.push(`directive: ${definition.input.directive}`);
  }
  if (Array.isArray(definition.input?.attachments)) {
    parts.push(`attachments: ${definition.input.attachments.length}`);
  }
  const globalCount = Object.keys(definition.input?.variables?.global || {}).length;
  if (globalCount > 0) {
    parts.push(`global vars: ${globalCount}`);
  }
  return sanitizePreview(parts.join(" | "));
}

function buildAssignmentNodePreview(
  node: ControlFlowVariableAssignmentNode,
  nextValue: unknown
): string | undefined {
  const target =
    typeof node.config?.target === "string" ? node.config.target : "unknown";
  const scope =
    node.config?.scope === "local" || node.config?.scope === "temp"
      ? node.config.scope
      : "global";
  return sanitizePreview(`${scope}.${target} = ${JSON.stringify(nextValue)}`);
}

function buildConditionNodePreview(
  matched: string,
  rationale?: string
): string | undefined {
  const branch = `branch: ${matched}`;
  return sanitizePreview(rationale ? `${branch} (${rationale})` : branch);
}

function buildEndNodePreview(
  outputValue: unknown
): string | undefined {
  return sanitizePreview(outputValue);
}

function graphStatusFromNodeState(input: {
  visited: boolean;
  current: boolean;
  blocked: boolean;
  error?: string;
}): GraphNodeRunSnapshot["status"] {
  if (input.error) {
    return "EXCEPTION";
  }
  if (input.current) {
    return "EXECUTING";
  }
  if (input.visited) {
    return "EXECUTED";
  }
  if (input.blocked) {
    return "PENDING";
  }
  return "PENDING";
}

function buildNodeRunSnapshot(
  node: ControlFlowNode,
  options: {
    visitedNodeIds: Set<string>;
    currentNodeId?: string;
    blockedNodeIds: Set<string>;
    errors: Record<string, string>;
    variableChanges: Map<string, ControlFlowVariableChange>;
    branchHits: Record<string, string>;
    output?: unknown;
    context: VariableContextByScope;
    definition: ControlFlowDefinition;
  }
): GraphNodeRunSnapshot {
  const visited = options.visitedNodeIds.has(node.id);
  const current = options.currentNodeId === node.id;
  const error = options.errors[node.id];
  let outputPreview: string | undefined;

  if (node.type === "start") {
    outputPreview = buildStartNodePreview(options.definition);
  }

  if (node.type === "variable_assignment") {
    const variableChange = options.variableChanges.get(node.id);
    outputPreview = buildAssignmentNodePreview(node, variableChange?.nextValue);
  }

  if (node.type === "condition") {
    outputPreview = buildConditionNodePreview(
      options.branchHits[node.id] || "pending",
      typeof node.config?.expression === "string" ? node.config.expression : undefined
    );
  }

  if (node.type === "end") {
    if (visited || current) {
      const configOutput =
        typeof node.config?.output === "string"
          ? resolveTokenValue(node.config.output, options.context)
          : options.output;
      outputPreview = buildEndNodePreview(configOutput);
    }
  }

  return {
    nodeId: node.id,
    title: node.label || node.type,
    status: graphStatusFromNodeState({
      visited,
      current,
      blocked: options.blockedNodeIds.has(node.id),
      error,
    }),
    stageKey: node.type,
    role: node.type,
    departmentLabel: "web-aigc",
    outputPreview,
    error,
  };
}

function buildEdgeTransitions(
  definition: ControlFlowDefinition,
  options: {
    visitedNodeIds: Set<string>;
    branchHits: Record<string, string>;
  }
): GraphEdgeTransitionSnapshot[] {
  return definition.edges.map(edge => {
    const edgeId = edge.id || `${edge.source}->${edge.target}`;
    const sourceVisited = options.visitedNodeIds.has(edge.source);
    const targetVisited = options.visitedNodeIds.has(edge.target);
    let status: GraphEdgeTransitionSnapshot["status"] = "known";

    if (targetVisited && sourceVisited) {
      status = "executed";
    } else if (sourceVisited && edge.branch) {
      const branchHit = options.branchHits[edge.source];
      status = branchHit === edge.branch ? "known" : "blocked";
    }

    return {
      edgeId,
      fromNodeId: edge.source,
      toNodeId: edge.target,
      kind: "control_flow",
      status,
    };
  });
}

function collectBlockedNodeIds(
  definition: ControlFlowDefinition,
  visitedNodeIds: Set<string>,
  branchHits: Record<string, string>
): Set<string> {
  const blocked = new Set<string>();

  for (const edge of definition.edges) {
    if (!edge.branch || !visitedNodeIds.has(edge.source)) {
      continue;
    }

    if (branchHits[edge.source] && branchHits[edge.source] !== edge.branch) {
      blocked.add(edge.target);
    }
  }

  return blocked;
}

function buildDerivedExecution(definition: ControlFlowDefinition): {
  context: VariableContextByScope;
  variableChanges: Map<string, ControlFlowVariableChange>;
  branchHits: Record<string, string>;
  output: unknown;
} {
  const execution = definition.execution || {};
  const context = cloneVariableContext(definition.input?.variables);
  const variableChanges = new Map<string, ControlFlowVariableChange>();
  const branchHits = { ...(execution.branchHits || {}) };
  let output = execution.output;

  const nodeById = new Map(definition.nodes.map(node => [node.id, node]));
  const explicitChanges = Array.isArray(execution.variableChanges)
    ? execution.variableChanges
    : [];
  const explicitChangeByNodeId = new Map(
    explicitChanges.map(change => [change.nodeId, change])
  );
  const visitedNodeIds = Array.isArray(execution.visitedNodeIds)
    ? execution.visitedNodeIds
    : [];
  const currentNodeId =
    typeof execution.currentNodeId === "string" ? execution.currentNodeId : undefined;

  for (const nodeId of visitedNodeIds) {
    const node = nodeById.get(nodeId);
    if (!node) {
      continue;
    }

    if (node.type === "variable_assignment") {
      const explicitChange = explicitChangeByNodeId.get(node.id);
      if (explicitChange) {
        variableChanges.set(node.id, explicitChange);
        context[explicitChange.scope][explicitChange.target] = explicitChange.nextValue;
        continue;
      }

      const target =
        typeof node.config?.target === "string" ? node.config.target.trim() : "";
      if (!target) {
        continue;
      }

      const scope: ControlFlowScope =
        node.config?.scope === "local" || node.config?.scope === "temp"
          ? node.config.scope
          : "global";
      const previousValue = context[scope][target];
      const nextValue = evaluateAssignmentValue(node, context);
      context[scope][target] = nextValue;
      variableChanges.set(node.id, {
        nodeId: node.id,
        scope,
        target,
        previousValue,
        nextValue,
      });
      continue;
    }

    if (node.type === "condition") {
      if (!branchHits[node.id]) {
        const evaluation = evaluateConditionBranch(node, context);
        branchHits[node.id] = evaluation.matched;
      }
      continue;
    }

    if (
      node.type === "end" &&
      output === undefined &&
      typeof node.config?.output === "string"
    ) {
      output = resolveTokenValue(node.config.output, context);
    }
  }

  for (const explicitChange of explicitChanges) {
    if (
      variableChanges.has(explicitChange.nodeId) ||
      (!visitedNodeIds.includes(explicitChange.nodeId) &&
        explicitChange.nodeId !== currentNodeId)
    ) {
      continue;
    }

    variableChanges.set(explicitChange.nodeId, explicitChange);
    context[explicitChange.scope][explicitChange.target] = explicitChange.nextValue;
  }

  return {
    context,
    variableChanges,
    branchHits,
    output,
  };
}

export function supportsWebAigcControlFlowSnapshot(
  workflow: WorkflowRecord
): boolean {
  return Boolean(getControlFlowDefinition(workflow));
}

export function buildWebAigcControlFlowSnapshot(
  input: {
    workflow: WorkflowRecord;
    mission?: MissionRecord;
    messageCount?: number;
    taskCount?: number;
  }
): GraphInstanceSnapshot | null {
  const { workflow, mission, messageCount, taskCount } = input;
  const definition = getControlFlowDefinition(workflow);
  if (!definition) {
    return null;
  }

  const visitedNodeIds = new Set(definition.execution?.visitedNodeIds || []);
  const currentNodeId = definition.execution?.currentNodeId;
  const derivedExecution = buildDerivedExecution(definition);
  const branchHits = derivedExecution.branchHits;
  const errors = definition.execution?.errors || {};
  const variableChanges = derivedExecution.variableChanges;
  const context = derivedExecution.context;
  const blockedNodeIds = collectBlockedNodeIds(definition, visitedNodeIds, branchHits);

  const nodeRuns = definition.nodes.map(node =>
    buildNodeRunSnapshot(node, {
      visitedNodeIds,
      currentNodeId,
      blockedNodeIds,
      errors,
      variableChanges,
      branchHits,
      output: derivedExecution.output,
      context,
      definition,
    })
  );

  const edgeTransitions = buildEdgeTransitions(definition, {
    visitedNodeIds,
    branchHits,
  });

  const errorCount = nodeRuns.filter(node => node.status === "EXCEPTION").length;
  const workflowStatus: GraphInstanceSnapshot["status"] =
    mission?.status === "waiting" || mission?.waitingFor
      ? "WAITING_INPUT"
      : workflow.status === "failed"
        ? "EXCEPTION"
        : workflow.status === "completed" || workflow.status === "completed_with_errors"
          ? "EXECUTED"
          : currentNodeId
            ? "EXECUTING"
            : "PENDING";

  const waitingFor = nodeRuns.find(node => node.status === "EXECUTING")?.title;

  return {
    kind: "graph_instance_snapshot",
    version: 1,
    instanceId: workflow.id,
    workflowId: workflow.id,
    missionId: mission?.id,
    sessionId: mission?.topicId,
    directive:
      definition.input?.directive ||
      workflow.results?.input?.directiveContext ||
      workflow.directive,
    status: workflowStatus,
    workflowStatus: workflow.status,
    missionStatus: mission?.status,
    currentStage: currentNodeId || workflow.current_stage,
    createdAt: workflow.created_at,
    startedAt: workflow.started_at,
    completedAt: workflow.completed_at,
    links: {
      workflowId: workflow.id,
      missionId: mission?.id,
      sessionId: mission?.topicId,
      replayId: workflow.id,
    },
    nodeRuns,
    edgeTransitions,
    telemetry: {
      messageCount: messageCount ?? 0,
      taskCount: taskCount ?? definition.nodes.length,
      errorCount,
      waitingFor: mission?.waitingFor || waitingFor,
    },
  };
}
