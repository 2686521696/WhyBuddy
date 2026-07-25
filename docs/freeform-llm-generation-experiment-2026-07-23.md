# LLM 自主生成结构/样式实验记录（2026-07-23）

> 结论先行：**"结构完全开放 + 数据必须有据可查"这两条能同时保住，但保住的方式
> 不是"讲清楚 schema"，是"用类型系统硬约束 + 校验失败自动重问"——前者在三轮
> 实验里被反复证明管不住模型，后者能把违规堵死在结构层面，代价是每次生成的
> 延迟涨 2-4 倍。另外，本次实验直接引入了 `instructor` 包，但仓库自己
> （`sliderule_llm/structured.py`）此前已经真机验证过这个包在本仓网关下会撞
> WAF UA 拦截 + Cloudflare 524 两堵墙，已改為把 reask 语义搬到自研流式客户端
> 上——这次实验能跑通大概率是运气好没撞上，往生产走必须走 `structured_llm_json`
> 那条路，不能直接依赖 `instructor` 包。**

---

## 一、背景

审查 Step 1-9 与 json-render / A2UI / tweakcn / amis / NocoBase / LowCode Engine /
Puck / DivKit 的差距时，归纳出 SlideRule 生成一个应用的三层结构：

- **槽位（唯一固定边界）**：`page.layout` 的 5 个区域（summary/primary/
  secondary/activity/content）本身存在，不可变。
- **LLM 自主规划执行**：主题、导航形态、每个槽位放哪些区块、放几个、什么
  顺序——这些由 LLM 决定，不是人写死答案。
- **争议点**：区块本身（"家具"）要不要也让 LLM 自己创造，而不是从 7 个
  预建区块类型（MetricGrid/TrendChart/RankedList/ActivityFeed/DataTable/
  QuickActionPanel/FilterBar）里选？

用户选择先验证最激进的一种："完全开放，LLM 直接写组件/样式代码"——
明知这条路子风险最高、跟现在 fail-closed 的地基冲突最大，先试出效果和边界
在哪里。

---

## 二、安全边界（贯穿全部实验）

不做"LLM 输出直接当代码跑"（eval/innerHTML）。改为：给 LLM 一套安全原子
积木（标签白名单 + CSS 属性白名单 + 图标引用白名单），渲染端只用安全 API
（`document.createElement` / React `createElement`）拼装，不执行任何 LLM
产出的可执行内容。图标是内置固定 SVG 表，`iconRef` 只是查表 key。

---

## 三、实验一：结构 + 样式完全开放，不接数据

**设计**：给 LLM 一份"设计一个客户工单处理流程可视化组件"的需求，只给
安全原子积木清单，不给任何"组件目录"，结构和样式全部由 LLM 自己拼。

**结果**：产出质量超出预期——四个阶段按语义分了四种颜色（接收=中性蓝、
分诊=预警紫、处理中=进行时橙、已解决=成功绿），自己加了 SLA 角标、状态条、
编号角标等设计细节。安全边界守住：全程无 `eval`/`innerHTML` 塞 LLM 原文。

**遗留问题**：截图里"2h 18m 平均解决时长""SLA 98.4%""本周闭环工单 1,284"
全部是 LLM 编出来的数字，没有一个绑定真实数据——结构完全开放之后，系统
不知道"哪个文字节点该接真数据、哪个是纯装饰文案"，这件事本身没法机械
判断。

---

## 四、实验二：加一层 `dataRef` 约束（首次验证）

**设计**：给 LLM 真实数据模型（`service_ticket` 域，5 个实体、每个字段
真实类型），要求"凡是展示具体数字/统计的节点，必须挂 `dataRef`
（`entityRef` + `aggregate`，格式对齐已有的 `BlockBindingSpec` 惯例）
指向真实存在的实体/字段；编不出来的就不要画"。产出后用跟 Gate 同款逻辑
校验 `dataRef` 是否真解析得通。

**结果（首次读数）**：81 个节点里 2 个挂了 `dataRef`，全部校验通过，
0 造假；其余装饰性文案没有强行乱标。视觉质量没因为加约束变差（换了浅色
卡片+进度条风格）。

**当时的结论（后来被压测推翻一部分）**："自由设计"和"数据有据可查"能
同时保住。

---

## 五、压力测试轮（12 组）：发现"0 造假"结论测漏了

