# 宠物角色 Morph Target 表情系统规范

## 概述

本文档定义 Cube Pets 宠物角色系统的 6 种基础表情 Morph Target 规范。所有表情通过 Skeletal Mesh 的顶点偏移实现，不依赖额外骨骼。两种体型（Cat / Dog）均必须支持全部 6 种表情。

- **适用引擎**：Unreal Engine 5
- **统一骨骼**：`SK_CubePet_Skeleton`（29 骨骼）
- **Morph Target 总数**：6
- **权重范围**：0.0 ~ 1.0
- **过渡时间**：≤ 0.3 秒（与动作状态过渡时间一致）

---

## 1. 表情定义

### 1.1 Expr_Neutral — 中性

| 属性              | 值                                                                    |
| ----------------- | --------------------------------------------------------------------- |
| Morph Target 名称 | `Expr_Neutral`                                                        |
| 参考情绪          | 平静、放松、无明显情绪                                                |
| 推荐默认权重      | 0.0                                                                   |
| 说明              | 默认状态。所有 Morph Target 权重为 0 时即为中性表情，无需额外顶点偏移 |

**受影响面部区域**：无（基础 Pose 即为中性）

| 区域 | 顶点位移描述                 |
| ---- | ---------------------------- |
| 眼睛 | 无偏移，保持自然睁开状态     |
| 眉毛 | 无偏移，保持自然弧度         |
| 嘴巴 | 无偏移，保持自然闭合         |
| 下巴 | 无偏移，Jaw 骨骼保持默认位置 |
| 脸颊 | 无偏移                       |

---

### 1.2 Expr_Happy — 开心

| 属性              | 值                   |
| ----------------- | -------------------- |
| Morph Target 名称 | `Expr_Happy`         |
| 参考情绪          | 愉悦、满足、轻松开心 |
| 推荐默认权重      | 0.7                  |

**受影响面部区域**：

| 区域 | 顶点位移描述                                                   |
| ---- | -------------------------------------------------------------- |
| 眼睛 | 上眼睑向下偏移约 15%，形成微眯效果；下眼睑略向上推挤           |
| 眉毛 | 整体向上偏移约 10%，略微上扬，表达放松愉悦                     |
| 嘴巴 | 嘴角向两侧外扩并向上偏移约 20%，形成上扬弧线；上唇中部略向上拉 |
| 下巴 | 无明显偏移，保持闭合或微张                                     |
| 脸颊 | 向上向外推挤约 12%，形成饱满的笑肌隆起                         |

---

### 1.3 Expr_Sad — 悲伤

| 属性              | 值               |
| ----------------- | ---------------- |
| Morph Target 名称 | `Expr_Sad`       |
| 参考情绪          | 低落、失望、沮丧 |
| 推荐默认权重      | 0.7              |

**受影响面部区域**：

| 区域 | 顶点位移描述                                                   |
| ---- | -------------------------------------------------------------- |
| 眼睛 | 上眼睑向下偏移约 20%，形成半闭合的低垂效果                     |
| 眉毛 | 内侧（靠近鼻梁）向上偏移约 15%，外侧向下偏移约 10%，形成八字眉 |
| 嘴巴 | 嘴角向下偏移约 18%，形成下垂弧线；下唇中部略向前突出           |
| 下巴 | 略向下偏移约 5%，配合嘴角下垂                                  |
| 脸颊 | 略向下松弛偏移约 8%，减少面部饱满感                            |

---

### 1.4 Expr_Thinking — 思考

| 属性              | 值                 |
| ----------------- | ------------------ |
| Morph Target 名称 | `Expr_Thinking`    |
| 参考情绪          | 沉思、犹豫、分析中 |
| 推荐默认权重      | 0.6                |

**受影响面部区域**：

| 区域 | 顶点位移描述                                                      |
| ---- | ----------------------------------------------------------------- |
| 眼睛 | 左眼保持自然；右眼上眼睑略向下偏移约 8%，形成轻微眯眼             |
| 眉毛 | 左侧眉毛向上偏移约 18%（挑眉）；右侧眉毛保持自然或略向下偏移约 5% |
| 嘴巴 | 整体略向右侧偏移约 10%，形成嘴巴微偏的思考姿态；嘴唇轻微抿紧      |
| 下巴 | 无明显偏移                                                        |
| 脸颊 | 右侧脸颊略向上推挤约 5%，配合嘴巴偏移                             |

> **注意**：思考表情具有不对称性，可配合 Head 骨骼的轻微歪斜动画增强表现力。

---

### 1.5 Expr_Surprised — 惊讶

