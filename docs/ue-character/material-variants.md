# 宠物角色材质系统规格书

## 概述

本文档定义 Cube Pets 宠物角色系统的材质体系，包括 Master Material 参数设计、4 种外观变体的材质实例定义，以及运行时材质切换机制。所有宠物角色（Cat 型与 Dog 型）共享同一套材质系统，通过材质参数切换实现外观变体。

- **适用引擎**：Unreal Engine 5
- **材质槽数量**：1（单材质槽，与 `pet-model-specs.md` 一致）
- **纹理分辨率**：1024×1024（LOD0）；512×512（LOD1）；256×256（LOD2）
- **纹理格式**：PNG（制作阶段）；BC7 / DXT5（引擎内压缩）
- **外观变体数量**：4 种

---

## Master Material：`M_CubePet_Master`

### 资产信息

| 属性 | 值 |
|------|-----|
| 资产名称 | `M_CubePet_Master` |
| 材质域 | Surface |
| 混合模式 | Opaque |
| 着色模型 | Subsurface（用于风格化皮肤质感） |
| 双面渲染 | 否 |
| 适用体型 | Type A: Cat（猫型）、Type B: Dog（犬型） |

### 纹理槽

| 槽位名称 | 参数名 | 类型 | 默认值 | 说明 |
|----------|--------|------|--------|------|
| 基础色贴图 | `T_Albedo` | Texture2D | 白色占位纹理 | 角色基础色彩贴图，包含颜色区域遮罩信息 |
| 法线贴图 | `T_Normal` | Texture2D | 平面法线 (0.5, 0.5, 1.0) | 表面细节法线贴图 |
| ORM 贴图 | `T_ORM` | Texture2D | (1.0, 0.5, 0.0) | 打包贴图：R=Occlusion, G=Roughness, B=Metallic |

### 颜色区域参数

材质通过 Albedo 贴图中的颜色区域遮罩（利用 UV 区域或顶点色通道）划分 4 个可调色区域，每个区域对应一个 Linear Color 参数：

| 参数名 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `BodyPrimaryColor` | Linear Color | (1.0, 0.6, 0.2, 1.0) | 身体主色区域（躯干、头部主体、四肢外侧） |
| `BodySecondaryColor` | Linear Color | (1.0, 0.9, 0.8, 1.0) | 身体副色区域（腹部、下巴、四肢内侧） |
| `AccentColor` | Linear Color | (0.8, 0.4, 0.1, 1.0) | 点缀色区域（耳朵内侧、尾巴尖端、脚掌垫） |
| `EyeColor` | Linear Color | (0.2, 0.6, 0.3, 1.0) | 眼睛虹膜颜色 |

### 材质属性参数

| 参数名 | 类型 | 默认值 | 范围 | 说明 |
|--------|------|--------|------|------|
| `BaseColorTint` | Linear Color | (1.0, 1.0, 1.0, 1.0) | — | 全局色调叠加，用于整体偏色调整 |
| `RoughnessScale` | Scalar | 0.65 | 0.0 – 1.0 | 粗糙度全局缩放系数，与 ORM 贴图 G 通道相乘 |
| `MetallicScale` | Scalar | 0.0 | 0.0 – 1.0 | 金属度全局缩放系数，与 ORM 贴图 B 通道相乘 |
| `EmissiveIntensity` | Scalar | 0.0 | 0.0 – 5.0 | 自发光强度，用于眼睛高光或特效 |
| `EmissiveColor` | Linear Color | (1.0, 1.0, 1.0, 1.0) | — | 自发光颜色 |
| `SubsurfaceColor` | Linear Color | (0.8, 0.3, 0.2, 1.0) | — | 次表面散射颜色，模拟风格化皮肤透光效果 |
| `SubsurfaceIntensity` | Scalar | 0.3 | 0.0 – 1.0 | 次表面散射强度 |
| `OpacityMask` | Scalar | 1.0 | 0.0 – 1.0 | 预留参数，用于未来配饰透明度控制 |

### 材质图节点结构概述

