# 任务运行可视化收敛方案 v1 设计

## 现状问题

目前运行态信息分散：

- 一部分在任务详情
- 一部分在驾驶舱
- 一部分在弹层
- 一部分在 sandbox / terminal / screenshot 预览

用户看到的是“很多面板”，而不是“一个稳定运行面”。

## 目标结构

### 中间任务主线区

承接“任务阶段与进度”：

- 计划生成
- 执行中
- 审核中
- 完成 / 失败

### 底部运行区

承接“运行证据”：

- Logs
- Artifacts
- Runtime

## 任务步骤模型

步骤至少包含：

- `id`
- `title`
- `kind`
  - `llm`
  - `executor`
  - `decision`
  - `review`
- `status`
  - `pending`
  - `running`
  - `waiting`
  - `done`
  - `error`
- `summary`
- `updatedAt`

这套模型不要求替换 store 真相源，但必须在首页表现层稳定映射出来。

## 数据来源映射

实现时应先明确表现层映射，不直接复制旧面板：

- 步骤流 <- 现有任务计划、workflow 状态、task detail 阶段信息
- `Logs` <- socket 日志流、终端输出、关键事件摘要
- `Artifacts` <- 现有 artifact 列表、截图、输出物入口
- `Runtime` <- executor 状态、socket / callback 状态、worker 最近动作
- decision waiting <- Clarification / Decision 相关状态与当前任务等待点

## Logs 设计

- 实时追加
- 自动滚动
- 提供暂停滚动
- 错误日志高亮
- 支持按 `info / step / error` 做轻量分类

## Artifacts 设计

- 结果文件列表
- 点击查看 / 下载
- 截图、报告、产物统一归这里
- 不把 artifact 主入口继续散落在详情页顶部或各类卡片里

## Runtime 设计

展示运行时摘要：

- 当前 executor 状态
- callback / socket 状态
- 当前 worker / 最近动作
- 最近一次失败原因

## 代码落点

- 首页任务主线组件
- `TaskDetailView` 的运行证据能力抽取
- artifact 相关组件
- executor / sandbox 状态相关组件
- Clarification / Decision 等待态组件

## 风险

- 不能一边保留旧分散面板、一边又新增 runtime dock 而不去收口
- 本轮应该优先做“运行证据归口”，不是继续造新视图
- 如果不先定义数据来源映射，容易在首页与详情页之间重复拷贝逻辑
