# 任务清单：获取设备信息节点

- [x] 定义设备信息输出结构
  - 已新增 `shared/web-aigc-device-info.ts`，统一 `runtime / client / privacy / compatibility / warnings` 输出契约。
  - 运行时摘要收敛为 `platform / arch / nodeVersion`，客户端摘要收敛为 `browserFamily / osFamily / locale / timezone / appVersion / screenCategory`。
- [x] 定义隐私过滤规则
  - 当前实现固定采用 `summary_only` 口径，不存储原始 `userAgent`。
  - 明确阻断 IP、hostname、硬件指纹、设备序列号等高风险字段。
- [x] 评估是否需要真实实现
  - 当前主仓采用“宿主环境摘要 + 可选请求头透传”方案，满足 Office 场景下的低风险兼容判断。
  - 更细粒度设备采集暂不纳入主线，避免为低优先级节点引入额外隐私负担。
- [x] 验证宿主环境兼容性
  - 已新增 `POST /api/get-device-info/nodes/execute`。
  - 已补适配器测试与路由测试，覆盖请求头透传、运行时摘要输出与客户端 hints 缺失回退。
