<!--
 * @Author: wangchunji
 * @Date: 2026-04-28 11:24:05
 * @Description:
 * @LastEditTime: 2026-04-28 13:30:00
 * @LastEditors: wangchunji
-->

# 任务清单：宠物角色系统

## 任务

- [x] 1. 制作角色资产
  - [x] 1.1 建立统一骨骼层级结构并导出为 USkeleton
  - [x] 1.2 制作基础宠物模型（至少 2 种体型）
  - [x] 1.3 制作 4 种外观变体的材质实例
  - [x] 1.4 制作 Morph Target 表情（6 种基础表情）

- [x] 2. 实现动画蓝图状态机
  - [x] 2.1 制作 idle / walk / work / celebrate / talk / blocked 动画序列
  - [x] 2.2 在 Animation Blueprint 中搭建状态机与过渡规则
  - [x] 2.3 配置 Blend 过渡参数（过渡时间 ≤ 0.3s）
  - [x] 2.4 实现 Morph Target 表情驱动逻辑

- [x] 3. 实现 CharacterManager
  - [x] 3.1 实现角色池（spawn / despawn / 复用）
  - [x] 3.2 实现 agentId → characterId 映射表
  - [x] 3.3 实现 Agent 状态到角色动作状态的自动映射
  - [x] 3.4 实现角色动态添加与移除

- [x] 4. 对接指令协议
  - [x] 4.1 实现 character.moveTo 指令处理（NavMesh 寻路）
  - [x] 4.2 实现 character.playAnimation 指令处理
  - [x] 4.3 实现角色到达目标后的回调事件

- [x] 5. 实现角色交互
  - [x] 5.1 实现角色与场景物体的 IK 交互（如坐椅子、用电脑）
  - [x] 5.2 实现角色之间的面对面对话姿态
  - [x] 5.3 实现角色头部 LookAt 跟踪（看向镜头或其他角色）

- [x] 6. 测试与优化
  - [x] 6.1 验证所有动作状态的动画过渡流畅性
  - [x] 6.2 验证 4 个角色同屏时的性能表现
  - [x] 6.3 编写角色资产制作规范文档

## 落地说明

- 运行时契约与可回归测试：`shared/ue-character.ts`、`shared/__tests__/ue-character-runtime.test.ts`
- 动画蓝图与 Morph Target 执行规范：`docs/ue-character/animation-blueprint-runtime.md`
- CharacterManager、指令协议与回调规范：`docs/ue-character/character-manager-runtime.md`
- IK、面对面对话、LookAt 与性能验证规范：`docs/ue-character/interaction-and-validation.md`
- 角色资产制作规范：`docs/ue-character/asset-production-guidelines.md`
