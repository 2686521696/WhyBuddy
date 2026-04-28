import { describe, expect, it } from "vitest";

import skeletonDefinition from "../../docs/ue-character/skeleton-definition.json";
import {
  CHARACTER_ANIMATION_STATES,
  CHARACTER_EXPRESSIONS,
  EXPRESSION_MORPH_TARGETS,
  DEFAULT_CHARACTER_STATE_MAPPING,
  UECharacterRuntimeManager,
  createCharacterAnimationStateMachine,
  createExpressionDriver,
  normalizeCharacterCommand,
  resolveInteractionPose,
} from "../ue-character.js";

function collectBoneNames(node: {
  name: string;
  children?: unknown[];
}): string[] {
  const children = Array.isArray(node.children)
    ? (node.children as Array<{ name: string; children?: unknown[] }>)
    : [];

  return [node.name, ...children.flatMap(child => collectBoneNames(child))];
}

describe("UE character animation state machine", () => {
  it("supports the required pet animation states and caps blend time at 0.3s", () => {
    expect(CHARACTER_ANIMATION_STATES).toEqual([
      "idle",
      "walk",
      "work",
      "celebrate",
      "talk",
      "blocked",
    ]);

    const machine = createCharacterAnimationStateMachine();
    const transition = machine.transitionTo("work", { blendTimeSeconds: 0.8 });

    expect(transition).toMatchObject({
      from: "idle",
      to: "work",
      blendTimeSeconds: 0.3,
      expression: "thinking",
    });
    expect(machine.snapshot()).toMatchObject({
      state: "work",
      expression: "thinking",
    });
  });

  it("maps Agent states into character states with deterministic defaults", () => {
    expect(DEFAULT_CHARACTER_STATE_MAPPING).toMatchObject({
      idle: "idle",
      thinking: "work",
      working: "work",
      done: "celebrate",
      error: "blocked",
    });
  });
});

describe("UE character Morph Target expression driver", () => {
  it("normalizes expression targets to UE Morph Target names and blend timing", () => {
    const driver = createExpressionDriver();

    const result = driver.setExpression("happy", 1.4, {
      blendTimeSeconds: 0.5,
    });

    expect(result).toEqual({
      morphTargetName: "Expr_Happy",
      expression: "happy",
      targetWeight: 1,
      blendTimeSeconds: 0.3,
    });
    expect(driver.snapshot().targets).toEqual({
      Expr_Happy: 1,
    });
  });

  it("clears active expressions back to neutral weights", () => {
    const driver = createExpressionDriver();
    driver.setExpression("thinking", 0.6);
    driver.setExpression("sad", 0.5);

    const cleared = driver.clearExpressions({ blendTimeSeconds: 0.15 });

    expect(cleared).toEqual([
      {
        morphTargetName: "Expr_Thinking",
        expression: "thinking",
        targetWeight: 0,
        blendTimeSeconds: 0.15,
      },
      {
        morphTargetName: "Expr_Sad",
        expression: "sad",
        targetWeight: 0,
        blendTimeSeconds: 0.15,
      },
    ]);
    expect(driver.snapshot().targets).toEqual({
      Expr_Thinking: 0,
      Expr_Sad: 0,
    });
  });
});

describe("UE CharacterManager runtime contract", () => {
  it("spawns, despawns, and reuses pooled character records while preserving agent mapping", () => {
    const manager = new UECharacterRuntimeManager({
      mappings: [
        {
          agentId: "agent-alpha",
          characterId: "pet-alpha",
          meshVariant: "cat",
          appearanceVariant: "orange",
          defaultPosition: { x: 10, y: 0, z: 0 },
        },
      ],
    });

    const first = manager.spawnForAgent("agent-alpha");
    expect(first.characterId).toBe("pet-alpha");
    expect(manager.getCharacterIdForAgent("agent-alpha")).toBe("pet-alpha");

    manager.despawnForAgent("agent-alpha");
    expect(manager.getCharacterIdForAgent("agent-alpha")).toBeUndefined();

    const reused = manager.spawnForAgent("agent-beta", {
      meshVariant: "dog",
      appearanceVariant: "blue",
    });

    expect(reused.characterId).toBe("pet-alpha");
    expect(reused.agentId).toBe("agent-beta");
    expect(reused.meshVariant).toBe("dog");
    expect(reused.appearanceVariant).toBe("blue");
  });

  it("applies agent state updates to character animation state and expression", () => {
    const manager = new UECharacterRuntimeManager();
    const character = manager.spawnForAgent("agent-alpha");

    const transition = manager.applyAgentState("agent-alpha", "done");

    expect(transition).toMatchObject({
      characterId: character.characterId,
      from: "idle",
      to: "celebrate",
      expression: "happy",
    });
    expect(manager.getCharacter(character.characterId)?.state).toBe(
      "celebrate"
    );
  });
});

