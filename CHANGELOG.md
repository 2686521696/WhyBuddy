# Changelog

这个文件记录适合放给使用者、协作者和新接手同学阅读的项目变化。

更细的任务拆分、阶段规划和未完成项请看 [ROADMAP.md](./ROADMAP.md)。

## 2026-07-28（下午）

**PC 端组件层：不再自造，全部换成 Ant Design 现成组件**

参考 `ant-design/pro-components` 的 valueType 机制（一个 valueType 对应一个组件、
组件内部按 mode 分 read/edit 两支），把「字段声明 → 控件」收敛成一张读写共用的
判定表。此前读侧、写侧、表格列三处各判各的，后果是日期读出来是纯文本、写进去
用的却是原生 `<input type="date">`，枚举无论 2 个取值还是 20 个一律下拉框。

- 日期/时间 → DatePicker；枚举按取值个数分三档 → Segmented（≤3）/
  Radio.Group（≤6）/ Select；百分比与进度 → Slider + InputNumber；金额 →
  InputNumber 千分位；脱敏字段 → Input.Password；长文本 → TextArea。
- 新建表单外壳从手写 div 换成 Form + Form.Item（竖排 label、对齐、错误态位），
  并去掉了标签旁给开发看的 `string` `number` 类型角标。
- 删除记录套 Popconfirm（此前一点就没了）；提示条从静态 `message.xxx()` 换成
  hook 版，身份主色/深色档/圆角配方才下发得到。
- 崩溃降级卡 → Result，AI 报错红框 → Alert，加载态 → Skeleton，空态 → Empty，
  侧栏菜单项挂 Badge 行数。

真实业务场景验收（连锁健身房会员与私教管理，19.3 分钟闭环 6/6，12 实体 /
7 节点流程 / 6 角色 / 6 页面）：全站用到 16 种 antd 组件，录入控件累计
Form.Item 33 · DatePicker 7 · Radio.Group 7 · InputNumber 6 · Select 6 ·
Segmented 1，原生 `input[type=date]` 0 个，「暂无数据」0 处。

## 2026-07-28

这一轮集中在「闭环产出的应用，打开之后是不是真的能看、能用」。

**生成的应用不再是空壳**

- 新增演示种子数据：闭环产出的应用第一次打开时每个实体都是零行，表格、图表、KPI 全线出「暂无数据」。现在按字段类型/语义确定性地铺一批示例行，页面打开即有内容。
- 三条边界保证它不会跟真实数据混淆：每个实体只在首次遇见时铺一次（后续删空也不会自己长回来）、每行都带标记、用户写入第一条真实数据时该表种子整批清掉。界面上始终挂「示例数据 N」徽标。
- 取值按语义走词表：人名出「卢展鹏」、机构出「长沙金穗生物有限公司」、编号出「RR-2026-2879」、产地出真实城市名；认不出语义的字段才退回「字段名 + 序号」。随机源用 pure-rand（与 drizzle-seed / fast-check 同款），同一个模型每次打开看到的示例完全一致。

**体验区块从占位变成真渲染**

- MetricGrid / TrendChart / RankedList / ActivityFeed / DataTable 五个区块接上真实渲染器并放开生成，页面不再只有一张光秃秃的表格。
- 按页面类型划分 KPI 与图表的归属：总览页（monitor/dashboard）走 `page.stats`/`page.charts` 由 ENRICH 重新设计版式，业务页走 MetricGrid/TrendChart 积木。渲染层双向硬隔离，同一个指标不会被画两遍。
- 同理，绑到页面主实体的 DataTable 区块会被摘掉——那一页本来就自带一张带中文列名、彩色状态标签、排序筛选与行内操作的表。

**PC 端固定组件改用 Ant Design 组件**

- 区块渲染器此前是手写 div + 写死的十六进制色值，不跟随应用的身份主题（琥珀色的应用里动态流圆点是靛蓝的），深色/紧凑/高对比档位也失效。现已换成 Card / Empty / Timeline / List + Progress / Table，颜色全部走主题 token。
- 表格列头出中文显示名、枚举列出标签（不再是 `lot_code` 与 `frozen`）。
- 新增 dev-only 的区块视觉对照台 `/block-gallery.html`（`vite dev` 下可达，不进生产产物），九个区块连同空态一次铺开、可切换主题色，用于视觉回归。

**移动端全面改用 antd-mobile**

- 手机档交互层不再套用 PC 组件：表单、详情、行操作、首页、主题下发全部换成 antd-mobile。
- 按 pageKind 出骨架，补齐 dashboard / monitor / wizard / kanban / calendar；列表支持搜索与左滑操作。
- 修复 antd-mobile 与 React 19 的兼容问题（`react-dom` 主入口不再导出 `createRoot`/`unmountComponentAtNode`，导致 Toast 抛错）。
- 无权限的底部 tab 点击后会给出说明，提示落在手机框内而不是整个浏览器窗口。