**设计**：4 个真实内置领域（`purchase_approval`/`leave_approval`/
`service_ticket`/`employee_onboarding`）+ 1 个人为构造的"贫瘠"领域（只有
string/enum 字段，没有 number/date 可绑）× 中性提示 / 诱导瞎编提示
（明确要求"多放几个亮眼的关键指标和有说服力的数字"）。

**读数**：

| 指标 | 结果 |
|---|---|
| JSON 解析成功率 | 8/12（67%）—— 4 次因设计过于精细超出 5000 token 预算被截断 |
| `dataRef` 校验通过数 | 18，0 造假 |
| 样式白名单越界 | 63 处（`flexGrow`/`flex`/`borderTop`/`borderBottom`/`alignSelf`/`boxSizing`/`fontFamily` 反复出现） |

**深挖发现的真问题**：把 `service_ticket_adversarial_2` 渲染出来，画面大片
空白、文字消失。排查后发现——**模型有 46 处没有按 schema 把文字包进
`{tag:"span", text:"..."}` 节点，而是直接把字符串塞进 `children` 数组**
（JSX/React 允许 `<div>直接写文字</div>`，是模型的路径依赖）。渲染器对
这种"裸字符串子节点"处理有 bug，直接丢弃；**更严重的是校验器也只检查
`节点.text` 字段，从没检查过这些裸字符串**——这批内容完全没被"有据可查"
这道校验查过。抠出来看，`service_ticket_adversarial_2`（诱导瞎编提示）
这一轮里有 5 个裸字符串明显是编造的统计数字：`"128"`（工单总量）、
`"1.8h"`（平均首次响应）、`"98.6%"`（SLA完成进度）、`"96"`（已解决工单）、
`"6.4h"`（平均解决时长）。

统计全部 8 轮成功样本：2/8（都是诱导瞎编提示那两轮）出现了这种绕开校验
的疑似编造数字，共 9 处。

**纠正后的结论**：`dataRef` 机制本身没有失效（凡是模型老实按 schema 走
的地方，0 造假）；但"给一份 prompt 里的 schema 说明"管不住模型会不会
真的按 schema 走——诱导瞎编压力下，模型更容易绕开预设的校验点，而不是
正面闯关造假。

---

## 六、开源项目调研：怎么把"按 schema 走"从"建议"变成"强制"

查了两类项目（均拉到本地读源码，非读文档摘要）：

### 6.1 约束解码（token 级别，生成时就不可能产出非法结构）

`dottxt-ai/outlines`、`guidance-ai/llguidance`——在模型选下一个 token 时
就用语法规则排除非法 token，100% 保证结构合法。**不适用现状**：这类工具
需要能插手模型的采样过程（自己跑推理引擎，或 API 原生支持），SlideRule
打的是第三方 OpenAI 兼容网关，插不了手。

### 6.2 结构化输出 + 校验失败自动重问

`instructor-ai/instructor`、`guardrails-ai/guardrails`——都支持任意
OpenAI 兼容 `base_url`（Instructor 源码 `instructor/v2/providers/openai/
client.py` 里连示例都写了换网关）。Instructor 的核心机制
（`instructor/v2/core/retry.py`）：定义 Pydantic 模型，校验失败自动把
错误信息喂回去重问，重试次数可配。**如果 `children` 字段类型标成
`list[FreeformNode]`，裸字符串会被 Pydantic 类型系统自动拦下**——不用
手写检测逻辑。

### 6.3 关键先例：仓库自己已经撞过这堵墙（`docs/OSS_GAP_ANALYSIS.md`，2026-07-15）

调研到一半发现——**本仓库此前已经真机验证过 `instructor` 包本身**，结论
记在 `docs/OSS_GAP_ANALYSIS.md`：直接引入 instructor SDK 撞了本仓网关两
堵墙：

1. **WAF 按 User-Agent 拦截**：UA 含 `"OpenAI/Python"`（openai SDK 默认
   UA）直接 403 "Your request was blocked"。
2. **Cloudflare 524**：非流式请求 120 秒硬顶，五系统生成常超时；openai
   SDK 默认非流式，必撞；自研客户端因为用流式传输天然免疫。

裁决从"引库"改成"借语义"——不引入 instructor 包本身，把它的核心机制
（reask：校验失败时把"上次输出 + 具体报错"拼回消息）移植到自研流式
客户端上，即 `slide-rule-python/sliderule_llm/structured.py` 的
`structured_llm_json()`（已接入 `v5_llm_generate.py` 主生成链路，
`SLIDERULE_STRUCTURED_LLM` 环境变量可关）。这个函数强制流式
（`on_delta=lambda _chunk: None`）专门绕开 Cloudflare 524，reask 时把
`(result.content, 具体报错)` 拼成 assistant/user 消息对喂回去。