| 属性              | 值               |
| ----------------- | ---------------- |
| Morph Target 名称 | `Expr_Surprised` |
| 参考情绪          | 震惊、意外、惊奇 |
| 推荐默认权重      | 0.8              |

**受影响面部区域**：

| 区域 | 顶点位移描述                                                 |
| ---- | ------------------------------------------------------------ |
| 眼睛 | 上眼睑向上偏移约 25%，下眼睑向下偏移约 10%，形成圆睁大眼效果 |
| 眉毛 | 整体大幅向上偏移约 25%，形成高挑眉弓                         |
| 嘴巴 | 上唇向上偏移约 8%，下唇向下偏移约 15%，形成张嘴 O 型         |
| 下巴 | Jaw 区域向下偏移约 12%，配合嘴巴张开                         |
| 脸颊 | 向两侧略微外扩约 5%，配合整体面部拉伸                        |

---

### 1.6 Expr_Angry — 生气

| 属性              | 值               |
| ----------------- | ---------------- |
| Morph Target 名称 | `Expr_Angry`     |
| 参考情绪          | 愤怒、不满、烦躁 |
| 推荐默认权重      | 0.7              |

**受影响面部区域**：

| 区域 | 顶点位移描述                                                  |
| ---- | ------------------------------------------------------------- |
| 眼睛 | 上眼睑向下偏移约 15%，形成怒目效果；眼角略向内收              |
| 眉毛 | 内侧大幅向下向内偏移约 20%，外侧略向下偏移约 8%，形成紧锁皱眉 |
| 嘴巴 | 嘴唇紧闭，上下唇向内收紧约 10%；嘴角略向下偏移约 8%           |
| 下巴 | 略向上推挤约 5%，配合嘴唇紧闭的紧张感                         |
| 脸颊 | 鼻翼两侧向上推挤约 10%，形成怒纹效果                          |

> **注意**：生气表情可配合角色轻微颤抖动画（通过 Animation Blueprint 叠加微幅抖动曲线）增强表现力。

---

## 2. 表情组合规则

### 2.1 可叠加组合矩阵

表情之间可以叠加使用，但需要控制组合权重以避免顶点变形过度导致穿模。

| 组合               | 是否允许 | 组合权重上限             | 说明                               |
| ------------------ | -------- | ------------------------ | ---------------------------------- |
| Happy + Surprised  | ✅       | 各 0.5                   | 惊喜效果，嘴角上扬 + 眼睛睁大      |
| Sad + Thinking     | ✅       | 各 0.5                   | 忧虑思考，眉毛冲突区域取平均       |
| Angry + Thinking   | ✅       | Angry 0.4 / Thinking 0.3 | 愤怒思考，眉毛区域以 Angry 为主    |
| Happy + Sad        | ⚠️       | 各 0.3                   | 苦笑效果，嘴角方向冲突，需限制权重 |
| Happy + Angry      | ⚠️       | 各 0.3                   | 不自然组合，仅在特殊场景使用       |
| Sad + Angry        | ✅       | 各 0.5                   | 委屈愤怒，眉毛方向兼容             |
| Surprised + Angry  | ⚠️       | 各 0.3                   | 震怒效果，眉毛方向冲突，需限制权重 |
| Surprised + Sad    | ✅       | 各 0.5                   | 震惊失落，眼睛和嘴巴方向兼容       |
| 任意表情 + Neutral | ✅       | 无限制                   | Neutral 权重为 0，不产生实际偏移   |

**通用规则**：

- 同时激活的非 Neutral 表情不超过 **2 种**
- 所有激活表情的权重之和建议不超过 **1.2**
- 当两个表情在同一面部区域产生相反方向的偏移时，应降低各自权重至 0.3 以下

### 2.2 推荐状态-表情配对

动作状态与表情的默认配对关系：

| 动作状态  | 推荐表情         | 权重      | 说明                   |
| --------- | ---------------- | --------- | ---------------------- |
| idle      | neutral          | 0.0       | 待机状态，无表情       |
| walk      | neutral 或 happy | 0.0 ~ 0.3 | 行走时可带轻微愉悦     |
| work      | thinking         | 0.6       | 工作时默认思考表情     |
| celebrate | happy            | 0.8       | 庆祝时开心表情         |
| talk      | 随对话内容变化   | 0.5 ~ 0.8 | 对话时根据语义切换表情 |
| blocked   | angry 或 sad     | 0.6       | 阻塞时默认愤怒或沮丧   |

> 以上为默认配对，导演系统可通过 `character.playAnimation` 指令的 `expression` 参数覆盖。

---

## 3. Animation Blueprint 集成

### 3.1 驱动方式

