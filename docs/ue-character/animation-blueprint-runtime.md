# Pet Character Animation Blueprint Runtime

## Scope

This document defines the UE5 editor implementation for pet character animation tasks 2.1 to 2.4. The executable TypeScript contract lives in `shared/ue-character.ts`; the UE Animation Blueprint should mirror those state names, blend limits, and Morph Target names exactly.

## Required Animation Sequences

All animation sequences use `SK_CubePet_Skeleton` and are shared by `SM_CubePet_Cat` and `SM_CubePet_Dog`.

| State       | Sequence asset         | Loop | Minimum clip length | Notes                                                      |
| ----------- | ---------------------- | ---- | ------------------- | ---------------------------------------------------------- |
| `idle`      | `AS_CubePet_Idle`      | Yes  | 2.0s                | Small breathing, blink-friendly neutral pose               |
| `walk`      | `AS_CubePet_Walk`      | Yes  | 1.0s                | Root motion disabled; CharacterMovement drives translation |
| `work`      | `AS_CubePet_Work`      | Yes  | 2.0s                | Seated or standing typing/thinking loop                    |
| `celebrate` | `AS_CubePet_Celebrate` | No   | 1.2s                | Returns to `idle` unless a queued command overrides it     |
| `talk`      | `AS_CubePet_Talk`      | Yes  | 1.0s                | Upper-body conversational motion, mouth/jaw compatible     |
| `blocked`   | `AS_CubePet_Blocked`   | Yes  | 1.5s                | Frustrated or stuck pose, supports angry/sad expression    |

The source repository includes Kenney Cube Pets FBX/GLB/OBJ models under `client/public/kenney_cube-pets_1.0/Models/`. UE import should create the final Skeletal Mesh and animation sequence assets in `/Game/CubePets/Characters/`.

## Animation Blueprint

Create `ABP_CubePet` using `SK_CubePet_Skeleton`.

Blueprint variables:

| Variable            | Type                      | Default   | Purpose                                  |
| ------------------- | ------------------------- | --------- | ---------------------------------------- |
| `CurrentState`      | Enum `ECubePetAnimState`  | `Idle`    | Active animation state                   |
| `RequestedState`    | Enum `ECubePetAnimState`  | `Idle`    | Command target state                     |
| `BlendTimeSeconds`  | Float                     | `0.3`     | Clamped to `0.0..0.3`                    |
| `CurrentExpression` | Enum `ECubePetExpression` | `Neutral` | Active expression                        |
| `ExpressionTargets` | Map Name -> Float         | Empty     | Target Morph Target weights              |
| `LookAtTarget`      | Vector                    | Zero      | Optional head look target in world space |
| `bEnableLookAt`     | Boolean                   | `false`   | Enables head AimOffset/LookAt node       |
| `bEnableIK`         | Boolean                   | `false`   | Enables Control Rig IK pass              |

State enum values must match the shared runtime contract:

```text
idle, walk, work, celebrate, talk, blocked
```

Expression enum values must map to these Morph Targets:

```text
neutral    -> Expr_Neutral
happy      -> Expr_Happy
sad        -> Expr_Sad
thinking   -> Expr_Thinking
surprised  -> Expr_Surprised
angry      -> Expr_Angry
```

## State Machine

Create a single locomotion/action state machine:

```text
Idle
  -> Walk       when RequestedState == walk
  -> Work       when RequestedState == work
  -> Celebrate  when RequestedState == celebrate
  -> Talk       when RequestedState == talk
  -> Blocked    when RequestedState == blocked

Walk
  -> Idle       when RequestedState == idle or MoveTo has arrived
  -> Blocked    when RequestedState == blocked

Work
  -> Idle       when RequestedState == idle
  -> Celebrate  when RequestedState == celebrate
  -> Blocked    when RequestedState == blocked
  -> Talk       when RequestedState == talk

Celebrate
  -> Idle       when sequence remaining time <= 0.1s and no queued state exists
  -> any state   when RequestedState changes

Talk
  -> Idle       when RequestedState == idle
  -> Work       when RequestedState == work
  -> Blocked    when RequestedState == blocked

Blocked
  -> Idle       when blockage clears
  -> Work/Walk/Talk when a new command explicitly replaces blocked
```

Every transition uses a blend duration of `min(requestedBlend, 0.3)`. The shared runtime test covers this cap through `createCharacterAnimationStateMachine()`.

## Default State To Expression Pairing

When `character.playAnimation` omits `expression`, use:

| State       | Default expression | Morph Target weight                            |
| ----------- | ------------------ | ---------------------------------------------- |
| `idle`      | `neutral`          | 0.0                                            |
| `walk`      | `neutral`          | 0.0                                            |
| `work`      | `thinking`         | 0.6                                            |
| `celebrate` | `happy`            | 0.8                                            |
| `talk`      | `neutral`          | 0.0 unless narration sets a phoneme/expression |
| `blocked`   | `angry`            | 0.6                                            |

If the command includes `expression`, it overrides the default expression but does not bypass the animation state transition.

## Morph Target Driver

Implement expression blending in `BP_CubePetCharacter` or a linked Anim Blueprint function:

1. Receive target expression and target weight.
2. Convert expression name to Morph Target name.
3. Clamp weight to `0.0..1.0`.
4. Clamp blend time to `0.0..0.3`.
5. Interpolate current weight with constant or eased interpolation each Tick.
6. Call `Set Morph Target` for each active target.

Only two non-neutral expressions should be active at the same time. If a third expression arrives, fade out the lowest-priority active expression first.

## UE Editor Checklist

- [ ] Import `animal-cat.fbx` and `animal-dog.fbx` as Skeletal Meshes bound to `SK_CubePet_Skeleton`.
- [ ] Create `AS_CubePet_Idle`, `AS_CubePet_Walk`, `AS_CubePet_Work`, `AS_CubePet_Celebrate`, `AS_CubePet_Talk`, and `AS_CubePet_Blocked`.
- [ ] Create `ECubePetAnimState` with the six required values.
- [ ] Create `ECubePetExpression` with the six required values.
- [ ] Create `ABP_CubePet` and wire the state machine transitions above.
- [ ] Verify every transition blend duration is `<= 0.3`.
- [ ] Verify all six Morph Target names exist on both Cat and Dog Skeletal Meshes.
- [ ] Trigger `character.playAnimation` for every state and verify no T-pose appears.
