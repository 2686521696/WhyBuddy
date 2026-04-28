# Pet Character Asset Production Guidelines

## Scope

This document completes task 6.3. It is the production checklist for artists and technical artists creating Cube Pets character assets for UE5.

## Directory Layout

Use this UE content structure:

```text
/Game/CubePets/
  Characters/
    Skeleton/
      SK_CubePet_Skeleton
      PA_CubePet
      IKRig_CubePet
    Meshes/
      SM_CubePet_Cat
      SM_CubePet_Dog
    Animations/
      AS_CubePet_Idle
      AS_CubePet_Walk
      AS_CubePet_Work
      AS_CubePet_Celebrate
      AS_CubePet_Talk
      AS_CubePet_Blocked
      ABP_CubePet
    Materials/
      M_CubePet_Master
      MI_CubePet_Orange
      MI_CubePet_Blue
      MI_CubePet_Green
      MI_CubePet_Purple
    Textures/
      T_CubePet_Cat_Albedo
      T_CubePet_Cat_Normal
      T_CubePet_Cat_ORM
      T_CubePet_Dog_Albedo
      T_CubePet_Dog_Normal
      T_CubePet_Dog_ORM
```

## Source Asset Inputs

The repository already carries Kenney Cube Pets source assets:

```text
client/public/kenney_cube-pets_1.0/Models/FBX format/animal-cat.fbx
client/public/kenney_cube-pets_1.0/Models/FBX format/animal-dog.fbx
client/public/kenney_cube-pets_1.0/Models/GLB format/animal-cat.glb
client/public/kenney_cube-pets_1.0/Models/GLB format/animal-dog.glb
client/public/kenney_cube-pets_1.0/Models/OBJ format/animal-cat.obj
client/public/kenney_cube-pets_1.0/Models/OBJ format/animal-dog.obj
```

Use Cat and Dog as the first two required body types. Other Kenney animals may become later mesh variants only after they are retargeted to `SK_CubePet_Skeleton`.

## Naming Rules

| Asset type          | Pattern                                       | Example               |
| ------------------- | --------------------------------------------- | --------------------- |
| Skeleton            | `SK_{Family}_Skeleton`                        | `SK_CubePet_Skeleton` |
| Skeletal Mesh       | `SM_CubePet_{Variant}`                        | `SM_CubePet_Cat`      |
| Physics Asset       | `PA_CubePet_{Variant}` or shared `PA_CubePet` | `PA_CubePet`          |
| Animation Sequence  | `AS_CubePet_{State}`                          | `AS_CubePet_Work`     |
| Animation Blueprint | `ABP_CubePet`                                 | `ABP_CubePet`         |
| Material            | `M_CubePet_{Purpose}`                         | `M_CubePet_Master`    |
| Material Instance   | `MI_CubePet_{Variant}`                        | `MI_CubePet_Blue`     |
| Texture             | `T_CubePet_{Variant}_{Map}`                   | `T_CubePet_Cat_ORM`   |

## Geometry Requirements

- LOD0 triangle count must be `<= 5000` per character.
- Cat target triangle count: `<= 4500`.
- Dog target triangle count: `<= 4800`.
- Maximum bone influences per vertex: `<= 4`.
- Single material slot for the body mesh.
- Root at world origin and foot base centered.
- Forward axis `+X`, up axis `+Z`, centimeters.

## Skeleton Requirements

Every character must bind to `SK_CubePet_Skeleton`.

Required high-level hierarchy:

```text
Root -> Pelvis -> Spine_01 -> Spine_02 -> Neck -> Head
Spine_02 -> Clavicle_L/R -> UpperArm_L/R -> LowerArm_L/R -> Hand_L/R
Pelvis -> Thigh_L/R -> Calf_L/R -> Foot_L/R
```

Do not add variant-specific bones without versioning the skeleton and reviewing animation compatibility.

## Morph Target Requirements

Each Skeletal Mesh must include:

```text
Expr_Neutral
Expr_Happy
Expr_Sad
Expr_Thinking
Expr_Surprised
Expr_Angry
```

Rules:

- Weight range is `0.0..1.0`.
- Weight `0.0` must match the base pose.
- No face mesh self-intersection at weight `1.0`.
- At least these combinations must remain stable: Happy+Surprised, Sad+Thinking, Sad+Angry.
- Runtime expression blend duration must be `<= 0.3s`.

## Material Requirements

Use `M_CubePet_Master` with four material instances:

| Instance            | Primary   | Secondary | Accent    | Eye       |
| ------------------- | --------- | --------- | --------- | --------- |
| `MI_CubePet_Orange` | `#E8822A` | `#F5DCC0` | `#C45A1E` | `#4CAF50` |
| `MI_CubePet_Blue`   | `#5B9BD5` | `#E8F0F8` | `#FFFFFF` | `#FFB74D` |
| `MI_CubePet_Green`  | `#7BA67B` | `#D4C4A8` | `#6B4226` | `#E6A832` |
| `MI_CubePet_Purple` | `#6A3D9A` | `#C9A0DC` | `#FFD700` | `#FFD700` |

Material slot count must remain one. Runtime changes should use Material Instance or Dynamic Material Instance parameters, not mesh swaps.

## Animation Requirements

Create the six required state clips:

```text
Idle, Walk, Work, Celebrate, Talk, Blocked
```

Requirements:

- All clips use `SK_CubePet_Skeleton`.
- Walk uses in-place movement unless a future locomotion pass explicitly enables root motion.
- Celebrate is a one-shot sequence.
- Idle, Walk, Work, Talk, and Blocked are loops.
- Animation Blueprint transition blend duration is capped to `0.3s`.
- All clips must work on Cat and Dog without obvious mesh penetration.

## Import Checklist

- [ ] Import skeleton and mesh in centimeters.
- [ ] Import normals and tangents.
- [ ] Disable automatic material import for production assets.
- [ ] Enable Morph Target import.
- [ ] Bind Cat and Dog to `SK_CubePet_Skeleton`.
- [ ] Assign `M_CubePet_Master` or the selected material instance.
- [ ] Configure LOD0/LOD1/LOD2.
- [ ] Build `PA_CubePet` collision bodies for pelvis, spine, head, arms, and legs.
- [ ] Create `IKRig_CubePet` and all required IK chains.

## Final Acceptance

- [ ] Both Cat and Dog spawn through CharacterManager.
- [ ] Four appearances can be applied without changing mesh or skeleton.
- [ ] Six animation states can be triggered by `character.playAnimation`.
- [ ] `character.moveTo` uses NavMesh and emits `character.arrived`.
- [ ] IK chair and computer interactions work.
- [ ] Face-to-face dialogue and head LookAt work.
- [ ] Four characters can run on screen within the performance target.
- [ ] Shared tests pass: `npx vitest run --config vitest.config.server.ts shared/__tests__/ue-character-runtime.test.ts --pool=forks --poolOptions.forks.singleFork`.