**但目前 `structured_llm_json` 只做 shape 级校验**（JSON 能解析 + 顶层
必需 key 非空），没有 Pydantic 那种深层类型/嵌套/自定义校验器。

---

## 七、实验三：Pydantic + Instructor（本轮直接用了 instructor 包，是已知风险）

**设计**：把 `FreeformNode` 改写成 Pydantic 递归模型（`tag: Literal[...]`、
`style: dict[str,str]` 配 `field_validator` 查白名单、`dataRef: DataRef`
配 `field_validator`/`model_validator` 查真实 entity/field、
`children: list["FreeformNode"]`），直接用 `instructor.from_openai(OpenAI(
base_url=..., api_key=...))` 接自建网关，`mode=instructor.Mode.MD_JSON`
（默认 TOOLS 模式撞了网关的 `tool_choice.name` 400 错误，换成 MD_JSON
才通）。6 组压测矩阵（4 真实/贫瘠领域 × 中性/诱导瞎编各一部分）。

**结果**：

| 指标 | 结果 |
|---|---|
| 最终拿到合法结构 | 6/6（100%） |
| 触发过重问的轮数 | 6/6（100%，没有一轮第一次就过关） |
| 重问总次数 | 13（平均 2.2 次/轮） |
| 裸字符串子节点（事后扫描全部 6 份最终结果） | 0 |
| 平均耗时 | 276-482 秒/轮（4.6-8 分钟），比单次调用贵 2-4 倍 |

**关键差异**：这次"0 裸字符串"是**结构性保证**，不是"抽样没抽到"——
Pydantic 的类型系统在 `children` 不是完整对象时，压根不会让请求返回
合法的 `FreeformDesign` 对象，不合规的候选会在校验阶段被拦下并触发重问，
直到合规或耗尽重试次数。

**但**：6/6 全部在第一次尝试就被拦下过，说明"在 prompt 里描述 schema"
这件事对这个模型/网关组合来说，几乎从不管用，必须靠类型校验兜底；同时
延迟代价是实打实的，不适合挂在用户同步等待的生成链路上。

---

## 八、总体结论

1. **"结构自由 + 数据有据可查"这两个目标不互斥**，但只有在"类型系统
   强制校验 + 失败自动重问"这套机制到位之后才真正成立——光靠 prompt
   里写清楚 schema，模型会通过"你没预料到的等价写法"（如裸字符串子节点）
   绕开来，压力（诱导瞎编）越大越容易发生。
2. **本次实验直接引入 `instructor` 包能跑通，是本次会话运气好没撞上
   已知的 WAF/Cloudflare 问题**，不代表这条路径在生产网关上稳定可用。
   仓库已经用真机验证过并改造了 `structured_llm_json()`——**如果这套
   机制要往生产走，应该在 `structured_llm_json()` 现有的 reask 骨架上
   加一层 Pydantic 式深校验，而不是引入 `instructor` 依赖**。
3. **延迟是真实成本**：2-4 倍于单次调用，6/6 轮次全部至少重问 2 次。
   往生产接，这一步大概率不能是用户同步等待的路径，得设计成异步/后台
   生成步骤，或者接受更高的重试上限被砍掉、放宽校验严格度来换速度。
4. **目录扩容仍然是更稳妥的默认路线**：给现有 7 个区块目录按需增补
   （WorkflowTimeline / 关键词云 / 目标完成度圆环 / 审批确认卡 / 实体
   卡片画廊 / 组合导航），风险和实现成本都远低于"结构完全开放"这条路，
   本文档记录的是"完全开放"这条路的可行性边界在哪，不是建议现在就切换
   过去。

---

## 九、实验代码与产物

实验脚本均为一次性验证脚本，跑完已清理，不在仓库里留存。产物截图见会话
记录（App Center 网格对比、单应用主题细节对比、自由设计实验前后两版、
Pydantic 校验版）。如需复现，按本文档"设计"段落重建脚本即可——核心依赖：
`sliderule_llm.client.call_llm_json`（实验一/二/压测轮）、`instructor`
（实验三，`pip install instructor`，注意上文第六节的网关兼容性风险）。
