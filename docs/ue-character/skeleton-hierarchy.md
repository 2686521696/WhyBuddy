# 宠物角色统一骨骼层级规范

## 概述

本文档定义 Cube Pets 宠物角色系统的统一骨骼层级结构（USkeleton）。所有宠物角色共享同一套骨骼，通过 Skeletal Mesh 切换外观，确保动画资产可在不同角色间复用。

- **USkeleton 资产名称**：`SK_CubePet_Skeleton`
- **适用引擎**：Unreal Engine 5
- **目标面数**：≤ 5000 三角面（单角色）

---

## 骨骼层级树

```
Root
└── Pelvis
    ├── Spine_01
    │   └── Spine_02
    │       ├── Neck
    │       │   └── Head
    │       │       ├── Eye_L
    │       │       ├── Eye_R
    │       │       └── Jaw
    │       ├── Clavicle_L
    │       │   └── UpperArm_L
    │       │       └── LowerArm_L
    │       │           └── Hand_L
    │       │               ├── Index_01_L
    │       │               └── Thumb_01_L
    │       └── Clavicle_R
    │           └── UpperArm_R
    │               └── LowerArm_R
    │                   └── Hand_R
    │                       ├── Index_01_R
    │                       └── Thumb_01_R
    ├── Thigh_L
    │   └── Calf_L
    │       └── Foot_L
    │           └── Toe_L
    └── Thigh_R
        └── Calf_R
            └── Foot_R
                └── Toe_R
```

---

## 骨骼命名规范

遵循 UE5 标准命名约定：

| 规则              | 说明                                    | 示例                       |
| ----------------- | --------------------------------------- | -------------------------- |
| 驼峰 + 下划线分隔 | 部位名使用 PascalCase，层级编号用下划线 | `Spine_01`、`Spine_02`     |
| 左右后缀          | 对称骨骼使用 `_L` / `_R` 后缀           | `UpperArm_L`、`UpperArm_R` |
| 编号从 01 开始    | 链式骨骼使用两位数字编号                | `Spine_01`、`Index_01_L`   |
| 根骨骼            | 始终命名为 `Root`，位于世界原点         | `Root`                     |
| 骨盆              | 作为身体层级的起点                      | `Pelvis`                   |

### 骨骼总数

| 区域      | 骨骼数                                |
| --------- | ------------------------------------- |
| 根 + 躯干 | 4（Root, Pelvis, Spine_01, Spine_02） |
| 头部      | 5（Neck, Head, Eye_L, Eye_R, Jaw）    |
| 左臂      | 6（Clavicle_L → Thumb_01_L）          |
| 右臂      | 6（Clavicle_R → Thumb_01_R）          |
| 左腿      | 4（Thigh_L → Toe_L）                  |
| 右腿      | 4（Thigh_R → Toe_R）                  |
| **合计**  | **29**                                |

---

## IK 链定义

为支持角色与场景物体的交互动画（如坐椅子、用电脑），定义以下 IK 链：

### 左臂 IK（IK_Arm_L）

| 属性       | 值                                     |
| ---------- | -------------------------------------- |
| 链名称     | `IK_Arm_L`                             |
| 根骨骼     | `Clavicle_L`                           |
| 末端效应器 | `Hand_L`                               |
| 用途       | 手部与场景物体交互（抓取、触摸、打字） |

### 右臂 IK（IK_Arm_R）

| 属性       | 值                                     |
| ---------- | -------------------------------------- |
| 链名称     | `IK_Arm_R`                             |
| 根骨骼     | `Clavicle_R`                           |
| 末端效应器 | `Hand_R`                               |
| 用途       | 手部与场景物体交互（抓取、触摸、打字） |

### 左腿 IK（IK_Leg_L）

| 属性       | 值                     |
| ---------- | ---------------------- |
| 链名称     | `IK_Leg_L`             |
| 根骨骼     | `Thigh_L`              |
| 末端效应器 | `Foot_L`               |
| 用途       | 脚部地面适配、坐姿调整 |

### 右腿 IK（IK_Leg_R）

| 属性       | 值                     |
| ---------- | ---------------------- |
| 链名称     | `IK_Leg_R`             |
| 根骨骼     | `Thigh_R`              |
| 末端效应器 | `Foot_R`               |
| 用途       | 脚部地面适配、坐姿调整 |

### 脊柱 IK（IK_Spine）

| 属性       | 值                 |
| ---------- | ------------------ |
| 链名称     | `IK_Spine`         |
| 根骨骼     | `Pelvis`           |
| 末端效应器 | `Spine_02`         |
| 用途       | 躯干弯曲、前倾姿态 |

---

## 导出规范

### FBX 导出设置

| 参数         | 值                                     |
| ------------ | -------------------------------------- |
| 格式         | FBX 2020                               |
| 缩放因子     | 1.0（1 单位 = 1 厘米，UE5 默认）       |
| 坐标轴       | 前方 = +X，上方 = +Z（UE5 左手坐标系） |
| 骨骼导出     | 包含完整骨骼层级                       |
| 网格导出     | 三角化，≤ 5000 三角面                  |
| 动画导出     | 单独 FBX 文件，引用同一骨骼            |
| 平滑组       | 启用                                   |
| 切线与副法线 | 导出                                   |

### UE5 导入设置

| 参数          | 值                          |
| ------------- | --------------------------- |
| Skeleton 资产 | `SK_CubePet_Skeleton`       |
| 导入网格      | 是                          |
| 导入动画      | 按需（动画单独导入时选否）  |
| 材质导入      | 不导入（使用 UE5 材质实例） |
| 法线导入方式  | Import Normals and Tangents |
| 转换场景单位  | 启用                        |

### 资产命名约定

| 资产类型      | 命名格式                 | 示例                                 |
| ------------- | ------------------------ | ------------------------------------ |
| USkeleton     | `SK_{角色类型}_Skeleton` | `SK_CubePet_Skeleton`                |
| Skeletal Mesh | `SM_{角色名}`            | `SM_CubePet_Cat`、`SM_CubePet_Dog`   |
| 动画序列      | `AS_{角色类型}_{动作名}` | `AS_CubePet_Idle`、`AS_CubePet_Walk` |
| 动画蓝图      | `ABP_{角色类型}`         | `ABP_CubePet`                        |
| 物理资产      | `PA_{角色类型}`          | `PA_CubePet`                         |
| IK Rig        | `IKRig_{角色类型}`       | `IKRig_CubePet`                      |

---

## Morph Target 表情支持

骨骼结构需配合以下 Morph Target 使用（详见表情系统规范）：

| 表情      | Morph Target 名称 |
| --------- | ----------------- |
| neutral   | `Expr_Neutral`    |
| happy     | `Expr_Happy`      |
| sad       | `Expr_Sad`        |
| thinking  | `Expr_Thinking`   |
| surprised | `Expr_Surprised`  |
| angry     | `Expr_Angry`      |

Morph Target 通过 Skeletal Mesh 的顶点偏移实现，不依赖额外骨骼。

---

## 注意事项

1. **所有宠物角色必须使用 `SK_CubePet_Skeleton`**，不允许创建独立骨骼资产。
2. 新增角色外观时，只需制作新的 Skeletal Mesh 并绑定到统一骨骼。
3. IK 约束在 Animation Blueprint 中通过 Control Rig 节点驱动。
4. 骨骼层级一旦发布，修改需经过版本评审，避免破坏已有动画资产。
5. Root 骨骼必须位于模型脚底中心（世界原点），Pelvis 位于角色重心。