```
T_Albedo ──→ [区域遮罩分离] ──→ BodyPrimaryColor ──┐
                                BodySecondaryColor ──┤
                                AccentColor ─────────┤──→ Lerp 混合 ──→ × BaseColorTint ──→ Base Color
                                EyeColor ────────────┘

T_Normal ──→ Normal

T_ORM.R ──→ Ambient Occlusion
T_ORM.G ──→ × RoughnessScale ──→ Roughness
T_ORM.B ──→ × MetallicScale ──→ Metallic

SubsurfaceColor × SubsurfaceIntensity ──→ Subsurface Color

EmissiveColor × EmissiveIntensity ──→ Emissive Color
```

---

## 材质实例变体

### 变体 1：Classic Orange — `MI_CubePet_Orange`

| 属性 | 值 |
|------|-----|
| 资产名称 | `MI_CubePet_Orange` |
| 父材质 | `M_CubePet_Master` |
| 设计风格 | 经典暖橘色，温暖亲切，适合作为默认外观 |

#### 颜色参数

| 参数 | sRGB Hex | 线性值 (近似) | 说明 |
|------|----------|---------------|------|
| BodyPrimaryColor | `#E8822A` | (0.78, 0.40, 0.05) | 温暖橘色，覆盖身体主体 |
| BodySecondaryColor | `#F5DCC0` | (0.90, 0.73, 0.53) | 奶油色，覆盖腹部与下巴 |
| AccentColor | `#C45A1E` | (0.55, 0.19, 0.03) | 深橘棕色，耳朵内侧与脚掌 |
| EyeColor | `#4CAF50` | (0.14, 0.45, 0.16) | 翠绿色虹膜 |

#### 材质属性

| 参数 | 值 | 说明 |
|------|-----|------|
| RoughnessScale | 0.65 | 标准绒毛质感 |
| MetallicScale | 0.0 | 无金属感 |
| EmissiveIntensity | 0.1 | 眼睛微弱高光 |
| SubsurfaceColor | `#CC4422` | 暖红色透光 |
| SubsurfaceIntensity | 0.3 | 标准次表面散射 |

#### 预览描述

温暖的橘色身体搭配奶油色腹部，整体色调明快温馨。深橘棕色点缀在耳朵和脚掌处增加层次感，翠绿色眼睛形成互补色对比。适合作为系统默认角色外观。

---

### 变体 2：Cool Blue — `MI_CubePet_Blue`

| 属性 | 值 |
|------|-----|
| 资产名称 | `MI_CubePet_Blue` |
| 父材质 | `M_CubePet_Master` |
| 设计风格 | 柔和冷蓝色，清爽沉稳，适合知识型或辅助型角色 |

#### 颜色参数

| 参数 | sRGB Hex | 线性值 (近似) | 说明 |
|------|----------|---------------|------|
| BodyPrimaryColor | `#5B9BD5` | (0.19, 0.34, 0.67) | 柔和天蓝色，覆盖身体主体 |
| BodySecondaryColor | `#E8F0F8` | (0.80, 0.87, 0.94) | 近白色带蓝调，覆盖腹部 |
| AccentColor | `#FFFFFF` | (1.0, 1.0, 1.0) | 纯白色点缀，耳朵尖端与脚掌 |
| EyeColor | `#FFB74D` | (1.0, 0.48, 0.14) | 琥珀色虹膜，与蓝色形成暖冷对比 |

#### 材质属性

| 参数 | 值 | 说明 |
|------|-----|------|
| RoughnessScale | 0.60 | 略光滑，呈现柔和光泽 |
| MetallicScale | 0.02 | 极微金属感，增加冷调质感 |
| EmissiveIntensity | 0.15 | 眼睛琥珀色微光 |
| SubsurfaceColor | `#3366AA` | 冷蓝色透光 |
| SubsurfaceIntensity | 0.25 | 略低的次表面散射，保持冷调 |

#### 预览描述

柔和的天蓝色身体搭配近白色腹部，整体色调清爽宁静。纯白色点缀在耳朵和脚掌处增添干净感，琥珀色眼睛在冷色调中形成温暖焦点。适合表现冷静、专注的角色性格。

---

### 变体 3：Forest Green — `MI_CubePet_Green`

| 属性 | 值 |
|------|-----|
| 资产名称 | `MI_CubePet_Green` |
| 父材质 | `M_CubePet_Master` |
| 设计风格 | 鼠尾草绿色，自然沉稳，适合执行型或探索型角色 |

