# 任务清单：打开页面节点

- [x] 定义页面打开目标结构
  已定义 `open_page` 最小目标描述：返回 `target.kind / pageId / href / route / params / query / title / openMode`，同时兼容内部路由、外链和任务详情页三类目标。
- [x] 设计参数透传规则
  已实现 `params / query / context` 透传；其中 `params` 会参与路由占位符替换，`query` 会序列化到 `href`，`context` 原样保留给前端壳层消费。
- [x] 增加权限校验
  已接入可选 `permissionEngine`；当配置权限引擎时，会按 `api:call` 对 `open_page` 执行请求做校验，拒绝时返回 `denied` 和治理说明。
- [x] 验证前端联动机制
  已补充节点执行测试与路由测试，验证前端可消费的 target 描述、参数透传、权限拒绝和 HTTP 状态映射，当前测试已通过。
