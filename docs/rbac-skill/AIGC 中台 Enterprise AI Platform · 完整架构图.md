> 🔧 **V2 修订说明**：本图是详图。本系统在 V2 中为**执行点（PEP）**：`RBAC_GATE/RETRIEVAL_AUTH` 改为委托 PDP；`SKILL_CONFIG` 已改名 `TOOL_SKILL_CONFIG` 以与「Skill 能力」区分（P0-1/P2-9）。详见《平台架构 V2 修订版 - 公共内核与接缝治理》。

```mermaid
%% =====================================================
%% AIGC 中台 / Enterprise AI Platform · 完整架构图
%% ● = 项目已有或已规划模块
%% ◆ = 建议补齐的生产级治理能力
%% 实线 = 主配置、执行与数据链路
%% 虚线 = 审计、缓存、反馈、失效与重入链路
%% =====================================================

flowchart TB

%% =====================================================
%% 00 交互与入口
%% =====================================================
subgraph SURFACE["00 交互与入口 / Surface"]
direction LR

WORKBENCH["● AIGC 工作台<br/>应用入口、会话入口、快捷操作"]:::surface
ORCH_DESIGNER["● Agent 编排设计器<br/>画布、节点、边、变量、调试"]:::surface
NODE_CENTER["● 节点定义中心<br/>节点 Schema、配置面板、权限"]:::surface
KNOWLEDGE_CENTER["● 知识库中心<br/>知识库、文档、问答、检索测试"]:::surface
VECTOR_GRAPH_CENTER["● 向量与图谱中心<br/>向量库、集合、图谱、本体"]:::surface
MODEL_CENTER["● 模型与 Prompt 中心<br/>模型配置、Prompt、词典、卡片"]:::surface
PLUGIN_CENTER["● MCP 插件中心<br/>工具、插件、技能、连接配置"]:::surface
MONITOR_CENTER["● 监控分析中心<br/>模型、会话、输入、反馈、应用"]:::surface
AGENT_APP_UI["● Agent 应用与终端用户界面<br/>聊天、问答、任务、报告"]:::surface
OPEN_API["◆ Open API 与 SDK<br/>外部系统、移动端、嵌入式调用"]:::surface

end

%% =====================================================
%% 01 接入、身份与租户边界
%% =====================================================
subgraph INGRESS["01 接入、身份与租户边界 / Ingress"]
direction LR

GATEWAY{"◆ API Gateway<br/>TLS、CORS、限流、WAF、API 版本"}:::gate
AIGC_ROUTES["● AIGC Routes<br/>LLM、Flow、Knowledge、Vector、Graph、Monitor"]:::core
AUTH_GATE{"● JWT 认证<br/>用户状态、登录态、Token"}:::gate
TENANT_GUARD{"● 租户隔离<br/>tenantId、租户状态、资源边界"}:::gate
RBAC_GATE{"● RBAC 权限 Gate<br/>模块、编排、知识库、插件、监控权限"}:::gate
API_ACCESS{"◆ API Access Guard<br/>app_key、app_secret、IP 白名单、调用配额"}:::trust
RATE_LIMIT{"◆ AI Rate Limit<br/>接口、模型、租户、用户多级限流"}:::gate
REQUEST_CONTEXT["◆ Request Context<br/>userId、tenantId、roles、appId<br/>sessionId、traceId、clientType"]:::state

end

%% =====================================================
%% 02 配置与资产控制平面
%% =====================================================
subgraph CONTROL_PLANE["02 AI 配置与资产控制平面 / Control Plane"]
direction TB

subgraph ORCH_CONTROL["Agent 编排定义与发布"]
direction LR

ORCH_CATEGORY["● 编排分类<br/>业务域、标签、目录"]:::policy
ORCH_DEF["● 编排定义<br/>Flow Definition、节点、边、变量"]:::policy
ORCH_VERSION["● 编排版本<br/>草稿、已发布、历史、恢复"]:::ledger
ORCH_PERMISSION["● 编排权限<br/>查看、编辑、执行、管理"]:::policy
WAKE_WORD["● 唤醒词配置<br/>触发词、向量同步、匹配策略"]:::policy
SCHEDULE_TASK["● 定时任务<br/>单次、周期、触发规则"]:::policy
APP_BINDING["● 关联应用<br/>应用入口、会话入口、业务场景"]:::policy
FLOW_VALIDATE["● Flow Validator<br/>节点完整性、边连通性、变量引用"]:::gate
FLOW_PUBLISH_GATE{"◆ Flow Publish Gate<br/>版本冻结、节点可用、权限、依赖校验"}:::gate
ACTIVE_ORCH["● Active Orchestration<br/>当前可执行版本"]:::done

end

subgraph NODE_CONTROL["节点注册与执行契约"]
direction LR

NODE_REGISTRY["● Node Registry<br/>节点类型、分类、能力元数据"]:::policy
NODE_SCHEMA["● Node Schema<br/>inputSchema、outputSchema、配置 Schema"]:::policy
NODE_CONFIG["● Node Config<br/>模型、Prompt、工具、变量、参数"]:::policy
BASE_EXECUTOR["● BaseNodeExecutor<br/>beforeExecute、execute、afterExecute、onError"]:::core
NODE_PERMISSION["● Node Permission<br/>节点启用、角色授权、租户可见"]:::policy
NODE_PACKAGE["◆ Node Package<br/>自定义节点、版本、依赖、沙箱声明"]:::policy
NODE_TEST_GATE{"◆ Node Test Gate<br/>Schema、样例、权限、依赖、回归测试"}:::gate

end

subgraph MODEL_PROMPT_CONTROL["模型、Prompt 与语义资产"]
direction LR

MODEL_CONFIG["● Model Config<br/>Provider、模型、参数、能力标签"]:::policy
MODEL_CAPABILITY["● Capability Evaluation<br/>模型能力、场景评测、评分"]:::policy
PROMPT_TEMPLATE["● Prompt Template<br/>系统提示词、变量、版本、测试"]:::policy
AGENT_DICTIONARY["● Agent Dictionary<br/>术语、别名、领域词、同义词"]:::policy
CARD_CONFIG["● Card Config<br/>结果卡片、消息卡片、展示规则"]:::policy
APP_LINK["● App Link<br/>应用跳转、页面联动、结果落地"]:::policy
PROMPT_VERSION["◆ Prompt Version<br/>草稿、灰度、回滚、评估关联"]:::ledger

end

subgraph KNOWLEDGE_CONTROL["知识、向量与图谱资产"]
direction LR

KB_DEF["● Knowledge Base<br/>知识库定义、分块策略、状态"]:::policy
KB_RESOURCE["● Knowledge Resource<br/>文档、问答、网页、代码、文件"]:::policy
KB_PERMISSION["● Document Permission<br/>知识库、文档、片段访问范围"]:::policy
KB_KEYWORDS["● Document Keywords<br/>关键词、标签、分类、摘要"]:::policy
DOC_TEMPLATE["● File Template<br/>文件解析、导入映射、格式规则"]:::policy
THIRD_PARTY_SYNC["● Third Party Doc Sync<br/>外部文档同步与状态管理"]:::policy
VECTOR_CONFIG["● Vector DB Config<br/>连接、认证、索引配置"]:::policy
VECTOR_COLLECTION["● Vector Collection<br/>维度、距离度量、集合策略"]:::policy
GRAPH_CONFIG["● Graph DB 与 Structure<br/>图库连接、实体、关系、结构"]:::policy
ONTOLOGY["● Ontology<br/>概念、属性、关系、映射规则"]:::policy
ASSET_VERSION["◆ Knowledge Asset Version<br/>文档、索引、图谱、权限快照"]:::ledger

end

subgraph TOOL_CONTROL["工具、插件与外部能力"]
direction LR

MCP_PLUGIN["● MCP Plugin Center<br/>插件注册、工具 Schema、状态"]:::policy
TOOL_SKILL_CONFIG["● Tool-Skill Config<br/>技能定义、参数、调用约束"]:::policy
AGENT_REFERENCE["● Agent Reference<br/>子 Agent、子编排、调用引用"]:::policy
INTERNAL_API_DEF["● Internal API Config<br/>内部接口、认证、映射规则"]:::policy
EXTERNAL_API_DEF["● External API Config<br/>第三方 API、认证、请求模板"]:::policy
TOOL_POLICY["◆ Tool Policy<br/>工具白名单、风险级别、调用预算"]:::policy
SECRET_REF["◆ Secret Reference<br/>密钥引用、服务凭证、轮换策略"]:::trust

end

end

%% =====================================================
%% 03 编排执行控制平面
%% =====================================================
subgraph EXECUTION_PLANE["03 Agent 编排执行控制平面 / Execution Plane"]
direction TB

RUN_TRIGGER["● 执行触发器<br/>会话消息、手动运行、API、唤醒词、定时任务"]:::core
INPUT_GUARD{"◆ Input Guard<br/>输入长度、敏感词、注入检测、文件校验"}:::gate
FLOW_INSTANCE_FACTORY["● Flow Instance Factory<br/>创建实例、冻结版本、初始化变量"]:::core
FLOW_INSTANCE["● AigcFlowInstance<br/>运行状态、当前节点、执行结果、错误信息"]:::state
FLOW_CONTEXT["● Flow Context<br/>用户输入、变量、节点输出、会话上下文"]:::state
ORCHESTRATOR["● Flow Executor<br/>调度节点、推进边、处理状态"]:::core
NODE_SCHEDULER["● Node Scheduler<br/>选择就绪节点、并行策略、执行顺序"]:::core
NODE_EXECUTOR["● Node Executor Dispatcher<br/>按节点类型调用具体执行器"]:::core
FLOW_CONTROL["● Flow Control<br/>条件、循环、跳转、暂停、结束、异常分流"]:::core
HUMAN_WAIT["● Await User Input<br/>参数收集、确认判断、用户输入节点"]:::await
ASYNC_GATE{"◆ Async Job Gate<br/>长任务、异步任务、重试、超时处理"}:::gate
FLOW_RESULT["● Flow Result<br/>outputs、logs、status、artifacts"]:::report
FLOW_COMPLETE["● Execution Complete<br/>success、failed、cancelled、terminated"]:::done

end

%% =====================================================
%% 04 节点能力池
%% =====================================================
subgraph CAPABILITY_POOL["04 节点能力池 / Capability Pool"]
direction TB

subgraph INTERACTION_NODES["交互与控制节点"]
direction LR

USER_INPUT_NODE["● User Input<br/>收集用户输入"]:::cap
PARAMETER_NODE["● Parameter Collection<br/>参数收集与校验"]:::cap
ROBOT_REPLY_NODE["● Robot Reply<br/>机器人回复、提示、语音"]:::cap
CONFIRM_NODE["● Confirm Judge<br/>确认、否定、其他分支"]:::cap
COMMAND_NODE["● Command List 与 Selection<br/>指令展示、选项选择"]:::cap
DIALOGUE_NODE["● Dialogue<br/>多轮对话、上下文管理"]:::cap
CONDITION_NODE["● Condition<br/>表达式判断、确定性分支"]:::cap
INTENT_NODE["● Intent Recognition<br/>LLM 语义分类、置信度、分支"]:::cap
LOOP_NODE["● Loop<br/>循环体、次数、退出条件"]:::cap
JUMP_NODE["● Flow Jump<br/>静态跳转、动态跳转、子流程"]:::cap
END_NODE["● End Node<br/>结束、输出、状态收敛"]:::cap

end

subgraph LLM_AGENT_NODES["LLM 与自主 Agent 节点"]
direction LR

LLM_NODE["● LLM Node<br/>聊天、生成、结构化输出"]:::cap
AUTO_AGENT_NODE["● Auto Agent<br/>ReAct 循环、工具选择、最大步数"]:::cap
FORMAT_NODE["● Format Output<br/>格式化、结构化、XSS 过滤"]:::cap
SUMMARY_NODE["◆ Long Text Summary<br/>长文本总结、压缩、提炼"]:::cap
TRANSLATION_NODE["● File Translation<br/>翻译、语言转换、格式保留"]:::cap
RECOMMEND_NODE["● Recommended Commands<br/>推荐问题、推荐动作"]:::cap

end

subgraph KNOWLEDGE_NODES["知识检索与内容节点"]
direction LR

KB_QA_NODE["● Knowledge QA<br/>知识库问答、引用返回"]:::cap
DOC_SEARCH_NODE["● Document Search<br/>文档检索、筛选、排序"]:::cap
FRAGMENT_NODE["● Fragment Search<br/>片段检索、重排、阈值过滤"]:::cap
WEB_QA_NODE["● Web QA 与 Web Search<br/>网络检索、问答增强"]:::cap
CODE_KB_NODE["● Code Knowledge Base<br/>代码检索、仓库知识问答"]:::cap
GRAPH_SEARCH_NODE["● Graph Search<br/>图谱检索、关系推理"]:::cap
QA_SEARCH_NODE["● QA Search<br/>问答对匹配、答案召回"]:::cap

end

subgraph TOOL_NODES["工具、API 与业务节点"]
direction LR

MCP_NODE["● MCP Node<br/>调用 MCP 工具与服务"]:::cap
INTERNAL_API_NODE["● Internal API<br/>内部服务调用"]:::cap
PASSTHROUGH_API_NODE["● Passthrough API<br/>外部接口透传"]:::cap
TRANSACTION_NODE["● Transaction Flow<br/>业务事务、步骤编排"]:::cap
MESSAGE_NODE["● Message Notification<br/>站内信、邮件、企业 IM"]:::cap
OPEN_PAGE_NODE["● Open Page<br/>系统页面、外部链接、参数映射"]:::cap
OPEN_REPORT_NODE["● Open Report<br/>报表、仪表盘、结果页"]:::cap
OPEN_DASHBOARD_NODE["● Open Dashboard<br/>运营看板、数据大屏"]:::cap

end

subgraph MEDIA_DOCUMENT_NODES["文件、多模态与办公节点"]
direction LR

FILE_SLICE_NODE["● File Slicing<br/>文件拆分、切片、提取"]:::cap
EXTRACT_NODE["● Long Text Extraction<br/>内容提取、摘要、字段抽取"]:::cap
OCR_NODE["● OCR Recognition<br/>图片与文档识别"]:::cap
AUDIO_NODE["● Audio Recognition<br/>语音转写、音频理解"]:::cap
EXCEL_NODE["● Excel Read<br/>表格读取、字段映射"]:::cap
PPT_NODE["● AI PPT<br/>大纲、内容、演示文稿生成"]:::cap
FILE_GENERATION_NODE["● File Generation<br/>文档、表格、报告生成"]:::cap
IMAGE_SEARCH_NODE["● Image Search<br/>图片检索、相似匹配"]:::cap
DYNAMIC_CHART_NODE["● Dynamic Chart<br/>图表生成、数据可视化"]:::cap

end

subgraph VECTOR_GRAPH_NODES["向量、图谱与数据节点"]
direction LR

VECTOR_QUERY_NODE["● Vector Query<br/>相似度检索、Top K、过滤"]:::cap
VECTOR_INSERT_NODE["● Vector Insert<br/>向量写入"]:::cap
VECTOR_UPDATE_NODE["● Vector Update<br/>向量更新"]:::cap
VECTOR_DELETE_NODE["● Vector Delete<br/>向量删除"]:::cap
SIMILARITY_NODE["● Similarity Match<br/>文本、图片、实体相似度"]:::cap
DEVICE_NODE["● Device Info<br/>设备与客户端信息"]:::cap
LOCATION_NODE["● Location Info<br/>地理位置与上下文"]:::cap

end

end

%% =====================================================
%% 05 LLM、RAG、工具执行拓扑
%% =====================================================
subgraph EXECUTOR_TOPOLOGY["05 LLM、RAG 与工具执行拓扑 / Executor Topology"]
direction TB

subgraph LLM_RUNTIME["LLM Runtime"]
direction LR

PROMPT_RENDERER["● Prompt Renderer<br/>模板变量、系统提示、词典、上下文拼装"]:::core
MODEL_ROUTER["● Model Router<br/>按节点、场景、能力选择模型"]:::core
CHAT_SERVICE["● LLM Chat Service<br/>chat、stream、JSON output"]:::core
EMBED_SERVICE["● Embedding Service<br/>文本向量化、批量向量化"]:::core
PROVIDER_ADAPTER["● Provider Adapter<br/>统一 Provider 协议、错误映射、健康检查"]:::core
EXTERNAL_MODEL["● External Model Providers<br/>云模型、自部署模型、推理服务"]:::runtime
MODEL_FALLBACK["◆ Model Fallback<br/>超时、限流、降级模型、熔断恢复"]:::fallback
TOKEN_BUDGET{"◆ Token Budget Gate<br/>租户、应用、用户、任务成本控制"}:::gate

end

subgraph RAG_RUNTIME["RAG Runtime"]
direction LR

INGEST_PIPELINE["● Ingest Pipeline<br/>parse → chunk → embed → store"]:::core
QUERY_PIPELINE["● Query Pipeline<br/>retrieve → rerank → generate"]:::core
QUERY_REWRITE["◆ Query Rewrite<br/>改写、扩展、意图识别"]:::cap
RETRIEVAL_AUTH{"◆ Retrieval Permission Gate<br/>知识库、文档、片段级权限过滤"}:::gate
SEARCH_ROUTER["● Search Mode Router<br/>向量、全文、问答、图谱、摘要"]:::core
RERANKER["◆ Reranker<br/>重排、去重、阈值过滤"]:::cap
CONTEXT_PACKER["● Context Packer<br/>片段拼装、引用、上下文窗口控制"]:::core
CITATION_BUILDER["◆ Citation Builder<br/>来源、页码、片段、可信度"]:::core

end

subgraph TOOL_RUNTIME["Tool Runtime"]
direction LR

TOOL_ROUTER["● Tool Router<br/>Skill、Agent、MCP、API 工具分发"]:::core
MCP_EXECUTOR["● MCP Executor<br/>MCP Client、工具调用、结果标准化"]:::core
API_EXECUTOR["● API Executor<br/>内部 API、外部 API、透传 API"]:::core
SUBFLOW_EXECUTOR["● Subflow Executor<br/>子编排、子 Agent、递归执行"]:::core
TOOL_POLICY_GATE{"◆ Tool Policy Gate<br/>白名单、参数校验、风险等级、预算"}:::gate
TOOL_SANDBOX["◆ Tool Sandbox<br/>超时、网络边界、命令隔离、输出限制"]:::trust

end

subgraph DOCUMENT_RUNTIME["文件与多模态 Runtime"]
direction LR

FILE_PARSER["● File Parser<br/>格式识别、解析、提取、清洗"]:::core
MEDIA_ENGINE["● Media Engine<br/>OCR、音频、图片、文档、PPT"]:::core
FILE_STORE["● File Store<br/>上传文件、解析结果、生成文件"]:::runtime
ARTIFACT_BUILDER["● Artifact Builder<br/>报告、PPT、表格、附件、下载链接"]:::core

end

end

%% =====================================================
%% 06 运行时、存储与异步
%% =====================================================
subgraph RUNTIME["06 运行时、存储与异步 / Runtime"]
direction LR

MYSQL["● MySQL / Sequelize<br/>编排、版本、节点、知识库、配置、监控、反馈"]:::runtime
REDIS["● Redis<br/>缓存、限流、会话、分布式锁、临时状态"]:::runtime
QDRANT["● Qdrant<br/>向量集合、向量检索、相似度搜索"]:::runtime
GRAPH_DB["◆ Graph Database<br/>图谱实体、关系、推理索引"]:::runtime
OBJECT_STORAGE["● File Storage<br/>uploads、knowledge、解析文件、生成物"]:::runtime
BULL_QUEUE["● Bull Queue<br/>索引、同步、异步节点、定时任务、通知"]:::bus
WORKER["● Worker Process<br/>任务消费、重试、失败处理、归档"]:::runtime
EVENT_BUS["◆ AIGC Event Bus<br/>instance、node、model、knowledge、plugin 事件"]:::bus
REALTIME_STORE["◆ Realtime Store<br/>会话状态、节点状态、流式结果、进度"]:::state
SOCKET_RELAY["◆ Socket 或 SSE Relay<br/>流式输出、实例进度、通知推送"]:::runtime
SEARCH_INDEX["◆ Search Index<br/>知识资产、编排、插件、应用搜索"]:::runtime

end

%% =====================================================
%% 07 信任、安全、监控与反馈重入
%% =====================================================
subgraph TRUST_AND_REENTRY["07 信任、安全、监控与反馈重入 / Trust & Re-entry"]
direction TB

OUTPUT_GUARD{"◆ Output Guard<br/>敏感内容、越权引用、格式约束、风险提示"}:::gate
PII_REDACTION["◆ PII Redaction<br/>输入脱敏、日志脱敏、输出脱敏"]:::trust
SECRET_BOUNDARY["◆ Secret Boundary<br/>模型 Key、插件凭证、不进入日志与结果"]:::trust
AUDIT_LEDGER["● AIGC Audit Ledger<br/>实例、节点、模型、工具、知识访问记录"]:::ledger
DECISION_LEDGER["◆ Decision Ledger<br/>路由、模型选择、检索过滤、工具调用原因"]:::ledger
TRACE_CONTEXT["◆ Trace Context<br/>tenantId、sessionId、instanceId、nodeId、traceId"]:::trust
RETRY_MANAGER["◆ Retry Manager<br/>超时、退避、幂等、失败重试"]:::reentry
ESCALATION["◆ Escalation<br/>人工介入、暂停、终止、异常工单"]:::reentry
INVALIDATION["◆ Invalidation Engine<br/>模型、Prompt、知识、权限、插件变更失效"]:::reentry
EVALUATION["● Capability Evaluation<br/>模型效果、Prompt 效果、RAG 质量评测"]:::trust
FEEDBACK["● Interaction Feedback<br/>评分、评论、纠错、采纳反馈"]:::trust

end

%% =====================================================
%% 08 监控与输出
%% =====================================================
subgraph OBSERVABILITY["08 监控分析与运营 / Observability"]
direction LR

MODEL_USAGE["● Model Usage Monitor<br/>调用次数、Token、延迟、成本、错误"]:::trust
SESSION_MONITOR["● Session Monitor<br/>会话、实例、节点、执行状态"]:::trust
INPUT_MONITOR["● User Input Monitor<br/>输入日志、风险等级、趋势"]:::trust
CONTENT_MONITOR["● Content Extraction Monitor<br/>解析量、文件类型、耗时、失败率"]:::trust
APP_USAGE["● App Usage Analysis<br/>应用访问、活跃用户、转化、留存"]:::trust
PLUGIN_ANALYSIS["● Plugin Analysis<br/>工具调用、成功率、耗时、失败原因"]:::trust
RAG_QUALITY["● RAG Feedback<br/>召回质量、答案评分、引用反馈"]:::trust
METRICS["◆ Metrics 和 Tracing<br/>吞吐、失败率、队列积压、端到端耗时"]:::trust
ALERTING["◆ Alerting<br/>模型故障、索引失败、成本异常、权限异常"]:::trust
OPS_DASHBOARD["● Operations Dashboard<br/>运营看板、实例下钻、日志回放"]:::report

end

subgraph OUTPUT["09 输出与交付 / Output"]
direction LR

CHAT_OUTPUT["● 对话与流式回复<br/>内容、引用、建议问题、卡片"]:::report
FLOW_OUTPUT["● 编排执行结果<br/>outputs、logs、variables、status"]:::report
KNOWLEDGE_OUTPUT["● RAG 问答结果<br/>答案、引用、片段、可信度"]:::report
ARTIFACT_OUTPUT["● 文件与多模态产物<br/>报告、PPT、表格、附件、链接"]:::report
AGENT_APP_OUTPUT["● Agent 应用<br/>客服、知识助手、创作助手、业务助手"]:::report
API_OUTPUT["◆ Open API Response<br/>同步结果、异步任务、Webhook 回调"]:::report

end

%% =====================================================
%% 入口与身份链路
%% =====================================================
WORKBENCH --> GATEWAY
ORCH_DESIGNER --> GATEWAY
NODE_CENTER --> GATEWAY
KNOWLEDGE_CENTER --> GATEWAY
VECTOR_GRAPH_CENTER --> GATEWAY
MODEL_CENTER --> GATEWAY
PLUGIN_CENTER --> GATEWAY
MONITOR_CENTER --> GATEWAY
AGENT_APP_UI --> GATEWAY
OPEN_API --> GATEWAY

GATEWAY --> AIGC_ROUTES
AIGC_ROUTES --> AUTH_GATE
AUTH_GATE --> TENANT_GUARD
TENANT_GUARD --> RBAC_GATE
RBAC_GATE --> RATE_LIMIT
RATE_LIMIT --> REQUEST_CONTEXT
OPEN_API --> API_ACCESS
API_ACCESS --> REQUEST_CONTEXT

%% =====================================================
%% 控制面配置链路
%% =====================================================
ORCH_DESIGNER --> ORCH_DEF
ORCH_DESIGNER --> ORCH_CATEGORY
ORCH_DESIGNER --> ORCH_VERSION
ORCH_DESIGNER --> WAKE_WORD
ORCH_DESIGNER --> SCHEDULE_TASK
ORCH_DESIGNER --> APP_BINDING

ORCH_DEF --> FLOW_VALIDATE
NODE_CONFIG --> FLOW_VALIDATE
NODE_REGISTRY --> FLOW_VALIDATE
FLOW_VALIDATE --> ORCH_VERSION
ORCH_VERSION --> FLOW_PUBLISH_GATE
ORCH_PERMISSION --> FLOW_PUBLISH_GATE
FLOW_PUBLISH_GATE --> ACTIVE_ORCH

NODE_CENTER --> NODE_REGISTRY
NODE_CENTER --> NODE_SCHEMA
NODE_CENTER --> NODE_CONFIG
NODE_CENTER --> NODE_PERMISSION
NODE_CENTER --> NODE_PACKAGE
NODE_SCHEMA --> BASE_EXECUTOR
NODE_CONFIG --> NODE_TEST_GATE
NODE_PACKAGE --> NODE_TEST_GATE
NODE_TEST_GATE --> NODE_REGISTRY

MODEL_CENTER --> MODEL_CONFIG
MODEL_CENTER --> MODEL_CAPABILITY
MODEL_CENTER --> PROMPT_TEMPLATE
MODEL_CENTER --> AGENT_DICTIONARY
MODEL_CENTER --> CARD_CONFIG
MODEL_CENTER --> APP_LINK
PROMPT_TEMPLATE --> PROMPT_VERSION

KNOWLEDGE_CENTER --> KB_DEF
KNOWLEDGE_CENTER --> KB_RESOURCE
KNOWLEDGE_CENTER --> KB_PERMISSION
KNOWLEDGE_CENTER --> KB_KEYWORDS
KNOWLEDGE_CENTER --> DOC_TEMPLATE
KNOWLEDGE_CENTER --> THIRD_PARTY_SYNC
VECTOR_GRAPH_CENTER --> VECTOR_CONFIG
VECTOR_GRAPH_CENTER --> VECTOR_COLLECTION
VECTOR_GRAPH_CENTER --> GRAPH_CONFIG
VECTOR_GRAPH_CENTER --> ONTOLOGY
KB_DEF --> ASSET_VERSION
VECTOR_COLLECTION --> ASSET_VERSION
GRAPH_CONFIG --> ASSET_VERSION

PLUGIN_CENTER --> MCP_PLUGIN
PLUGIN_CENTER --> TOOL_SKILL_CONFIG
PLUGIN_CENTER --> AGENT_REFERENCE
PLUGIN_CENTER --> INTERNAL_API_DEF
PLUGIN_CENTER --> EXTERNAL_API_DEF
MCP_PLUGIN --> TOOL_POLICY
TOOL_SKILL_CONFIG --> TOOL_POLICY
AGENT_REFERENCE --> TOOL_POLICY
INTERNAL_API_DEF --> SECRET_REF
EXTERNAL_API_DEF --> SECRET_REF

%% =====================================================
%% 执行主链路
%% =====================================================
AGENT_APP_UI --> RUN_TRIGGER
OPEN_API --> RUN_TRIGGER
WAKE_WORD --> RUN_TRIGGER
SCHEDULE_TASK --> RUN_TRIGGER

REQUEST_CONTEXT --> INPUT_GUARD
INPUT_GUARD --> FLOW_INSTANCE_FACTORY
ACTIVE_ORCH --> FLOW_INSTANCE_FACTORY
FLOW_INSTANCE_FACTORY --> FLOW_INSTANCE
FLOW_INSTANCE_FACTORY --> FLOW_CONTEXT
FLOW_INSTANCE --> ORCHESTRATOR
FLOW_CONTEXT --> ORCHESTRATOR
ORCHESTRATOR --> NODE_SCHEDULER
NODE_SCHEDULER --> NODE_EXECUTOR
NODE_EXECUTOR --> FLOW_CONTROL

FLOW_CONTROL --> NODE_SCHEDULER
FLOW_CONTROL --> HUMAN_WAIT
HUMAN_WAIT --> NODE_SCHEDULER
FLOW_CONTROL --> ASYNC_GATE
ASYNC_GATE --> BULL_QUEUE
FLOW_CONTROL --> FLOW_RESULT
FLOW_RESULT --> FLOW_COMPLETE

%% =====================================================
%% 节点执行分发
%% =====================================================
NODE_EXECUTOR --> USER_INPUT_NODE
NODE_EXECUTOR --> PARAMETER_NODE
NODE_EXECUTOR --> ROBOT_REPLY_NODE
NODE_EXECUTOR --> CONFIRM_NODE
NODE_EXECUTOR --> COMMAND_NODE
NODE_EXECUTOR --> DIALOGUE_NODE
NODE_EXECUTOR --> CONDITION_NODE
NODE_EXECUTOR --> INTENT_NODE
NODE_EXECUTOR --> LOOP_NODE
NODE_EXECUTOR --> JUMP_NODE
NODE_EXECUTOR --> END_NODE

NODE_EXECUTOR --> LLM_NODE
NODE_EXECUTOR --> AUTO_AGENT_NODE
NODE_EXECUTOR --> FORMAT_NODE
NODE_EXECUTOR --> SUMMARY_NODE
NODE_EXECUTOR --> TRANSLATION_NODE
NODE_EXECUTOR --> RECOMMEND_NODE

NODE_EXECUTOR --> KB_QA_NODE
NODE_EXECUTOR --> DOC_SEARCH_NODE
NODE_EXECUTOR --> FRAGMENT_NODE
NODE_EXECUTOR --> WEB_QA_NODE
NODE_EXECUTOR --> CODE_KB_NODE
NODE_EXECUTOR --> GRAPH_SEARCH_NODE
NODE_EXECUTOR --> QA_SEARCH_NODE

NODE_EXECUTOR --> MCP_NODE
NODE_EXECUTOR --> INTERNAL_API_NODE
NODE_EXECUTOR --> PASSTHROUGH_API_NODE
NODE_EXECUTOR --> TRANSACTION_NODE
NODE_EXECUTOR --> MESSAGE_NODE
NODE_EXECUTOR --> OPEN_PAGE_NODE
NODE_EXECUTOR --> OPEN_REPORT_NODE
NODE_EXECUTOR --> OPEN_DASHBOARD_NODE

NODE_EXECUTOR --> FILE_SLICE_NODE
NODE_EXECUTOR --> EXTRACT_NODE
NODE_EXECUTOR --> OCR_NODE
NODE_EXECUTOR --> AUDIO_NODE
NODE_EXECUTOR --> EXCEL_NODE
NODE_EXECUTOR --> PPT_NODE
NODE_EXECUTOR --> FILE_GENERATION_NODE
NODE_EXECUTOR --> IMAGE_SEARCH_NODE
NODE_EXECUTOR --> DYNAMIC_CHART_NODE

NODE_EXECUTOR --> VECTOR_QUERY_NODE
NODE_EXECUTOR --> VECTOR_INSERT_NODE
NODE_EXECUTOR --> VECTOR_UPDATE_NODE
NODE_EXECUTOR --> VECTOR_DELETE_NODE
NODE_EXECUTOR --> SIMILARITY_NODE
NODE_EXECUTOR --> DEVICE_NODE
NODE_EXECUTOR --> LOCATION_NODE

USER_INPUT_NODE --> FLOW_CONTROL
PARAMETER_NODE --> FLOW_CONTROL
ROBOT_REPLY_NODE --> FLOW_CONTROL
CONFIRM_NODE --> FLOW_CONTROL
COMMAND_NODE --> FLOW_CONTROL
DIALOGUE_NODE --> FLOW_CONTROL
CONDITION_NODE --> FLOW_CONTROL
INTENT_NODE --> FLOW_CONTROL
LOOP_NODE --> FLOW_CONTROL
JUMP_NODE --> FLOW_CONTROL
END_NODE --> FLOW_CONTROL

%% =====================================================
%% LLM 执行拓扑
%% =====================================================
LLM_NODE --> PROMPT_RENDERER
AUTO_AGENT_NODE --> PROMPT_RENDERER
DIALOGUE_NODE --> PROMPT_RENDERER
INTENT_NODE --> PROMPT_RENDERER
CONFIRM_NODE --> PROMPT_RENDERER
PROMPT_TEMPLATE --> PROMPT_RENDERER
AGENT_DICTIONARY --> PROMPT_RENDERER
FLOW_CONTEXT --> PROMPT_RENDERER

PROMPT_RENDERER --> TOKEN_BUDGET
TOKEN_BUDGET --> MODEL_ROUTER
MODEL_CONFIG --> MODEL_ROUTER
MODEL_CAPABILITY --> MODEL_ROUTER
MODEL_ROUTER --> CHAT_SERVICE
MODEL_ROUTER --> EMBED_SERVICE
CHAT_SERVICE --> PROVIDER_ADAPTER
EMBED_SERVICE --> PROVIDER_ADAPTER
PROVIDER_ADAPTER --> EXTERNAL_MODEL
PROVIDER_ADAPTER -.异常降级.-> MODEL_FALLBACK
MODEL_FALLBACK --> MODEL_ROUTER

CHAT_SERVICE --> FLOW_CONTROL
EMBED_SERVICE --> FLOW_CONTROL

%% =====================================================
%% RAG 与知识链路
%% =====================================================
KB_RESOURCE --> INGEST_PIPELINE
DOC_TEMPLATE --> INGEST_PIPELINE
THIRD_PARTY_SYNC --> INGEST_PIPELINE
INGEST_PIPELINE --> FILE_PARSER
FILE_PARSER --> EMBED_SERVICE
EMBED_SERVICE --> VECTOR_COLLECTION
VECTOR_COLLECTION --> QDRANT
INGEST_PIPELINE --> OBJECT_STORAGE
INGEST_PIPELINE --> MYSQL

KB_QA_NODE --> QUERY_PIPELINE
DOC_SEARCH_NODE --> QUERY_PIPELINE
FRAGMENT_NODE --> QUERY_PIPELINE
CODE_KB_NODE --> QUERY_PIPELINE
GRAPH_SEARCH_NODE --> QUERY_PIPELINE
QA_SEARCH_NODE --> QUERY_PIPELINE

QUERY_PIPELINE --> QUERY_REWRITE
QUERY_REWRITE --> RETRIEVAL_AUTH
KB_PERMISSION --> RETRIEVAL_AUTH
REQUEST_CONTEXT --> RETRIEVAL_AUTH
RETRIEVAL_AUTH --> SEARCH_ROUTER
SEARCH_ROUTER --> QDRANT
SEARCH_ROUTER --> GRAPH_DB
SEARCH_ROUTER --> SEARCH_INDEX
SEARCH_ROUTER --> RERANKER
RERANKER --> CONTEXT_PACKER
CONTEXT_PACKER --> CITATION_BUILDER
CONTEXT_PACKER --> PROMPT_RENDERER
CITATION_BUILDER --> FLOW_CONTROL

%% =====================================================
%% 工具与多模态链路
%% =====================================================
AUTO_AGENT_NODE --> TOOL_ROUTER
MCP_NODE --> TOOL_ROUTER
INTERNAL_API_NODE --> TOOL_ROUTER
PASSTHROUGH_API_NODE --> TOOL_ROUTER
TRANSACTION_NODE --> TOOL_ROUTER

TOOL_ROUTER --> TOOL_POLICY_GATE
TOOL_POLICY --> TOOL_POLICY_GATE
TOOL_POLICY_GATE --> TOOL_SANDBOX
TOOL_SANDBOX --> MCP_EXECUTOR
TOOL_SANDBOX --> API_EXECUTOR
TOOL_SANDBOX --> SUBFLOW_EXECUTOR
MCP_PLUGIN --> MCP_EXECUTOR
INTERNAL_API_DEF --> API_EXECUTOR
EXTERNAL_API_DEF --> API_EXECUTOR
AGENT_REFERENCE --> SUBFLOW_EXECUTOR
SECRET_REF --> MCP_EXECUTOR
SECRET_REF --> API_EXECUTOR

MCP_EXECUTOR --> FLOW_CONTROL
API_EXECUTOR --> FLOW_CONTROL
SUBFLOW_EXECUTOR --> FLOW_CONTROL

FILE_SLICE_NODE --> FILE_PARSER
EXTRACT_NODE --> FILE_PARSER
OCR_NODE --> MEDIA_ENGINE
AUDIO_NODE --> MEDIA_ENGINE
EXCEL_NODE --> FILE_PARSER
PPT_NODE --> MEDIA_ENGINE
FILE_GENERATION_NODE --> ARTIFACT_BUILDER
IMAGE_SEARCH_NODE --> MEDIA_ENGINE
DYNAMIC_CHART_NODE --> ARTIFACT_BUILDER

FILE_PARSER --> FILE_STORE
MEDIA_ENGINE --> FILE_STORE
FILE_STORE --> OBJECT_STORAGE
ARTIFACT_BUILDER --> OBJECT_STORAGE
ARTIFACT_BUILDER --> FLOW_CONTROL

%% =====================================================
%% 运行时与异步
%% =====================================================
ORCH_DEF --> MYSQL
ORCH_VERSION --> MYSQL
NODE_REGISTRY --> MYSQL
NODE_CONFIG --> MYSQL
KB_DEF --> MYSQL
KB_RESOURCE --> MYSQL
MCP_PLUGIN --> MYSQL
MODEL_CONFIG --> MYSQL
PROMPT_TEMPLATE --> MYSQL
FLOW_INSTANCE --> MYSQL
FLOW_RESULT --> MYSQL

FLOW_CONTEXT --> REDIS
REQUEST_CONTEXT --> REDIS
RATE_LIMIT --> REDIS
FLOW_INSTANCE --> REDIS

BULL_QUEUE --> WORKER
WORKER --> NODE_EXECUTOR
WORKER --> INGEST_PIPELINE
WORKER --> THIRD_PARTY_SYNC
WORKER --> SCHEDULE_TASK

FLOW_INSTANCE -.状态事件.-> EVENT_BUS
NODE_EXECUTOR -.节点事件.-> EVENT_BUS
CHAT_SERVICE -.模型事件.-> EVENT_BUS
INGEST_PIPELINE -.知识事件.-> EVENT_BUS
MCP_EXECUTOR -.插件事件.-> EVENT_BUS

EVENT_BUS --> REALTIME_STORE
REALTIME_STORE --> SOCKET_RELAY
SOCKET_RELAY --> WORKBENCH
SOCKET_RELAY --> AGENT_APP_UI
SOCKET_RELAY --> MONITOR_CENTER

KB_DEF --> SEARCH_INDEX
ORCH_DEF --> SEARCH_INDEX
MCP_PLUGIN --> SEARCH_INDEX
APP_BINDING --> SEARCH_INDEX

%% =====================================================
%% 信任、审计、反馈与重入
%% =====================================================
REQUEST_CONTEXT --> PII_REDACTION
PII_REDACTION --> INPUT_GUARD
SECRET_REF --> SECRET_BOUNDARY
FLOW_RESULT --> OUTPUT_GUARD
CITATION_BUILDER --> OUTPUT_GUARD
OUTPUT_GUARD --> CHAT_OUTPUT
OUTPUT_GUARD --> FLOW_OUTPUT
OUTPUT_GUARD --> KNOWLEDGE_OUTPUT
OUTPUT_GUARD --> ARTIFACT_OUTPUT
OUTPUT_GUARD --> AGENT_APP_OUTPUT
OUTPUT_GUARD --> API_OUTPUT

FLOW_INSTANCE -.审计.-> AUDIT_LEDGER
NODE_EXECUTOR -.审计.-> AUDIT_LEDGER
MODEL_ROUTER -.决策.-> DECISION_LEDGER
SEARCH_ROUTER -.检索决策.-> DECISION_LEDGER
TOOL_ROUTER -.工具决策.-> DECISION_LEDGER
REQUEST_CONTEXT --> TRACE_CONTEXT
TRACE_CONTEXT --> AUDIT_LEDGER
TRACE_CONTEXT --> DECISION_LEDGER

FLOW_CONTROL -.错误重试.-> RETRY_MANAGER
PROVIDER_ADAPTER -.调用失败.-> RETRY_MANAGER
MCP_EXECUTOR -.工具失败.-> RETRY_MANAGER
RETRY_MANAGER --> BULL_QUEUE
RETRY_MANAGER -.不能恢复.-> ESCALATION
ESCALATION --> HUMAN_WAIT

MODEL_CONFIG -.配置变更.-> INVALIDATION
PROMPT_VERSION -.Prompt 变更.-> INVALIDATION
ASSET_VERSION -.知识变更.-> INVALIDATION
TOOL_POLICY -.工具策略变更.-> INVALIDATION
INVALIDATION --> REDIS
INVALIDATION --> SEARCH_INDEX
INVALIDATION --> REALTIME_STORE

FEEDBACK --> EVALUATION
RAG_QUALITY --> EVALUATION
EVALUATION -.优化 Prompt.-> PROMPT_TEMPLATE
EVALUATION -.优化模型路由.-> MODEL_CONFIG
EVALUATION -.优化编排版本.-> ORCH_VERSION

%% =====================================================
%% 监控与运营
%% =====================================================
CHAT_SERVICE --> MODEL_USAGE
EMBED_SERVICE --> MODEL_USAGE
FLOW_INSTANCE --> SESSION_MONITOR
NODE_EXECUTOR --> SESSION_MONITOR
INPUT_GUARD --> INPUT_MONITOR
FILE_PARSER --> CONTENT_MONITOR
AGENT_APP_UI --> APP_USAGE
MCP_EXECUTOR --> PLUGIN_ANALYSIS
KNOWLEDGE_OUTPUT --> RAG_QUALITY
FEEDBACK --> RAG_QUALITY

MODEL_USAGE --> METRICS
SESSION_MONITOR --> METRICS
INPUT_MONITOR --> METRICS
CONTENT_MONITOR --> METRICS
APP_USAGE --> METRICS
PLUGIN_ANALYSIS --> METRICS
RAG_QUALITY --> METRICS

METRICS --> OPS_DASHBOARD
METRICS --> ALERTING
ALERTING -.故障处理.-> ESCALATION

%% =====================================================
%% 样式
%% =====================================================
classDef surface fill:#dbeafe,stroke:#2563eb,color:#172554,stroke-width:1.5px
classDef core fill:#e0e7ff,stroke:#4f46e5,color:#312e81,stroke-width:1.5px
classDef cap fill:#ede9fe,stroke:#7c3aed,color:#4c1d95,stroke-width:1.5px
classDef policy fill:#fae8ff,stroke:#c026d3,color:#701a75,stroke-width:1.5px
classDef gate fill:#fef3c7,stroke:#d97706,color:#78350f,stroke-width:1.5px
classDef trust fill:#cffafe,stroke:#0891b2,color:#164e63,stroke-width:1.5px
classDef ledger fill:#ccfbf1,stroke:#0f766e,color:#134e4a,stroke-width:1.5px
classDef runtime fill:#f5f5f4,stroke:#78716c,color:#292524,stroke-width:1.5px
classDef state fill:#f1f5f9,stroke:#64748b,color:#0f172a,stroke-width:1.5px
classDef reentry fill:#fee2e2,stroke:#dc2626,color:#7f1d1d,stroke-width:1.5px
classDef fallback fill:#ffedd5,stroke:#ea580c,color:#7c2d12,stroke-width:1.5px
classDef bus fill:#fef9c3,stroke:#ca8a04,color:#713f12,stroke-width:1.5px
classDef report fill:#dcfce7,stroke:#16a34a,color:#14532d,stroke-width:1.5px
classDef done fill:#dcfce7,stroke:#16a34a,color:#14532d,stroke-width:1.5px
classDef await fill:#e0f2fe,stroke:#0284c7,color:#0c4a6e,stroke-width:1.5px,stroke-dasharray: 5 5
```
