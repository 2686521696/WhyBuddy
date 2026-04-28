<!--
 * @Author: wangchunji
 * @Date: 2026-04-28 11:23:24
 * @Description: 
 * @LastEditTime: 2026-04-28 12:36:48
 * @LastEditors: wangchunji
-->
# 任务清单：本地 UE 渲染运行时

## 任务

- [x] 1. 实现 UE5 进程管理器
  - [x] 1.1 定义 UEProcessConfig 配置结构与环境变量映射
  - [x] 1.2 实现基于 child_process 的 UE5 启动、停止与重启逻辑
  - [x] 1.3 实现进程崩溃检测与状态机（starting → running → stopped / crashed）
  - [x] 1.4 编写进程管理器单元测试

- [x] 2. 搭建本地 Pixel Streaming 信令代理
  - [x] 2.1 实现 WebSocket 信令服务，桥接浏览器与 UE5 Pixel Streaming
  - [x] 2.2 支持多客户端并发连接与独立会话管理
  - [x] 2.3 实现连接断开检测与客户端清理

- [x] 3. 实现健康检查与调试信息推送
  - [x] 3.1 新增 GET /api/ue/health 接口，返回 UE 进程状态与性能指标
  - [x] 3.2 通过 WebSocket 定时推送 FPS、GPU 占用、延迟等调试数据
  - [x] 3.3 实现调试模式热切换（无需重启 UE 实例）

- [x] 4. 编写启动脚本与开发文档
  - [x] 4.1 编写跨平台启动脚本（Windows bat / PowerShell）
  - [x] 4.2 编写 .env.example 配置模板与参数说明
  - [x] 4.3 编写本地开发环境搭建指南

- [x] 5. 实现断线重连机制
  - [x] 5.1 在信令代理层实现客户端重连握手协议
  - [x] 5.2 实现重连次数限制与递增退避策略
  - [x] 5.3 重连失败后触发降级通知事件

- [x] 6. 端到端冒烟测试
  - [x] 6.1 验证启动脚本 → UE 就绪 → 浏览器连接 → 画面输出的完整链路
  - [x] 6.2 验证断线重连与降级回退路径
