---
inclusion: manual
---

# Web-AIGC 11 Agent 启动顺序与首批任务清单

## 文档目标

本文用于把已经确定好的 `11` 个并行 Agent 工作流，进一步落到“启动顺序”和“第一轮任务清单”。

换句话说：

- 不是只有分工
- 而是知道今晚如果真的开跑，应该谁先启动、谁后启动、第一批各自做什么

## 总体启动原则

### 原则 1：先平台，后节点

第一批先启动：

- Agent 0
- Agent 1
- Agent 2
- Agent 3

这些 Agent 的任务是把共享术语、共享契约、实例投影、审计门禁先压住。

### 原则 2：先低风险高价值节点，后高风险写操作

第二批优先启动：

- Agent 4
- Agent 5
- Agent 7
- Agent 8
- Agent 10（只开读路径和低风险宿主动作）

### 原则 3：内容处理与控制流稍晚放行

第三批启动：

- Agent 6
- Agent 9

因为它们分别依赖：

- 检索 / 内容处理共用底座
- runtime transition 与 branch 语义稳定

## 启动顺序总表

| 顺序 | Agent | 启动时机 | 放行条件 |
| --- | --- | --- | --- |
| 1 | Agent 0 | 立即 | 无 |
| 2 | Agent 1 | 立即 | 无 |
| 3 | Agent 2 | 立即 | Agent 1 术语草案形成 |
| 4 | Agent 3 | 立即 | Agent 1 / 2 初步实体结构可见 |
| 5 | Agent 4 | 平台稳定 30-60 分钟后 | G1 最小 runtime contract 可用 |
| 6 | Agent 5 | 平台稳定 30-60 分钟后 | G1 + G2 最小 waiting / resume 语义可用 |
| 7 | Agent 7 | 平台稳定 30-60 分钟后 | G1 可执行节点适配 |
| 8 | Agent 8 | 平台稳定 30-60 分钟后 | G1 可执行；仅放 `mcp` / `auto_agent` |
| 9 | Agent 10 | 平台稳定 30-60 分钟后 | 仅放 `vector_query` 和低风险宿主动作 |
| 10 | Agent 6 | 第 2 轮 | Agent 4 的检索承接模式已定 |
| 11 | Agent 9 | 第 2-3 轮 | runtime transition 语义稳定 |

## Agent 0：总控与收口

### 第一轮任务

1. 审核并冻结以下文档的术语一致性：
   - `web-aigc-spec-execution-matrix.md`
   - `web-aigc-parallel-execution-master-plan.md`
   - `web-aigc-agent-assignment-matrix.md`
2. 定义 Gate G0-G5 的通过条件。
3. 建立热点文件 ownership 表。
4. 明确哪些模块必须单写者优先。

### 第一轮交付物

- Gate 表
- ownership 表
- 冲突升级原则

## Agent 1：平台主干 A

### 第一轮任务

1. 收口 `web-aigc-platform-domain-model`
2. 收口 `web-aigc-platform-runtime-engine`
3. 统一以下概念：
   - graph definition
   - graph version
   - graph execution instance
   - node execution record
   - edge transition
   - waiting state
   - operator action
4. 固定最小 node adapter contract。

### 第一轮不做

- 不大量接入节点
- 不先做 UI 设计器

### 第一轮交付标准

- runtime kernel 能被节点 Agent 调用
- 错误态、等待态、完成态都有统一结构

## Agent 2：平台主干 B

### 第一轮任务

1. 收口 `web-aigc-platform-mission-projection`
2. 收口 `web-aigc-platform-session-instance`
3. 建立 graph instance 到 mission / session 的最小映射。
4. 定义 waiting_input / resume 所需的 session 挂接点。

### 第一轮不做

- 不直接铺满所有 HITL 节点
- 不抢写主运行时内核

### 第一轮交付标准

- G2 最小闭环成立
- `user_input` 类节点可以投影到 mission / session

## Agent 3：平台主干 C

### 第一轮任务

1. 建立 `web-aigc-platform-observability-audit` 最小承接模型。
2. 建立 `web-aigc-platform-security-governance` 最小门禁规则。
3. 固定以下关联关系：
   - workflow / mission / instance / session / audit / replay
4. 先为高风险节点定义“未放行前禁止上线”的策略。

### 第一轮不做

- 不把全部治理页面一次性做完
- 不在第一轮里做非常重的运营报表

### 第一轮交付标准

- G3 有最小版
- 高风险节点有门禁定义

## Agent 4：对话与问答能力簇

### 第一轮任务

按下面顺序推进：

1. `web-aigc-node-dialogue`
2. `web-aigc-node-knowledge_qa`
3. `web-aigc-node-llm`

### 第二轮再做

4. `web-aigc-node-robot_reply`
5. `web-aigc-node-web_qa`

### 第一轮交付标准

- 一条对话问答链能在统一 runtime 下执行
- 节点结果能进入 mission / session / replay

## Agent 5：人工输入与会话分支能力簇

