# Pet CharacterManager Runtime

## Scope

This document completes tasks 3.1 to 4.3 for the repository-level contract. The shared implementation in `shared/ue-character.ts` defines deterministic behavior that UE Blueprint/C++ should mirror.

## Runtime Responsibilities

`CharacterManager` owns:

- Character pool: spawn, despawn, and reuse pet actors.
- `agentId -> characterId` mapping.
- Agent state to character animation state mapping.
- Dynamic add/remove when an Agent enters or leaves the scene.
- `character.moveTo` and `character.playAnimation` command handling.
- Arrival callback event for movement completion.

## Agent Mapping

Configuration shape:

```ts
interface AgentCharacterMapping {
  agentId: string;
  characterId: string;
  meshVariant: "cat" | "dog";
  appearanceVariant: "orange" | "blue" | "green" | "purple";
  defaultPosition: { x: number; y: number; z: number };
  stateMapping?: Record<
    string,
    "idle" | "walk" | "work" | "celebrate" | "talk" | "blocked"
  >;
}
```

Default state mapping:

| Agent state | Character state |
| ----------- | --------------- |
| `idle`      | `idle`          |
| `thinking`  | `work`          |
| `working`   | `work`          |
| `active`    | `work`          |
| `done`      | `celebrate`     |
| `completed` | `celebrate`     |
| `error`     | `blocked`       |
| `blocked`   | `blocked`       |
| `waiting`   | `idle`          |
| `offline`   | `idle`          |

Project-specific mappings may override these defaults per Agent.

## Character Pool

Spawn flow:

1. If the Agent already has a mapped active character, return that character.
2. If the Agent has a configured `characterId`, use it.
3. Otherwise reuse the first inactive pooled character.
4. Otherwise create a new character id using `pet-runtime-XX`.
5. Apply mesh variant, appearance variant, default transform, and idle state.
6. Register `agentId -> characterId`.

Despawn flow:

1. Resolve `agentId -> characterId`.
2. Mark the character inactive.
3. Clear Agent binding.
4. Reset animation state to `idle` and expression to `neutral`.
5. Push the character into the reuse pool.

UE implementation note: use hidden/inactive `BP_CubePetCharacter` actors rather than destroying them during normal Agent churn. Destroy only when unloading the scene or shrinking the pool.

## Command Protocol

### `character.moveTo`

Input:

```json
{
  "jsonrpc": "2.0",
  "id": "cmd-1",
  "method": "character.moveTo",
  "params": {
    "characterId": "pet-alpha",
    "target": { "x": 100, "y": 25, "z": 0 },
    "speed": "walk"
  }
}
```

Normalized runtime command:

```ts
{
  kind: "moveTo",
  requestId: "cmd-1",
  characterId: "pet-alpha",
  target: { x: 100, y: 25, z: 0 },
  speed: "walk",
  navMeshRequired: true,
  onArrivedEvent: {
    type: "character.arrived",
    requestId: "cmd-1",
    characterId: "pet-alpha"
  }
}
```

UE handling:

1. Resolve `characterId` to `BP_CubePetCharacter`.
2. Validate target is projected onto NavMesh with `ProjectPointToNavigation`.
3. Set animation state to `walk`.
4. Call `AI MoveTo` or `Simple Move to Location`.
5. On success or acceptable radius reached, set animation state to `idle`.
6. Emit `character.arrived` with the original `requestId`.
7. On path failure, set state to `blocked` and emit command error.

### `character.playAnimation`

Input:

```json
{
  "jsonrpc": "2.0",
  "id": "cmd-2",
  "method": "character.playAnimation",
  "params": {
    "characterId": "pet-alpha",
    "state": "talk",
    "expression": "surprised"
  }
}
```

Normalized runtime command:

```ts
{
  kind: "playAnimation",
  requestId: "cmd-2",
  characterId: "pet-alpha",
  state: "talk",
  expression: "surprised",
  blendTimeSeconds: 0.3,
  morphTargetName: "Expr_Surprised"
}
```

UE handling:

1. Resolve `characterId`.
2. Set `RequestedState` on `ABP_CubePet`.
3. Clamp blend time to `<= 0.3`.
4. Resolve expression override or default state expression.
5. Set Morph Target target weights through the expression driver.

## Arrival Callback Event

Event shape:

```json
{
  "type": "character.arrived",
  "requestId": "cmd-1",
  "characterId": "pet-alpha"
}
```

The event must be sent once per accepted move command. If movement is interrupted by a newer command, send the command-level cancellation/error event instead of `character.arrived`.

## UE Editor/C++ Checklist

- [ ] Create `BP_CharacterManager` or `ACubePetCharacterManager`.
- [ ] Add `AgentCharacterMap` and `CharacterPool`.
- [ ] Implement `SpawnForAgent`, `DespawnForAgent`, `RemoveCharacter`, and `ApplyAgentState`.
- [ ] Add hot-reload support for Agent mapping config.
- [ ] Implement `HandleCharacterMoveTo` with NavMesh projection and arrival callback.
- [ ] Implement `HandleCharacterPlayAnimation`.
- [ ] Emit command success/error responses using the scene command protocol.
- [ ] Verify the shared tests in `shared/__tests__/ue-character-runtime.test.ts` still pass after contract changes.
