import type {
  AddProjectRouteInput,
  Project,
  ProjectMessage,
  ProjectRouteKind,
  ProjectRouteRiskLevel,
  ProjectRouteStep,
  ProjectSpec,
  LinkProjectMissionInput,
} from "./project-store";

export type ProjectRoutePlannerMode =
  | "recommended"
  | "fast"
  | "deep"
  | "conservative";

export interface BuildProjectRoutePlanInput {
  project: Project;
  currentSpec: ProjectSpec | null;
  recentMessages?: ProjectMessage[];
  modes?: ProjectRoutePlannerMode[];
}

export interface ProjectRouteCandidate extends AddProjectRouteInput {
  mode: ProjectRoutePlannerMode;
  rationale: string;
}

export interface ProjectRoutePlan {
  projectId: string;
  specId?: string;
  candidates: ProjectRouteCandidate[];
}

export interface BuildMissionPlanFromRouteInput {
  route: {
    id: string;
    projectId: string;
    specId?: string;
    kind: ProjectRouteKind;
    title: string;
    summary: string;
  };
  missionId?: string;
}

export interface ProjectRouteMissionPlan extends LinkProjectMissionInput {
  title: string;
  summary: string;
  routeKind: ProjectRouteKind;
}

interface RouteTemplate {
  kind: ProjectRouteKind;
  title: string;
  summary: string;
  riskLevel: ProjectRouteRiskLevel;
  estimate: string;
  rationale: string;
  steps: Array<Omit<ProjectRouteStep, "id" | "status">>;
}

const DEFAULT_MODES: ProjectRoutePlannerMode[] = [
  "recommended",
  "fast",
  "deep",
  "conservative",
];

function normalizeText(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function createRouteStepId(mode: ProjectRoutePlannerMode, index: number) {
  return `route-${mode}-step-${index + 1}`;
}

function summarizeSpec(spec: ProjectSpec | null, project: Project) {
  return normalizeText(spec?.title) || `${project.name} spec`;
}

function hasRiskSignal(input: BuildProjectRoutePlanInput) {
  const text = [
    input.project.goal,
    input.project.summary,
    input.currentSpec?.content,
    ...(input.recentMessages ?? []).map(message => message.content),
  ]
    .join(" ")
    .toLowerCase();
  return /risk|security|compliance|migration|production|privacy|permission|audit/.test(
    text
  );
}

function buildTemplate(
  mode: ProjectRoutePlannerMode,
  input: BuildProjectRoutePlanInput
): RouteTemplate {
  const specLabel = summarizeSpec(input.currentSpec, input.project);
  const riskAware = hasRiskSignal(input);

  if (mode === "fast") {
    return {
      kind: "fast",
      title: "Fast Validation Route",
      summary: `Turn ${specLabel} into the smallest reviewable delivery slice.`,
      riskLevel: riskAware ? "medium" : "low",
      estimate: "Short",
      rationale: "Best when the project needs a quick proof before deeper planning.",
      steps: [
        {
          title: "Slice the spec",
          description: "Identify the thinnest project outcome that can prove the core intent.",
          role: "Planner",
        },
        {
          title: "Build the first executable increment",
          description: "Use FSD role capabilities internally to produce a reviewable artifact.",
          role: "Builder",
        },
        {
          title: "Capture decision evidence",
          description: "Record what was validated and what must move to the next route.",
          role: "Reviewer",
        },
      ],
    };
  }

  if (mode === "deep") {
    return {
      kind: "deep",
      title: "Deep Design Route",
      summary: `Expand ${specLabel} into architecture, delivery plan, and evidence checkpoints.`,
      riskLevel: riskAware ? "high" : "medium",
      estimate: "Long",
      rationale: "Best when ambiguity, integration scope, or review cost is high.",
      steps: [
        {
          title: "Model domain and constraints",
          description: "Turn the accepted spec into explicit boundaries, risks, and assumptions.",
          role: "Architect",
        },
        {
          title: "Plan delivery slices",
          description: "Map FSD roles to implementation, review, and evidence responsibilities.",
          role: "Planner",
        },
        {
          title: "Run evidence-backed execution",
          description: "Execute with checkpoints that preserve artifacts and decisions.",
          role: "Executor",
        },
      ],
    };
  }

  if (mode === "conservative") {
    return {
      kind: "conservative",
      title: "Conservative Control Route",
      summary: `Protect ${specLabel} with review gates before execution starts.`,
      riskLevel: "low",
      estimate: "Medium",
      rationale: "Best when reversibility, approvals, or production safety matter most.",
      steps: [
        {
          title: "Confirm assumptions",
          description: "Review open questions, defaults, and spec sources before committing.",
          role: "Reviewer",
        },
        {
          title: "Prepare rollback-safe work",
          description: "Break execution into guarded changes with clear stop points.",
          role: "Planner",
        },
        {
          title: "Execute with approval checkpoints",
          description: "Collect evidence at each gate before continuing.",
          role: "Operator",
        },
      ],
    };
  }

  return {
    kind: "recommended",
    title: "Recommended FSD Route",
    summary: `Route ${specLabel} through clarification, planning, execution, and evidence review.`,
    riskLevel: riskAware ? "medium" : "low",
    estimate: "Medium",
    rationale: "Best default for moving from a current spec into coordinated FSD execution.",
    steps: [
      {
        title: "Align on spec intent",
        description: "Confirm the project outcome and constraints represented by the current spec.",
        role: "Planner",
      },
      {
        title: "Coordinate FSD roles",
        description: "Assign internal role capabilities for design, implementation, and review.",
        role: "Coordinator",
      },
      {
        title: "Execute and preserve evidence",
        description: "Deliver the chosen slice while linking artifacts and decisions back to the route.",
        role: "Executor",
      },
    ],
  };
}

export function buildProjectRoutePlan({
  modes = DEFAULT_MODES,
  ...input
}: BuildProjectRoutePlanInput): ProjectRoutePlan {
  const uniqueModes = Array.from(new Set(modes)).filter(mode =>
    DEFAULT_MODES.includes(mode)
  );
  const selectedModes = uniqueModes.length ? uniqueModes : DEFAULT_MODES;

  return {
    projectId: input.project.id,
    specId: input.currentSpec?.id,
    candidates: selectedModes.map(mode => {
      const template = buildTemplate(mode, input);
      return {
        projectId: input.project.id,
        specId: input.currentSpec?.id,
        mode,
        kind: template.kind,
        title: template.title,
        summary: template.summary,
        riskLevel: template.riskLevel,
        estimate: template.estimate,
        rationale: template.rationale,
        steps: template.steps.map((step, index) => ({
          id: createRouteStepId(mode, index),
          status: "pending",
          ...step,
        })),
      };
    }),
  };
}

export function buildMissionPlanFromRoute({
  route,
  missionId,
}: BuildMissionPlanFromRouteInput): ProjectRouteMissionPlan {
  return {
    projectId: route.projectId,
    specId: route.specId,
    routeId: route.id,
    missionId: missionId?.trim() || `route-${route.id}-mission`,
    status: "queued",
    title: route.title,
    summary: route.summary,
    routeKind: route.kind,
  };
}