Morph Target 通过 Animation Blueprint 中的 `Set Morph Target` 节点驱动。推荐在 `AnimGraph` 的最终输出前，通过自定义 AnimNode 或 Blueprint 逻辑统一管理所有表情权重。

### 3.2 过渡控制

表情切换使用线性插值（Lerp）实现平滑过渡：

- **过渡时间**：≤ 0.3 秒（与动作状态 Blend 过渡时间一致）
- **插值方式**：`FMath::FInterpTo` 或 Timeline 驱动
- **更新频率**：每帧更新（Tick）

### 3.3 C++ 伪代码

```cpp
// PetCharacter.h
UCLASS()
class APetCharacter : public ACharacter
{
    GENERATED_BODY()

public:
    // 设置目标表情与权重
    UFUNCTION(BlueprintCallable, Category = "Expression")
    void SetExpression(FName ExpressionName, float TargetWeight, float BlendTime = 0.3f);

    // 清除所有表情（回到 Neutral）
    UFUNCTION(BlueprintCallable, Category = "Expression")
    void ClearExpressions(float BlendTime = 0.3f);

private:
    // 当前各表情的目标权重
    TMap<FName, float> TargetExpressionWeights;

    // 当前各表情的实际权重（插值中）
    TMap<FName, float> CurrentExpressionWeights;

    // 过渡速率
    TMap<FName, float> ExpressionBlendSpeeds;
};

// PetCharacter.cpp
void APetCharacter::SetExpression(FName ExpressionName, float TargetWeight, float BlendTime)
{
    TargetWeight = FMath::Clamp(TargetWeight, 0.0f, 1.0f);
    TargetExpressionWeights.Add(ExpressionName, TargetWeight);

    // 计算插值速率：权重差 / 过渡时间
    float CurrentWeight = CurrentExpressionWeights.FindRef(ExpressionName);
    float Speed = (BlendTime > 0.0f)
        ? FMath::Abs(TargetWeight - CurrentWeight) / BlendTime
        : 100.0f; // 瞬时切换
    ExpressionBlendSpeeds.Add(ExpressionName, Speed);
}

void APetCharacter::ClearExpressions(float BlendTime)
{
    for (auto& Pair : TargetExpressionWeights)
    {
        Pair.Value = 0.0f;
        float CurrentWeight = CurrentExpressionWeights.FindRef(Pair.Key);
        float Speed = (BlendTime > 0.0f)
            ? CurrentWeight / BlendTime
            : 100.0f;
        ExpressionBlendSpeeds.Add(Pair.Key, Speed);
    }
}

// 在 Tick 中更新
void APetCharacter::Tick(float DeltaTime)
{
    Super::Tick(DeltaTime);

    USkeletalMeshComponent* MeshComp = GetMesh();
    if (!MeshComp) return;

    for (auto& Pair : TargetExpressionWeights)
    {
        FName MorphName = Pair.Key;
        float Target = Pair.Value;
        float& Current = CurrentExpressionWeights.FindOrAdd(MorphName);
        float Speed = ExpressionBlendSpeeds.FindRef(MorphName);

        // 平滑插值
        Current = FMath::FInterpConstantTo(Current, Target, DeltaTime, Speed);

        // 应用到 Skeletal Mesh
        MeshComp->SetMorphTarget(MorphName, Current);
    }
}
```

### 3.4 Blueprint 伪代码

在 Animation Blueprint 的 Event Graph 中：

```
Event Blueprint Update Animation
  → Get Owning Actor → Cast to PetCharacter
  → For Each (CurrentExpressionWeights)
      → Set Morph Target (Key, Value)
```

或在 PetCharacter Blueprint 中直接调用：

```
// 切换到开心表情
Set Expression("Expr_Happy", 0.8, 0.3)

// 组合表情：工作 + 思考
Set Expression("Expr_Thinking", 0.6, 0.3)

// 清除所有表情
Clear Expressions(0.3)
```

### 3.5 指令协议集成

通过 `CharacterAnimCommand` 的 `expression` 字段触发表情切换：

```typescript
// 导演系统发送指令
const command: CharacterAnimCommand = {
  method: "character.playAnimation",
  params: {
    characterId: "pet_cat_01",
    state: "work",
    expression: "thinking", // 可选，覆盖默认配对
  },
};
```

接收端处理逻辑：

1. 解析 `state` 字段，切换动作状态机
2. 若 `expression` 字段存在，调用 `SetExpression` 设置指定表情
3. 若 `expression` 字段缺省，使用状态-表情默认配对表

---

## 4. 体型差异说明

### 4.1 Type A: Cat（猫型）