#### 颜色参数

| 参数 | sRGB Hex | 线性值 (近似) | 说明 |
|------|----------|---------------|------|
| BodyPrimaryColor | `#7BA67B` | (0.23, 0.40, 0.23) | 鼠尾草绿色，覆盖身体主体 |
| BodySecondaryColor | `#D4C4A8` | (0.65, 0.55, 0.40) | 浅棕米色，覆盖腹部 |
| AccentColor | `#6B4226` | (0.17, 0.08, 0.03) | 深棕色点缀，耳朵内侧与脚掌 |
| EyeColor | `#E6A832` | (0.78, 0.40, 0.06) | 金黄色虹膜 |

#### 材质属性

| 参数 | 值 | 说明 |
|------|-----|------|
| RoughnessScale | 0.70 | 偏粗糙，呈现自然哑光质感 |
| MetallicScale | 0.0 | 无金属感 |
| EmissiveIntensity | 0.1 | 眼睛微弱金色光泽 |
| SubsurfaceColor | `#558844` | 绿色透光 |
| SubsurfaceIntensity | 0.35 | 略高的次表面散射，增加自然感 |

#### 预览描述

沉稳的鼠尾草绿色身体搭配浅棕米色腹部，整体色调自然质朴。深棕色点缀在耳朵和脚掌处呼应大地色系，金黄色眼睛如同林间阳光。适合表现踏实、可靠的角色性格。

---

### 变体 4：Royal Purple — `MI_CubePet_Purple`

| 属性 | 值 |
|------|-----|
| 资产名称 | `MI_CubePet_Purple` |
| 父材质 | `M_CubePet_Master` |
| 设计风格 | 深紫色搭配金色点缀，华丽高贵，适合领导型或特殊角色 |

#### 颜色参数

| 参数 | sRGB Hex | 线性值 (近似) | 说明 |
|------|----------|---------------|------|
| BodyPrimaryColor | `#6A3D9A` | (0.17, 0.08, 0.34) | 深紫色，覆盖身体主体 |
| BodySecondaryColor | `#C9A0DC` | (0.58, 0.37, 0.73) | 淡紫色，覆盖腹部 |
| AccentColor | `#FFD700` | (1.0, 0.68, 0.0) | 金色点缀，耳朵尖端与脚掌 |
| EyeColor | `#FFD700` | (1.0, 0.68, 0.0) | 金色虹膜，与紫色形成皇家配色 |

#### 材质属性

| 参数 | 值 | 说明 |
|------|-----|------|
| RoughnessScale | 0.55 | 偏光滑，呈现丝绒般光泽 |
| MetallicScale | 0.05 | 微弱金属感，增加华丽质感 |
| EmissiveIntensity | 0.3 | 眼睛与金色点缀区域明显发光 |
| EmissiveColor | `#FFD700` | 金色自发光 |
| SubsurfaceColor | `#8833AA` | 紫色透光 |
| SubsurfaceIntensity | 0.3 | 标准次表面散射 |

#### 预览描述

深邃的紫色身体搭配淡紫色腹部，整体色调华丽高贵。金色点缀在耳朵和脚掌处形成皇家配色，金色眼睛带有明显的自发光效果，在暗处尤为醒目。适合表现领导力、权威感的角色性格。

---

## 变体速查表

| 变体 | 资产名称 | 主色 Hex | 副色 Hex | 点缀色 Hex | 眼色 Hex | Roughness | Metallic |
|------|----------|----------|----------|------------|----------|-----------|----------|
| Classic Orange | `MI_CubePet_Orange` | `#E8822A` | `#F5DCC0` | `#C45A1E` | `#4CAF50` | 0.65 | 0.00 |
| Cool Blue | `MI_CubePet_Blue` | `#5B9BD5` | `#E8F0F8` | `#FFFFFF` | `#FFB74D` | 0.60 | 0.02 |
| Forest Green | `MI_CubePet_Green` | `#7BA67B` | `#D4C4A8` | `#6B4226` | `#E6A832` | 0.70 | 0.00 |
| Royal Purple | `MI_CubePet_Purple` | `#6A3D9A` | `#C9A0DC` | `#FFD700` | `#FFD700` | 0.55 | 0.05 |