### 第一轮任务

按下面顺序推进：

1. `web-aigc-node-user_input`
2. `web-aigc-node-selection`
3. `web-aigc-node-confirm_judge`

### 第二轮再做

4. `web-aigc-node-param_collection`
5. `web-aigc-node-intent_recognition`
6. `web-aigc-node-command_list`
7. `web-aigc-node-recommended_commands`

### 第一轮交付标准

- graph instance 能进入等待态
- 用户输入能恢复执行
- session / mission 上能看到对应状态

## Agent 6：检索与内容处理能力簇

### 第一轮任务

按下面顺序推进：

1. `web-aigc-node-document_search`
2. `web-aigc-node-fragment_search`
3. `web-aigc-node-qa_search`
4. `web-aigc-node-long_text_extraction`

### 第二轮再做

5. `web-aigc-node-graph_search`
6. `web-aigc-node-web_search`
7. `web-aigc-node-file_slicing`
8. `web-aigc-node-file_translation`
9. `web-aigc-node-excel_read`
10. `web-aigc-node-static_webpage_read`
11. `web-aigc-node-file_generation`
12. `web-aigc-node-similarity_match`

### 放行条件

- Agent 4 已固定对检索底座的调用方式

## Agent 7：多模态与输出能力簇

### 第一轮任务

按下面顺序推进：

1. `web-aigc-node-audio_recognition`
2. `web-aigc-node-ocr_recognition`

### 第二轮再做

3. `web-aigc-node-image_search`
4. `web-aigc-node-ai_ppt`
5. `web-aigc-node-dynamic_chart`

### 第一轮交付标准

- OCR / ASR 节点能在 runtime 中执行
- 产物能进入 artifact / replay 体系

## Agent 8：工具、Agent 与外部调用能力簇

### 第一轮任务

只放：

1. `web-aigc-node-mcp`
2. `web-aigc-node-auto_agent`

### 第二轮再做

3. `web-aigc-node-internal_api`
4. `web-aigc-node-passthrough_api`
5. `web-aigc-node-message_notification`

### 第一轮交付标准

- MCP / Agent 调用链打通
- 不突破 Agent 3 的安全门禁

## Agent 9：控制流与图中台能力簇

### 第一轮任务

按下面顺序推进：

1. `web-aigc-node-start`
2. `web-aigc-node-end`
3. `web-aigc-node-format_output`
4. `web-aigc-node-variable_assignment`

### 第二轮再做

5. `web-aigc-node-condition`
6. `web-aigc-node-flow_jump`
7. `web-aigc-node-loop`
8. `web-aigc-node-orchestration_recognition_jump`

### 放行条件

- Agent 1 已固定 transition 语义

## Agent 10：高风险写操作与宿主动作能力簇

### 第一轮任务

只放低风险或读路径：

1. `web-aigc-node-vector_query`
2. `web-aigc-node-open_page`
3. `web-aigc-node-open_report`
4. `web-aigc-node-open_dashboard`

### 第二轮再做

5. `web-aigc-node-get_device_info`
6. `web-aigc-node-get_location_info`

### 最后才做

7. `web-aigc-node-vector_insert`
8. `web-aigc-node-vector_update`
9. `web-aigc-node-vector_delete`
10. `web-aigc-node-transaction_flow`

### 放行条件

- 必须通过 G3

## 第一晚最值得完成的最小闭环

如果只看“今晚最值”的目标，建议锁定下面这条链路：

1. 平台主干 A 跑通 runtime kernel
2. 平台主干 B 跑通 mission / session projection
3. Agent 4 跑通 `dialogue + knowledge_qa`
4. Agent 5 跑通 `user_input + selection + confirm_judge`
5. Agent 7 跑通 `audio_recognition + ocr_recognition`
6. Agent 8 跑通 `mcp`
7. Agent 10 跑通 `vector_query`

这条链路一旦成立，就意味着：

- 平台已经不是纸面方案
- 节点编排已经可以跑出真正的用户价值
- 后面的 40 多个节点接入只是扩展，而不是重新起盘

## 夜间检查点

建议设定 4 个检查点：

### Checkpoint 1：启动后 30 分钟

- Agent 1 是否给出最小 runtime contract
- Agent 2 是否给出最小 instance / mission / session 映射

### Checkpoint 2：启动后 90 分钟

- Agent 4 / 5 / 7 / 8 / 10 是否全部拿到自己的接口边界

### Checkpoint 3：启动后 180 分钟

- 最小闭环是否已有 smoke 级可验证链路

### Checkpoint 4：收尾前

- 是否放行 Agent 6、9、10 的第二轮
- 是否保留高风险写路径到下一轮

## 最后一句

真正高效的并行不是“开更多 Agent”，而是：

- 让平台 Agent 先收住共识
- 让节点 Agent 在稳定边界内扩展
- 让高风险动作永远晚于治理门禁

按这份启动顺序推进，才是这 `58` 个 spec 最接近“边睡觉边长进度”的方式。
