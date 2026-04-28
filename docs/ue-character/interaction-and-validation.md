# Pet Character Interaction And Validation

## Scope

This document completes tasks 5.1 to 6.2. It defines IK interaction poses, face-to-face dialogue posture, head LookAt behavior, animation transition validation, and four-character performance checks.

## Interaction Pose Contract

The shared helper `resolveInteractionPose()` maps semantic interaction requests to animation, expression, IK, and LookAt data.

| Interaction      | State  | Expression | IK chains                          | LookAt                |
| ---------------- | ------ | ---------- | ---------------------------------- | --------------------- |
| `sit-chair`      | `idle` | `neutral`  | `IK_Leg_L`, `IK_Leg_R`, `IK_Spine` | Optional chair/object |
| `use-computer`   | `work` | `thinking` | `IK_Arm_L`, `IK_Arm_R`, `IK_Spine` | Target desk/computer  |
| `face-character` | `talk` | `neutral`  | None                               | Other character       |
| `look-at-camera` | `idle` | `neutral`  | None                               | Active camera         |
| `look-at-object` | `idle` | `neutral`  | None                               | Target object         |

## IK Implementation

Use `IKRig_CubePet` and a Control Rig pass in `ABP_CubePet`.

Required IK chains:

| Chain      | Root         | End effector | Use                                      |
| ---------- | ------------ | ------------ | ---------------------------------------- |
| `IK_Arm_L` | `Clavicle_L` | `Hand_L`     | Keyboard, object touch, desk interaction |
| `IK_Arm_R` | `Clavicle_R` | `Hand_R`     | Keyboard, object touch, desk interaction |
| `IK_Leg_L` | `Thigh_L`    | `Foot_L`     | Sitting and foot placement               |
| `IK_Leg_R` | `Thigh_R`    | `Foot_R`     | Sitting and foot placement               |
| `IK_Spine` | `Pelvis`     | `Spine_02`   | Leaning forward while working or sitting |

IK should be layered after the base animation state machine. Blend IK weight over `0.15..0.3s` to avoid popping.

## Scene Object Interaction

### Chair

1. Place `PetInteractionSocket` on each chair.
2. Socket metadata includes seat location, seat forward vector, and foot placement offsets.
3. Move character to socket with `character.moveTo`.
4. On arrival, set state to `idle`, enable leg/spine IK, align pelvis to seat transform.
5. Disable IK and transition to `walk` before leaving.

### Computer

1. Place `PetInteractionSocket` on each desk or computer.
2. Socket metadata includes left/right hand targets and screen LookAt target.
3. Move character to work position.
4. On arrival, set state to `work`, expression to `thinking`, enable both arm IK chains and spine IK.
5. Use low-amplitude hand motion over IK targets for typing.

## Face-To-Face Dialogue

For two characters:

1. Compute midpoint and facing directions from both character positions.
2. Rotate both characters toward each other using yaw-only interpolation.
3. Set both states to `talk`.
4. Enable head LookAt for each character targeting the other character's `Head` socket.
5. Keep distance in the `100..160cm` range; if closer, step one character backward before starting dialogue.

For group dialogue, the active speaker faces the average listener position and listeners LookAt the active speaker.

## Head LookAt

Use a head AimOffset or Control Rig LookAt node:

- Source bone: `Head`
- Optional eye bones: `Eye_L`, `Eye_R`
- Yaw clamp: `-55..55` degrees
- Pitch clamp: `-30..35` degrees
- Blend in/out: `0.2s`
- Priority order: explicit command target > dialogue partner > active camera > none

Never rotate `Root` or `Pelvis` for head-only LookAt. If the target exceeds head clamp, rotate the actor body with a slower yaw interpolation.

## Animation Transition Validation

In UE editor PIE, run this sequence for both Cat and Dog:

```text
idle -> walk -> idle
idle -> work -> celebrate -> idle
idle -> talk -> idle
idle -> blocked -> idle
walk -> blocked -> idle
work -> talk -> work -> idle
```

Acceptance:

- Every transition blend is `<= 0.3s`.
- No T-pose, snap, or foot sliding spike appears at transition start.
- Expression transitions remain independent from body animation transitions.
- `celebrate` exits to `idle` when the one-shot animation finishes.
- `blocked` can interrupt any state.

## Four-Character Performance Validation

Scene setup:

- Spawn four active pets.
- Use at least two mesh variants and all four material variants.
- Run one `walk`, one `work`, one `talk`, and one `idle` character at the same time.
- Enable LookAt on at least two characters.
- Enable IK on at least one computer interaction and one chair interaction.

Metrics to capture:

| Metric                     | Target                                              |
| -------------------------- | --------------------------------------------------- |
| Game thread frame time     | `<= 16.7ms` target for 60 fps, `<= 33.3ms` hard cap |
| Draw calls per character   | 1 base material slot, excluding shadows             |
| Skeletal mesh triangles    | `<= 5000` LOD0 per character                        |
| Animation blueprint update | No recurring warnings or blueprint VM spikes        |
| Morph Target update        | No frame hitch when changing expression             |
| NavMesh move command       | Arrival callback emitted exactly once               |

Use `stat unit`, `stat anim`, `stat skeletalmesh`, and `stat navmesh` during validation.

## Verification Evidence Template

Record one line per validation pass:

```text
Date:
Engine version:
Map:
Characters:
Sequence:
Average FPS:
Worst frame time:
Blend defects:
IK defects:
LookAt defects:
Callback result:
Notes:
```

Store screenshots or videos under the UE project artifact folder and link them from the sprint/task handoff.