**技能库瘦身**

- 下架社区技能层，只保留「精选 / 已安装」两层。
- 128 条技能逐条判定后按消费通道分流（`aigc` 绑定实体字段 / `experience` 提供设计指引 / `unbound` 仅作软引用），并下架 49 条装了不产出任何东西的条目。

**其它**

- 入站判定：已有应用时也能提全新需求（此前会被硬判成迭代）；输入变化后立刻撤下已不成立的旧提示。
- 应用存储降级改为四级：远端 TCP → 远端 SQL over HTTP → 本地 SQLite → JSON 文件。
- 图表维度的枚举取值出标签而不是取值 id。
- `dev:stop` 修复 Windows 下清不掉端口、`dev:all` 拒绝启动时静默无输出的问题。

## 2026-06-13

- **产品改名：WhyBuddy → SlideRule（全量迁移）。** 173+ 个文件名、全部内部标识符（类型 / 函数 / 常量 / data-testid / env 名 / localStorage key / API 路由）一次性切换为 SlideRule 系命名。
- 三条持久化边界带兼容垫片过渡（保留一个版本周期，约 4-6 周后移除）：
  - localStorage：启动时把 `whybuddy:*` 自动迁移到 `sliderule:*`（幂等，不覆盖新值；BYOK key 池逐字段保全）。
  - 环境变量：`SLIDERULE_*` 为主，旧 `WHYBUDDY_*` 仍生效（双设时新名优先）。
  - API：`/api/sliderule` 为主挂载，`/api/whybuddy` 别名同 router；默认会话文件 `data/whybuddy-sessions.json` 启动时复制为 `data/sliderule-sessions.json`（原件保留可回滚）。
- 旧脚本名 `verify:whybuddy-v5` / `smoke:whybuddy` / `smoke:whybuddy-store` 保留为别名一个版本周期。
- GitHub 仓库改名后旧链接由 GitHub 301 自动重定向。

## 2026-04-15

- 更新 `README.md`，同步当前产品口径：办公室主壳、统一智能发起入口、底部共享操作区与最近完成的发起/任务操作收敛进展。
- 完成 `launch-operator-surface-convergence` 第一阶段：`UnifiedLaunchComposer` 接入底部任务操作 rail，`OfficeTaskCockpit.tsx` / `TasksPage.tsx` 完成接线。
- 将 `TasksCockpitDetail` 的首屏独立任务操作卡降级为建议与依据区，首屏主操作入口收口到底部共享操作区。
- 为共享操作区补充测试与回归：新增 `LaunchOperatorActionRail` 组件测试，补齐 `unified-launch-coordinator` 的升级前短路与澄清提交流程回归。
- 更新 `.kiro/specs/launch-operator-surface-convergence/tasks.md` 与 `.kiro/steering/execution-plan.md`，同步本轮实现进度与当前剩余手测项。

## 2026-03-30

- 重构 `README.md`，把内容改成更适合首次阅读的结构：30 秒了解、核心链路、快速开始、配置总览、文档入口。
- 新增 `CHANGELOG.md`，把“读者关心的变化”从 README 中拆出来。
- 在 README 中按配置组整理环境变量，降低 `.env` 的理解成本。

## 2026-03-29

- mission 主线相关能力已并入 `main`：`shared/mission/**`、`shared/executor/**`、任务路由、Feishu bridge、lobster executor、brain dispatch 和 `/tasks` 页面进入主仓。
- `/tasks` 任务页收口为更适合 16:9 屏幕的任务驾驶舱，采用 `Overview / Execution / Artifacts` 结构。
- 服务端入口接入 mission / executor / Feishu 集成路由，同时保留原有 workflow / chat / agent 主链。
- `.env.example`、README、mission smoke 脚本和集成文档补齐。

## 2026-03-28

- 项目主定位从“生成 md/json 报告”升级为“真实任务编排 + Docker 执行 + 进度回传 + 可视化交付”。
- 图片附件 OCR 切换为独立浏览器 worker，并补齐超时与降级回退。
- 工作流页改为“总览优先、摘要次之、详情按需展开”的三级信息密度。
- 3D 办公室场景继续减法优化，弱化固定部门装饰感。

## 2026-03-27

- 附件输入从“仅文本”升级为“文本 + 附件”联合提交。
- 附件解析链路支持全文导入 workflow，不再只注入局部摘要。
- 首页与核心页面完成中英文切换和移动端适配。
- 动态组织架构、Skills、MCP 主线合入，固定 18 角色开始让位于按任务生成组织。
- GitHub Pages 预览增加仓库入口，方便从演示页跳转源码仓库。