describe("UE character command normalization and interaction helpers", () => {
  it("normalizes character.moveTo into a NavMesh-ready runtime command", () => {
    const normalized = normalizeCharacterCommand({
      jsonrpc: "2.0",
      id: "cmd-1",
      method: "character.moveTo",
      params: {
        characterId: "pet-alpha",
        target: { x: 100, y: 25, z: 0 },
        speed: "walk",
      },
    });

    expect(normalized).toEqual({
      kind: "moveTo",
      requestId: "cmd-1",
      characterId: "pet-alpha",
      target: { x: 100, y: 25, z: 0 },
      speed: "walk",
      navMeshRequired: true,
      onArrivedEvent: {
        type: "character.arrived",
        requestId: "cmd-1",
        characterId: "pet-alpha",
      },
    });
  });

  it("normalizes character.playAnimation with optional expression override", () => {
    const normalized = normalizeCharacterCommand({
      jsonrpc: "2.0",
      id: "cmd-2",
      method: "character.playAnimation",
      params: {
        characterId: "pet-alpha",
        state: "talk",
        expression: "surprised",
      },
    });

    expect(normalized).toEqual({
      kind: "playAnimation",
      requestId: "cmd-2",
      characterId: "pet-alpha",
      state: "talk",
      expression: "surprised",
      blendTimeSeconds: 0.3,
      morphTargetName: "Expr_Surprised",
    });
  });

  it("resolves IK, face-to-face, and LookAt interaction poses from semantic targets", () => {
    expect(
      resolveInteractionPose({
        characterId: "pet-alpha",
        interaction: "use-computer",
        targetId: "desk-01",
      })
    ).toMatchObject({
      state: "work",
      expression: "thinking",
      ikEnabled: true,
      ikChains: ["IK_Arm_L", "IK_Arm_R", "IK_Spine"],
      lookAt: { mode: "object", targetId: "desk-01" },
    });

    expect(
      resolveInteractionPose({
        characterId: "pet-alpha",
        interaction: "face-character",
        targetId: "pet-beta",
      })
    ).toMatchObject({
      state: "talk",
      ikEnabled: false,
      faceTarget: { characterId: "pet-beta" },
      lookAt: { mode: "character", targetId: "pet-beta" },
    });
  });
});

describe("UE character asset contract consistency", () => {
  it("keeps skeleton definition, IK chains, and Morph Target names aligned with runtime constants", () => {
    const skeleton = skeletonDefinition.skeleton;
    const boneNames = collectBoneNames(skeleton.boneHierarchy);

    expect(skeleton.totalBones).toBe(29);
    expect(boneNames).toHaveLength(skeleton.totalBones);
    expect(new Set(boneNames).size).toBe(skeleton.totalBones);
    expect(skeleton.ikChains.map(chain => chain.name)).toEqual([
      "IK_Arm_L",
      "IK_Arm_R",
      "IK_Leg_L",
      "IK_Leg_R",
      "IK_Spine",
    ]);
    for (const chain of skeleton.ikChains) {
      expect(boneNames).toContain(chain.rootBone);
      expect(boneNames).toContain(chain.endEffector);
    }

    expect(skeleton.morphTargets.map(target => target.expression)).toEqual([
      ...CHARACTER_EXPRESSIONS,
    ]);
    expect(skeleton.morphTargets.map(target => target.name)).toEqual(
      CHARACTER_EXPRESSIONS.map(
        expression => EXPRESSION_MORPH_TARGETS[expression]
      )
    );
  });
});
