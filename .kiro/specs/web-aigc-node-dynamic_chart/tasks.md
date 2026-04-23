# 任务清单：动态图表节点

- [x] 定义图表输入输出
  - [x] 新增 `shared/web-aigc-dynamic-chart.ts`，统一 `dynamic_chart` 节点输入、输出、UI 展示与 artifact 契约
  - [x] 输入同时兼容 Excel 风格 `headers + rows`、汇总值 `summary`、趋势序列 `series`
- [x] 设计图表类型与配置映射
  - [x] 支持 `bar / line / area / pie` 四类图表与 `auto` 自动判型
  - [x] 输出 Recharts 友好的 `component / data / categoryKey / valueKeys / series` 结构
- [x] 支持 artifact 或 UI 展示
  - [x] 默认输出 UI 展示结构，供前端直接渲染
  - [x] 支持返回 `inline_json` artifact 载荷，供后续文件生成或下载链路复用
- [x] 验证与 Excel 读取联动
  - [x] 覆盖 Excel 兼容输入、汇总饼图、趋势折线图、无数值列报错等最小测试
