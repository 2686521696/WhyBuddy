# 后端 NodeJS 到 Python 迁移：web-aigc node adapter inventory

## 执行状态
- 状态：人工接管完成
- 目标：盘点 `server/routes/node-adapters` 和 `shared/web-aigc-*`，拆出下一批可迁 Python adapters。
- 角色分工：worker 只盘点；reviewer 确认任务粒度足够小。

### 状态清单
- [x] 列出 node-adapters 下所有 adapter。
- [x] 按 search/file/vision-audio/navigation/report 分组。
- [x] 标出每组迁移风险和建议 gate。
- [x] mojibake gate 通过。
- [x] 文档 diff 确认没有改业务代码。

## 目标

web-aigc node adapters 是 NodeJS 后端迁 Python 的大分母之一。先盘点，避免直接一口气迁所有 adapter。

## 允许修改的文件
- `agent-loop/tasks/backend-python-web-aigc-node-adapter-inventory.md`
- `docs/backend-python-web-aigc-node-adapter-inventory.md`

## 禁止扩大范围
- 不改 adapter 代码。
- 不新建 Python runtime。
- 不把 inventory 写成已完成迁移。
- 不改 queue 中其它 task 状态。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `webAigcAdapterInventoryGates`。

## 成功标准

- 文档列出至少 15 个 Node adapter，并分组。
- 每组有 Python target 和建议测试文件。
- 明确哪些适合 Grok worker 做，哪些必须 Codex 先审边界。
- 文档通过 mojibake 检查。