---

## 运行时材质切换机制

### 方案概述

CharacterManager 通过 UE5 的 Dynamic Material Instance 机制在运行时切换角色外观。每个 PetCharacter Actor 在 Spawn 时创建一个 Dynamic Material Instance，后续通过修改参数实现外观变体切换，无需替换整个材质资产。

### 切换方式

#### 方式 A：预制材质实例切换（推荐用于初始化）

在角色 Spawn 或首次设置外观时，直接使用预制的材质实例资产：

```cpp
// C++ 伪代码
void APetCharacter::SetAppearanceVariant(EPetVariant Variant)
{
    UMaterialInstance* TargetMI = nullptr;
    
    switch (Variant)
    {
        case EPetVariant::Orange:
            TargetMI = LoadObject<UMaterialInstance>(
                nullptr, TEXT("/Game/CubePets/Materials/MI_CubePet_Orange"));
            break;
        case EPetVariant::Blue:
            TargetMI = LoadObject<UMaterialInstance>(
                nullptr, TEXT("/Game/CubePets/Materials/MI_CubePet_Blue"));
            break;
        case EPetVariant::Green:
            TargetMI = LoadObject<UMaterialInstance>(
                nullptr, TEXT("/Game/CubePets/Materials/MI_CubePet_Green"));
            break;
        case EPetVariant::Purple:
            TargetMI = LoadObject<UMaterialInstance>(
                nullptr, TEXT("/Game/CubePets/Materials/MI_CubePet_Purple"));
            break;
    }
    
    if (TargetMI)
    {
        GetMesh()->SetMaterial(0, TargetMI);  // 单材质槽，索引为 0
        CurrentVariant = Variant;
    }
}
```

#### 方式 B：Dynamic Material Instance 参数修改（推荐用于运行时渐变）

在运行时需要平滑过渡或自定义颜色时，使用 Dynamic Material Instance：

```cpp
// C++ 伪代码
void APetCharacter::InitDynamicMaterial()
{
    // 基于 Master Material 创建动态材质实例
    DynamicMaterialInst = GetMesh()->CreateDynamicMaterialInstance(
        0,  // 材质槽索引
        GetMesh()->GetMaterial(0)  // 当前材质作为基础
    );
}

void APetCharacter::SetBodyColor(FLinearColor PrimaryColor, FLinearColor SecondaryColor)
{
    if (DynamicMaterialInst)
    {
        DynamicMaterialInst->SetVectorParameterValue(
            FName("BodyPrimaryColor"), PrimaryColor);
        DynamicMaterialInst->SetVectorParameterValue(
            FName("BodySecondaryColor"), SecondaryColor);
    }
}

void APetCharacter::SetAccentAndEyeColor(FLinearColor Accent, FLinearColor Eye)
{
    if (DynamicMaterialInst)
    {
        DynamicMaterialInst->SetVectorParameterValue(
            FName("AccentColor"), Accent);
        DynamicMaterialInst->SetVectorParameterValue(
            FName("EyeColor"), Eye);
    }
}

void APetCharacter::SetRoughnessAndMetallic(float Roughness, float Metallic)
{
    if (DynamicMaterialInst)
    {
        DynamicMaterialInst->SetScalarParameterValue(
            FName("RoughnessScale"), Roughness);
        DynamicMaterialInst->SetScalarParameterValue(
            FName("MetallicScale"), Metallic);
    }
}
```

### CharacterManager 集成

CharacterManager 在管理角色外观时的调用流程：

```
CharacterManager.SpawnCharacter(agentId, meshVariant, appearanceVariant)
    │
    ├── 1. 从角色池获取或创建 PetCharacter Actor
    │
    ├── 2. 设置 Skeletal Mesh（Cat 或 Dog 体型）
    │       GetMesh()->SetSkeletalMesh(SM_CubePet_Cat 或 SM_CubePet_Dog)
    │
    ├── 3. 设置外观变体
    │       SetAppearanceVariant(EPetVariant::Orange / Blue / Green / Purple)
    │
    └── 4. 注册到 Agent 映射表
            AgentCharacterMap.Add(agentId, characterId)
```

### 变体枚举定义

