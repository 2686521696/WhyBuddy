export const CHARACTER_ANIMATION_STATES = [
  "idle",
  "walk",
  "work",
  "celebrate",
  "talk",
  "blocked",
] as const;

export type CharacterAnimationState =
  (typeof CHARACTER_ANIMATION_STATES)[number];

export const CHARACTER_EXPRESSIONS = [
  "neutral",
  "happy",
  "sad",
  "thinking",
  "surprised",
  "angry",
] as const;

export type CharacterExpression = (typeof CHARACTER_EXPRESSIONS)[number];

export const CHARACTER_MESH_VARIANTS = ["cat", "dog"] as const;
export type CharacterMeshVariant = (typeof CHARACTER_MESH_VARIANTS)[number];

export const CHARACTER_APPEARANCE_VARIANTS = [
  "orange",
  "blue",
  "green",
  "purple",
] as const;

export type CharacterAppearanceVariant =
  (typeof CHARACTER_APPEARANCE_VARIANTS)[number];

export const MAX_CHARACTER_BLEND_TIME_SECONDS = 0.3;

export const EXPRESSION_MORPH_TARGETS: Record<
  CharacterExpression,
  `Expr_${string}`
> = {
  neutral: "Expr_Neutral",
  happy: "Expr_Happy",
  sad: "Expr_Sad",
  thinking: "Expr_Thinking",
  surprised: "Expr_Surprised",
  angry: "Expr_Angry",
};

export const DEFAULT_STATE_EXPRESSIONS: Record<
  CharacterAnimationState,
  CharacterExpression
> = {
  idle: "neutral",
  walk: "neutral",
  work: "thinking",
  celebrate: "happy",
  talk: "neutral",
  blocked: "angry",
};

export const DEFAULT_CHARACTER_STATE_MAPPING = {
  idle: "idle",
  thinking: "work",
  working: "work",
  active: "work",
  done: "celebrate",
  completed: "celebrate",
  error: "blocked",
  blocked: "blocked",
  waiting: "idle",
  offline: "idle",
} as const satisfies Record<string, CharacterAnimationState>;

export type AgentCharacterState = keyof typeof DEFAULT_CHARACTER_STATE_MAPPING;

export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export interface AgentCharacterMapping {
  agentId: string;
  characterId: string;
  meshVariant: CharacterMeshVariant;
  appearanceVariant: CharacterAppearanceVariant;
  defaultPosition: Vector3;
  stateMapping?: Partial<Record<string, CharacterAnimationState>>;
}

export interface CharacterTransition {
  characterId?: string;
  from: CharacterAnimationState;
  to: CharacterAnimationState;
  blendTimeSeconds: number;
  expression: CharacterExpression;
  morphTargetName: string;
}

export interface CharacterAnimationSnapshot {
  state: CharacterAnimationState;
  expression: CharacterExpression;
  blendTimeSeconds: number;
}

export interface CharacterAnimationStateMachine {
  transitionTo(
    state: CharacterAnimationState,
    options?: {
      expression?: CharacterExpression;
      blendTimeSeconds?: number;
    }
  ): CharacterTransition;
  snapshot(): CharacterAnimationSnapshot;
}

export interface ExpressionTarget {
  morphTargetName: string;
  expression: CharacterExpression;
  targetWeight: number;
  blendTimeSeconds: number;
}

export interface ExpressionDriver {
  setExpression(
    expression: CharacterExpression,
    targetWeight: number,
    options?: { blendTimeSeconds?: number }
  ): ExpressionTarget;
  clearExpressions(options?: { blendTimeSeconds?: number }): ExpressionTarget[];
  snapshot(): { targets: Record<string, number> };
}

export interface CharacterRuntimeRecord {
  characterId: string;
  agentId: string;
  meshVariant: CharacterMeshVariant;
  appearanceVariant: CharacterAppearanceVariant;
  position: Vector3;
  state: CharacterAnimationState;
  expression: CharacterExpression;
  active: boolean;
}

