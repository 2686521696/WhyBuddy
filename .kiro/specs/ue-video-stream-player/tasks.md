<!--
 * @Author: wangchunji
 * @Date: 2026-04-28 09:35:25
 * @Description: 
 * @LastEditTime: 2026-04-28 09:47:29
 * @LastEditors: wangchunji
-->
# 任务清单：前端视频流播放器

## 任务

- [ ] 1. 实现 WebRTC 连接管理器
  - [ ] 1.1 封装 RTCPeerConnection 创建、ICE 候选交换与 SDP 协商
  - [ ] 1.2 实现信令 WebSocket 客户端，对接本地 Pixel Streaming 信令代理
  - [ ] 1.3 实现连接状态监听与断线检测
  - [ ] 1.4 实现自动重连逻辑（最多 3 次，递增退避）

- [ ] 2. 实现 VideoStreamPlayer React 组件
  - [ ] 2.1 创建组件骨架，接收 Props 并管理内部渲染模式状态
  - [ ] 2.2 实现 video 元素渲染与 MediaStream 绑定
  - [ ] 2.3 实现自适应容器尺寸与全屏支持
  - [ ] 2.4 实现连接中 / 错误 / 降级的 UI 状态展示

- [ ] 3. 实现降级状态机
  - [ ] 3.1 定义 RenderMode 状态枚举与转换规则
  - [ ] 3.2 实现 ue-stream → connecting → threejs → prerender 的降级链路
  - [ ] 3.3 实现 UE 恢复可用时的升级检测与平滑切换
  - [ ] 3.4 编写降级状态机的属性测试

- [ ] 4. 集成 Three.js 降级渲染
  - [ ] 4.1 将现有 Scene3D 组件封装为降级渲染后端
  - [ ] 4.2 实现 ue-stream 与 threejs 模式的无闪烁切换
  - [ ] 4.3 确保降级模式下现有 3D 交互功能不受影响

- [ ] 5. 实现画质自适应
  - [ ] 5.1 基于 RTCStatsReport 采集帧率与网络延迟
  - [ ] 5.2 实现自动画质调整算法（帧率低于阈值时降档）
  - [ ] 5.3 实现手动画质切换 UI 控件

- [ ] 6. 编写测试与文档
  - [ ] 6.1 编写 WebRTC 连接管理器单元测试（使用 mock）
  - [ ] 6.2 编写 VideoStreamPlayer 组件集成测试
  - [ ] 6.3 编写降级场景的端到端测试
