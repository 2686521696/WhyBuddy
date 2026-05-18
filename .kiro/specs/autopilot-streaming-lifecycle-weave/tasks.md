# 实现计划：流式输出贯穿全生命周期

## 概述

建立统一的流式输出协调层，将 streaming token 分发到 StageProgressIndicator、MiroFishCardStream、AgentReasoningSubTimeline 和 3D HUD 四个消费端，并处理流中断/恢复。

## 任务

- [x] 1. 创建 useStreamingWeave 协调 hook
  - [x] 1.1 创建 `client/src/components/right-rail/streaming-weave/useStreamingWeave.ts`
    - 订阅 Socket.IO streaming token 事件
    - 维护 `StreamingWeaveState` 状态
    - 实现 `subscribe(consumerId, callback)` 发布-订阅模式
    - 实现 `getProgress()` 基于 token 计数的进度估算
    - 使用 requestAnimationFrame 批量合并 token 分发
    - _需求: 1.1, 1.2, 2.1, 2.2, 2.3, 2.4, 4.1_
  - [x] 1.2 创建 `client/src/components/right-rail/streaming-weave/StreamTokenBuffer.ts`
    - 实现 token 缓冲队列
    - maxBatchSize=10, flushIntervalMs=16(1 frame)
    - 超过 maxBufferSize=100 时丢弃最旧 token
    - _需求: 4.1, 4.2_
  - [x] 1.3 创建 `client/src/components/right-rail/streaming-weave/types.ts`
    - 定义 `StreamingWeaveState`、`StreamTokenBufferConfig`、`InterruptionConfig` 接口
    - _需求: 1.1_

- [x] 2. 创建流中断检测与恢复
  - [x] 2.1 创建 `client/src/components/right-rail/streaming-weave/StreamInterruptionDetector.ts`
    - 监测 lastTokenAt 与当前时间差
    - 500ms 无 token → 设置 isInterrupted=true
    - 10s 无 token → 设置 isReconnecting=true
    - token 恢复 → 清除中断状态
    - _需求: 3.1, 3.2, 3.3_
  - [x] 2.2 创建 `client/src/components/right-rail/streaming-weave/StreamResumeHandler.ts`
    - 恢复后检测补偿数据（通过 sequence number 或 timestamp）
    - 合并补偿数据到已有内容，避免重复
    - _需求: 3.4_

- [x] 3. 创建 StreamingProgressOverlay 进度叠加组件
  - [x] 3.1 创建 `client/src/components/right-rail/streaming-weave/StreamingProgressOverlay.tsx`
    - 叠加在 StageProgressIndicator 上方
    - 正常流式：蓝色渐变脉冲动画
    - 中断态：琥珀色背景 + 警告图标 + "连接中断" 文案
    - 重连态：红色背景 + 旋转图标 + "重新连接中" 文案
    - text-[10px]
    - _需求: 1.1, 1.4, 3.1, 3.3_
  - [x] 3.2 实现进度条与流式状态联动
    - 流式进行中：进度条使用 streaming 模式（渐变填充 + 微弱脉冲）
    - 暂停超过 3s：切换为不确定态动画
    - 阶段跨越：平滑过渡到下一阶段进度
    - _需求: 1.2, 1.3, 1.4_

- [x] 4. 增强现有消费端组件
  - [x] 4.1 增强 `client/src/components/right-rail/cards/` 中的活跃卡片
    - 订阅 useStreamingWeave，实时追加 token 到当前活跃卡片
    - 使用 useRef 避免每次 token 触发整个列表 re-render
    - _需求: 2.1, 4.3_
  - [x] 4.2 增强 AgentReasoningSubTimeline 的当前条目
    - 订阅 useStreamingWeave，实时追加 token 到当前推理条目
    - _需求: 2.2_
  - [x] 4.3 增强 SceneStageFlow 的 zone 指示
    - 流式进行中在当前 zone 显示微弱脉冲发光
    - 使用 CSS animation 而非 Three.js 重渲染
    - _需求: 2.3_

- [x] 5. 性能优化
  - [x] 5.1 实现虚拟化长文本
    - 流式文本超过 1000 字符时使用 `content-visibility: auto`
    - 仅渲染可见区域内的文本块
    - _需求: 4.2_
  - [x] 5.2 实现共享 ref 避免重复渲染
    - 多个消费端通过 useRef 共享 token 数据
    - 仅在 RAF flush 时触发一次批量更新
    - _需求: 4.3_

- [ ] 6. 编写测试
  - [~] 6.1 编写 StreamTokenBuffer 批量合并测试
    - 验证高频 token 被正确批量合并
    - 验证 maxBufferSize 溢出时丢弃最旧 token
    - _需求: 4.1_
  - [~] 6.2 编写 StreamInterruptionDetector 中断检测测试
    - 验证 500ms 无 token 触发 isInterrupted
    - 验证 10s 无 token 触发 isReconnecting
    - 验证 token 恢复后清除中断状态
    - _需求: 3.1, 3.2, 3.3_
  - [~] 6.3 编写 StreamingProgressOverlay SSR 渲染测试
    - 使用 `react-dom/server` 的 `renderToString` 验证无报错
    - 验证 3 种状态（正常/中断/重连）的 className 正确
    - _需求: 1.1, 3.1, 3.3_

## 注意事项

- 不引入 @testing-library/react，测试用 vitest + react-dom/server SSR
- 动画使用 CSS @keyframes 和 framer-motion v12
- 不改后端协议，不新增 socket 事件类型
- 不改 6 阶段流程顺序
- 性能关键：使用 RAF 节流、useRef、content-visibility
- 右栏白底 light theme，文字使用 slate 色系

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3"] },
    { "id": 1, "tasks": ["2.1", "2.2", "3.1"] },
    { "id": 2, "tasks": ["3.2", "4.1", "4.2", "4.3"] },
    { "id": 3, "tasks": ["5.1", "5.2"] },
    { "id": 4, "tasks": ["6.1", "6.2", "6.3"] }
  ]
}
```