export type CharacterMoveSpeed = "walk" | "run";

export interface SceneCommandEnvelope {
  jsonrpc?: "2.0";
  id?: string | number;
  method: string;
  params?: Record<string, unknown>;
}

export interface CharacterMoveRuntimeCommand {
  kind: "moveTo";
  requestId: string;
  characterId: string;
  target: Vector3;
  speed: CharacterMoveSpeed;
  navMeshRequired: true;
  onArrivedEvent: {
    type: "character.arrived";
    requestId: string;
    characterId: string;
  };
}

export interface CharacterPlayAnimationRuntimeCommand {
  kind: "playAnimation";
  requestId: string;
  characterId: string;
  state: CharacterAnimationState;
  expression: CharacterExpression;
  blendTimeSeconds: number;
  morphTargetName: string;
}

export type CharacterRuntimeCommand =
  | CharacterMoveRuntimeCommand
  | CharacterPlayAnimationRuntimeCommand;

export type CharacterInteraction =
  | "sit-chair"
  | "use-computer"
  | "face-character"
  | "look-at-camera"
  | "look-at-object";

export interface InteractionPoseRequest {
  characterId: string;
  interaction: CharacterInteraction;
  targetId?: string;
}

export interface CharacterInteractionPose {
  characterId: string;
  state: CharacterAnimationState;
  expression: CharacterExpression;
  ikEnabled: boolean;
  ikChains: string[];
  lookAt?: {
    mode: "camera" | "character" | "object";
    targetId?: string;
  };
  faceTarget?: {
    characterId: string;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeId(value: unknown, fieldName: string): string {
  if (typeof value !== "string" && typeof value !== "number") {
    throw new Error(`${fieldName} is required`);
  }

  const normalized = String(value).trim();
  if (!normalized) {
    throw new Error(`${fieldName} is required`);
  }
  return normalized;
}

function normalizeNumber(value: unknown, fieldName: string): number {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : Number.NaN;

  if (!Number.isFinite(numeric)) {
    throw new Error(`${fieldName} must be a finite number`);
  }
  return numeric;
}

function normalizeVector3(value: unknown, fieldName: string): Vector3 {
  if (!isRecord(value)) {
    throw new Error(`${fieldName} must be a vector`);
  }

  return {
    x: normalizeNumber(value.x, `${fieldName}.x`),
    y: normalizeNumber(value.y, `${fieldName}.y`),
    z: normalizeNumber(value.z, `${fieldName}.z`),
  };
}

function normalizeEnumValue<T extends readonly string[]>(
  value: unknown,
  allowed: T,
  fieldName: string
): T[number] {
  if (typeof value !== "string") {
    throw new Error(`${fieldName} is required`);
  }

  const normalized = value.trim().toLowerCase();
  if (!allowed.includes(normalized)) {
    throw new Error(`${fieldName} must be one of: ${allowed.join(", ")}`);
  }

  return normalized as T[number];
}

function normalizeBlendTime(value: unknown): number {
  if (value === undefined || value === null) {
    return MAX_CHARACTER_BLEND_TIME_SECONDS;
  }

  const numeric = normalizeNumber(value, "blendTimeSeconds");
  return Math.min(MAX_CHARACTER_BLEND_TIME_SECONDS, Math.max(0, numeric));
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

function createCharacterId(index: number): string {
  return `pet-runtime-${String(index).padStart(2, "0")}`;
}

function cloneVector3(value: Vector3): Vector3 {
  return { x: value.x, y: value.y, z: value.z };
}

function defaultPosition(): Vector3 {
  return { x: 0, y: 0, z: 0 };
}

export function createCharacterAnimationStateMachine(
  initialState: CharacterAnimationState = "idle"
): CharacterAnimationStateMachine {
  let state = normalizeEnumValue(
    initialState,
    CHARACTER_ANIMATION_STATES,
    "state"
  );
  let expression = DEFAULT_STATE_EXPRESSIONS[state];
  let blendTimeSeconds = MAX_CHARACTER_BLEND_TIME_SECONDS;

  return {
    transitionTo(nextState, options = {}) {
      const from = state;
      const to = normalizeEnumValue(
        nextState,
        CHARACTER_ANIMATION_STATES,
        "state"
      );
      const nextExpression =
        options.expression ?? DEFAULT_STATE_EXPRESSIONS[to];
      const normalizedExpression = normalizeEnumValue(
        nextExpression,
        CHARACTER_EXPRESSIONS,
        "expression"
      );

      state = to;
      expression = normalizedExpression;
      blendTimeSeconds = normalizeBlendTime(options.blendTimeSeconds);

      return {
        from,
        to,
        blendTimeSeconds,
        expression,
        morphTargetName: EXPRESSION_MORPH_TARGETS[expression],
      };
    },
    snapshot() {
      return {
        state,
        expression,
        blendTimeSeconds,
      };
    },
  };
}

export function createExpressionDriver(): ExpressionDriver {
  const targets = new Map<string, number>();
  const expressionsByMorphTarget = new Map<string, CharacterExpression>();

  return {
    setExpression(expression, targetWeight, options = {}) {
      const normalizedExpression = normalizeEnumValue(
        expression,
        CHARACTER_EXPRESSIONS,
        "expression"
      );
      const morphTargetName = EXPRESSION_MORPH_TARGETS[normalizedExpression];
      const normalizedWeight = clamp01(targetWeight);
      const blendTimeSeconds = normalizeBlendTime(options.blendTimeSeconds);

      targets.set(morphTargetName, normalizedWeight);
      expressionsByMorphTarget.set(morphTargetName, normalizedExpression);

      return {
        morphTargetName,
        expression: normalizedExpression,
        targetWeight: normalizedWeight,
        blendTimeSeconds,
      };
    },
    clearExpressions(options = {}) {
      const blendTimeSeconds = normalizeBlendTime(options.blendTimeSeconds);

      return Array.from(targets.keys()).map(morphTargetName => {
        targets.set(morphTargetName, 0);
        return {
          morphTargetName,
          expression:
            expressionsByMorphTarget.get(morphTargetName) ?? "neutral",
          targetWeight: 0,
          blendTimeSeconds,
        };
      });
    },
    snapshot() {
      return {
        targets: Object.fromEntries(targets.entries()),
      };
    },
  };
}

export class UECharacterRuntimeManager {
  private readonly characters = new Map<string, CharacterRuntimeRecord>();
  private readonly agentToCharacter = new Map<string, string>();
  private readonly mappings = new Map<string, AgentCharacterMapping>();
  private readonly stateMachines = new Map<
    string,
    CharacterAnimationStateMachine
  >();
  private readonly pool: CharacterRuntimeRecord[] = [];
  private nextCharacterIndex = 1;

  constructor(options: { mappings?: AgentCharacterMapping[] } = {}) {
    for (const mapping of options.mappings ?? []) {
      this.mappings.set(mapping.agentId, {
        ...mapping,
        defaultPosition: cloneVector3(mapping.defaultPosition),
      });
    }
  }

  spawnForAgent(
    agentId: string,
    overrides: Partial<
      Pick<
        AgentCharacterMapping,
        "characterId" | "meshVariant" | "appearanceVariant" | "defaultPosition"
      >
    > = {}
  ): CharacterRuntimeRecord {
    const normalizedAgentId = normalizeId(agentId, "agentId");
    const existingCharacterId = this.agentToCharacter.get(normalizedAgentId);
    if (existingCharacterId) {
      const existing = this.characters.get(existingCharacterId);
      if (existing) {
        return existing;
      }
    }

    const mapping = this.mappings.get(normalizedAgentId);
    const pooled = this.pool.shift();
    const characterId =
      overrides.characterId ??
      mapping?.characterId ??
      pooled?.characterId ??
      createCharacterId(this.nextCharacterIndex++);
    const meshVariant =
      overrides.meshVariant ??
      mapping?.meshVariant ??
      pooled?.meshVariant ??
      "cat";
    const appearanceVariant =
      overrides.appearanceVariant ??
      mapping?.appearanceVariant ??
      pooled?.appearanceVariant ??
      "orange";
    const position = cloneVector3(
      overrides.defaultPosition ??
        mapping?.defaultPosition ??
        pooled?.position ??
        defaultPosition()
    );

    const record: CharacterRuntimeRecord = {
      characterId,
      agentId: normalizedAgentId,
      meshVariant,
      appearanceVariant,
      position,
      state: "idle",
      expression: "neutral",
      active: true,
    };

    this.characters.set(characterId, record);
    this.agentToCharacter.set(normalizedAgentId, characterId);
    this.stateMachines.set(
      characterId,
      createCharacterAnimationStateMachine(record.state)
    );

    return record;
  }

  despawnForAgent(agentId: string): CharacterRuntimeRecord | undefined {
    const normalizedAgentId = normalizeId(agentId, "agentId");
    const characterId = this.agentToCharacter.get(normalizedAgentId);
    if (!characterId) {
      return undefined;
    }

    const record = this.characters.get(characterId);
    this.agentToCharacter.delete(normalizedAgentId);

    if (!record) {
      return undefined;
    }

    record.active = false;
    record.agentId = "";
    record.state = "idle";
    record.expression = "neutral";
    this.pool.push(record);
    return record;
  }

  removeCharacter(characterId: string): CharacterRuntimeRecord | undefined {
    const normalizedCharacterId = normalizeId(characterId, "characterId");
    const record = this.characters.get(normalizedCharacterId);
    if (!record) {
      return undefined;
    }

    this.characters.delete(normalizedCharacterId);
    this.stateMachines.delete(normalizedCharacterId);
    if (record.agentId) {
      this.agentToCharacter.delete(record.agentId);
    }
    record.active = false;
    return record;
  }

  getCharacterIdForAgent(agentId: string): string | undefined {
    return this.agentToCharacter.get(agentId);
  }

  getCharacter(characterId: string): CharacterRuntimeRecord | undefined {
    return this.characters.get(characterId);
  }

  listActiveCharacters(): CharacterRuntimeRecord[] {
    return Array.from(this.characters.values()).filter(record => record.active);
  }

  applyAgentState(agentId: string, state: string): CharacterTransition {
    const normalizedAgentId = normalizeId(agentId, "agentId");
    const record =
      this.characters.get(this.agentToCharacter.get(normalizedAgentId) ?? "") ??
      this.spawnForAgent(normalizedAgentId);
    const mapping = this.mappings.get(normalizedAgentId);
    const mappedState =
      mapping?.stateMapping?.[state] ??
      DEFAULT_CHARACTER_STATE_MAPPING[
        state as keyof typeof DEFAULT_CHARACTER_STATE_MAPPING
      ] ??
      "idle";
    const transition = this.transitionCharacter(
      record.characterId,
      mappedState
    );

    return {
      characterId: record.characterId,
      ...transition,
    };
  }

  playAnimation(
    characterId: string,
    state: CharacterAnimationState,
    options: {
      expression?: CharacterExpression;
      blendTimeSeconds?: number;
    } = {}
  ): CharacterTransition {
    const normalizedCharacterId = normalizeId(characterId, "characterId");
    return this.transitionCharacter(normalizedCharacterId, state, options);
  }

  moveCharacter(
    characterId: string,
    target: Vector3
  ): CharacterMoveRuntimeCommand["onArrivedEvent"] {
    const normalizedCharacterId = normalizeId(characterId, "characterId");
    const record = this.characters.get(normalizedCharacterId);
    if (!record) {
      throw new Error(`Unknown characterId: ${normalizedCharacterId}`);
    }

    record.position = cloneVector3(target);
    return {
      type: "character.arrived",
      requestId: `move-${normalizedCharacterId}`,
      characterId: normalizedCharacterId,
    };
  }

  private transitionCharacter(
    characterId: string,
    state: CharacterAnimationState,
    options: {
      expression?: CharacterExpression;
      blendTimeSeconds?: number;
    } = {}
  ): CharacterTransition {
    const record = this.characters.get(characterId);
    if (!record) {
      throw new Error(`Unknown characterId: ${characterId}`);
    }

    const stateMachine =
      this.stateMachines.get(characterId) ??
      createCharacterAnimationStateMachine(record.state);
    this.stateMachines.set(characterId, stateMachine);

    const transition = stateMachine.transitionTo(state, options);
    record.state = transition.to;
    record.expression = transition.expression;

    return {
      characterId,
      ...transition,
    };
  }
}

export function normalizeCharacterCommand(
  command: SceneCommandEnvelope
): CharacterRuntimeCommand {
  const requestId = normalizeId(command.id, "id");
  const params = isRecord(command.params) ? command.params : {};

  if (command.method === "character.moveTo") {
    const characterId = normalizeId(params.characterId, "characterId");
    const target = normalizeVector3(params.target, "target");
    const speed =
      params.speed === undefined
        ? "walk"
        : normalizeEnumValue(params.speed, ["walk", "run"] as const, "speed");

    return {
      kind: "moveTo",
      requestId,
      characterId,
      target,
      speed,
      navMeshRequired: true,
      onArrivedEvent: {
        type: "character.arrived",
        requestId,
        characterId,
      },
    };
  }

  if (command.method === "character.playAnimation") {
    const characterId = normalizeId(params.characterId, "characterId");
    const state = normalizeEnumValue(
      params.state,
      CHARACTER_ANIMATION_STATES,
      "state"
    );
    const expression =
      params.expression === undefined
        ? DEFAULT_STATE_EXPRESSIONS[state]
        : normalizeEnumValue(
            params.expression,
            CHARACTER_EXPRESSIONS,
            "expression"
          );

    return {
      kind: "playAnimation",
      requestId,
      characterId,
      state,
      expression,
      blendTimeSeconds: normalizeBlendTime(params.blendTimeSeconds),
      morphTargetName: EXPRESSION_MORPH_TARGETS[expression],
    };
  }

  throw new Error(`Unsupported character command: ${command.method}`);
}

export function resolveInteractionPose(
  request: InteractionPoseRequest
): CharacterInteractionPose {
  const characterId = normalizeId(request.characterId, "characterId");
  const targetId = request.targetId?.trim();

  switch (request.interaction) {
    case "sit-chair":
      return {
        characterId,
        state: "idle",
        expression: "neutral",
        ikEnabled: true,
        ikChains: ["IK_Leg_L", "IK_Leg_R", "IK_Spine"],
        lookAt: targetId ? { mode: "object", targetId } : undefined,
      };
    case "use-computer":
      return {
        characterId,
        state: "work",
        expression: "thinking",
        ikEnabled: true,
        ikChains: ["IK_Arm_L", "IK_Arm_R", "IK_Spine"],
        lookAt: targetId ? { mode: "object", targetId } : undefined,
      };
    case "face-character": {
      if (!targetId) {
        throw new Error("targetId is required for face-character");
      }
      return {
        characterId,
        state: "talk",
        expression: "neutral",
        ikEnabled: false,
        ikChains: [],
        faceTarget: { characterId: targetId },
        lookAt: { mode: "character", targetId },
      };
    }
    case "look-at-camera":
      return {
        characterId,
        state: "idle",
        expression: "neutral",
        ikEnabled: false,
        ikChains: [],
        lookAt: { mode: "camera" },
      };
    case "look-at-object":
      if (!targetId) {
        throw new Error("targetId is required for look-at-object");
      }
      return {
        characterId,
        state: "idle",
        expression: "neutral",
        ikEnabled: false,
        ikChains: [],
        lookAt: { mode: "object", targetId },
      };
    default: {
      const exhaustive: never = request.interaction;
      throw new Error(`Unsupported interaction: ${exhaustive}`);
    }
  }
}