```cpp
UENUM(BlueprintType)
enum class EPetVariant : uint8
{
    Orange   UMETA(DisplayName = "Classic Orange"),
    Blue     UMETA(DisplayName = "Cool Blue"),
    Green    UMETA(DisplayName = "Forest Green"),
    Purple   UMETA(DisplayName = "Royal Purple")
};
```

### AgentCharacterMapping 扩展

在设计文档中定义的 `AgentCharacterMapping` 接口基础上，增加外观变体字段：

```typescript
interface AgentCharacterMapping {
  agentId: string;
  characterId: string;
  meshVariant: 'Cat' | 'Dog';           // 体型选择
  appearanceVariant: 'Orange' | 'Blue' | 'Green' | 'Purple';  // 外观变体
  defaultPosition: { x: number; y: number; z: number };
  stateMapping: Record<AgentState, CharacterState>;
}
```

### 性能注意事项

| 注意事项 | 说明 |
|----------|------|
| 材质实例数量 | 4 个预制材质实例 + 运行时按需创建的 Dynamic Material Instance |
| 内存开销 | 所有变体共享同一套纹理（Albedo / Normal / ORM），仅参数不同，内存开销极低 |
| Draw Call | 单材质槽设计确保每个角色仅产生 1 个 Draw Call（不含阴影 Pass） |
| 批处理 | 相同变体的角色可被 UE5 自动合批，建议同屏同变体角色尽量使用相同材质实例 |
| LOD 材质 | LOD2 可切换为简化材质（去除法线贴图与次表面散射），降低 Shader 复杂度 |

---

## 资产目录结构

```
/Game/CubePets/
├── Materials/
│   ├── M_CubePet_Master              # Master Material
│   ├── MI_CubePet_Orange             # 材质实例：Classic Orange
│   ├── MI_CubePet_Blue               # 材质实例：Cool Blue
│   ├── MI_CubePet_Green              # 材质实例：Forest Green
│   └── MI_CubePet_Purple             # 材质实例：Royal Purple
├── Textures/
│   ├── T_CubePet_Cat_Albedo          # Cat 型基础色贴图 (1024×1024)
│   ├── T_CubePet_Cat_Normal          # Cat 型法线贴图 (1024×1024)
│   ├── T_CubePet_Cat_ORM             # Cat 型 ORM 贴图 (1024×1024)
│   ├── T_CubePet_Dog_Albedo          # Dog 型基础色贴图 (1024×1024)
│   ├── T_CubePet_Dog_Normal          # Dog 型法线贴图 (1024×1024)
│   └── T_CubePet_Dog_ORM             # Dog 型 ORM 贴图 (1024×1024)
└── Meshes/
    ├── SM_CubePet_Cat                 # Cat 型 Skeletal Mesh
    └── SM_CubePet_Dog                 # Dog 型 Skeletal Mesh
```

---

## 验证清单

材质系统制作完成后，需通过以下验证项：

### Master Material

- [ ] `M_CubePet_Master` 在 Cat 型和 Dog 型上均正常渲染
- [ ] 4 个颜色区域参数（BodyPrimary / BodySecondary / Accent / Eye）可独立调节
- [ ] RoughnessScale 和 MetallicScale 参数在 0.0 – 1.0 范围内表现正确
- [ ] EmissiveIntensity 参数在 0.0 – 5.0 范围内表现正确
- [ ] Subsurface 效果在风格化光照下呈现预期的皮肤透光感
- [ ] ORM 贴图三通道（Occlusion / Roughness / Metallic）正确解包

### 材质实例

- [ ] 4 个材质实例均可在编辑器中预览，颜色与本文档定义一致
- [ ] 4 个材质实例在 Cat 型和 Dog 型上均正常显示
- [ ] 材质实例之间切换无闪烁或异常

### 运行时切换

- [ ] `SetMaterial()` 方式切换材质实例正常工作
- [ ] Dynamic Material Instance 参数修改实时生效
- [ ] 材质切换不影响动画播放和 Morph Target 表情
- [ ] 4 个角色同屏使用不同变体时性能表现正常（参考 `pet-model-specs.md` 性能预算）

### LOD 兼容

- [ ] LOD0 / LOD1 / LOD2 三级 LOD 下材质均正常显示
- [ ] LOD2 简化材质（去除法线贴图）不影响颜色区域参数