| 特征           | 说明                                                                    |
| -------------- | ----------------------------------------------------------------------- |
| 头身比         | 1:1.2（大头小身）                                                       |
| 头部宽度       | 30 cm                                                                   |
| 面部三角面预算 | 1400（占总预算 31%）                                                    |
| 表情特点       | 头部占比大，面部表情区域更宽广，顶点密度更高                            |
| 调整建议       | 眼睛和嘴巴的偏移幅度可略微放大 5%~10%，利用更大的面部面积增强表情可读性 |
| 眉毛区域       | 面积较大，眉毛动作更夸张，适合表达明显的情绪变化                        |
| 嘴巴区域       | 嘴巴相对于头部比例较小，嘴角偏移需要更精确以避免变形                    |

### 4.2 Type B: Dog（犬型）

| 特征           | 说明                                                                                         |
| -------------- | -------------------------------------------------------------------------------------------- |
| 头身比         | 1:1.8（头身均衡）                                                                            |
| 头部宽度       | 28 cm                                                                                        |
| 面部三角面预算 | 1300（占总预算 27%）                                                                         |
| 表情特点       | 头部比例适中，面部表情区域相对紧凑                                                           |
| 调整建议       | 保持与 Cat 型一致的表情幅度感知；由于面部面积较小，偏移百分比可略微增大 5%~8% 以补偿视觉缩减 |
| 眉毛区域       | 面积较紧凑，眉毛动作需要更集中以保持可读性                                                   |
| 嘴巴区域       | 嘴巴与头部比例更均衡，嘴角偏移可直接使用标准值                                               |

### 4.3 跨体型一致性原则

- 两种体型的同一表情在 **情绪感知强度** 上应保持一致
- Cat 型利用更大的面部面积自然放大表情效果
- Dog 型通过略微增大偏移百分比补偿较小的面部面积
- 最终验收标准：在相同摄像机距离下，两种体型的同一表情应传达等同的情绪强度

---

## 5. 验证清单

### Morph Target 基础验证

- [ ] 6 个 Morph Target 均已在 DCC 工具中制作完成
- [ ] Morph Target 命名严格遵循规范：`Expr_Neutral`、`Expr_Happy`、`Expr_Sad`、`Expr_Thinking`、`Expr_Surprised`、`Expr_Angry`
- [ ] 每个 Morph Target 的权重范围为 0.0 ~ 1.0，权重为 0 时与基础 Pose 完全一致
- [ ] 每个 Morph Target 在权重 1.0 时无顶点穿模

### 单表情验证

- [ ] Expr_Happy：嘴角上扬、眼睛微眯、脸颊隆起效果自然
- [ ] Expr_Sad：嘴角下垂、眉毛八字、眼睛半闭效果自然
- [ ] Expr_Thinking：单侧挑眉、嘴巴微偏效果自然，不对称性明显
- [ ] Expr_Surprised：眼睛圆睁、嘴巴张开、眉毛高挑效果自然
- [ ] Expr_Angry：眉毛紧锁、嘴唇紧闭、鼻翼推挤效果自然

### 组合表情验证

- [ ] Happy + Surprised 叠加（各 0.5）无严重穿模或变形
- [ ] Sad + Thinking 叠加（各 0.5）无严重穿模或变形
- [ ] Angry + Sad 叠加（各 0.5）无严重穿模或变形
- [ ] 任意两个表情叠加时，权重之和不超过 1.2 的情况下表现正常

### 过渡动画验证

- [ ] 表情切换过渡时间 ≤ 0.3 秒
- [ ] 从任意表情切换到 Neutral 过渡平滑，无跳帧
- [ ] 从 Neutral 切换到任意表情过渡平滑，无跳帧
- [ ] 表情切换与动作状态切换同时发生时，两者互不干扰

### 体型兼容性验证

- [ ] Cat 型 6 个表情均正常工作
- [ ] Dog 型 6 个表情均正常工作
- [ ] Cat 型与 Dog 型的同一表情在相同摄像机距离下情绪感知强度一致
- [ ] 两种体型的表情叠加效果一致，无体型特异性穿模

### Animation Blueprint 集成验证

- [ ] `SetExpression` 函数可正确设置 Morph Target 权重
- [ ] `ClearExpressions` 函数可正确清除所有表情
- [ ] 指令协议的 `expression` 字段可正确触发表情切换
- [ ] 状态-表情默认配对在无 `expression` 指令时正确生效

### FBX 导出验证

- [ ] FBX 文件包含全部 6 个 Morph Target
- [ ] UE5 导入后 Morph Target 名称与规范一致
- [ ] UE5 导入后 Morph Target 权重驱动效果与 DCC 工具一致
