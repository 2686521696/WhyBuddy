# 演示域冻结夹具旁路 + 识别纪律

## Context and Problem Statement

四个常见企业场景（采购审批/请假审批/服务工单/员工入职）预先由 LLM 一次性
生成、过结构门后冻结为静态夹具（E35，`builtin_domain_models.json`）。意图命中
即走夹具旁路：零 LLM、秒回、结果稳定——这是演示与离线场景的刚需。

两个真实事故驱动本 ADR：

1. **识别误伤**：旧实现是裸子串匹配，`"sla"` 命中了
   translation/island/slack/slash/legislation，`"升级"` 命中任何提到升级的意图
   ——用户要翻译平台、拿到冻结工单系统，且全程无痕。
2. **旁路跳过体验层**：夹具诞生于 V5.4 之前，无生成主题/无区块——需求越
   "标准"拿到的应用反而越旧。

## Considered Options

* 删除旁路，全部走 LLM 生成（丢掉零 LLM 演示能力）
* 保留裸子串匹配，只删几个泛词
* 词边界 + 强弱词分级识别（RapidFuzz score_cutoff / Rasa FallbackClassifier 语义）+
  夹具离线预增强（golden-file 再生成）+ 产物 provenance 标注

## Decision Outcome

Chosen option: 第三项。识别纪律：拉丁词一律词边界匹配；泛词（sla/ticket/升级/
onboarding）降为弱词，单独命中不认域、需两个不同弱词同现；认不出返回 None
——fail-closed 交给 LLM 生成，绝不硬塞猜的域。夹具由
`scripts/enrich_builtin_domain_models.py` 离线跑体验层增强（生成主题）后重新
过门再冻结，运行时保持零 LLM。夹具产物 provenance 带
`builtin-domain:<域>`，走了近路可见可审计。

### Consequences

* Good: 误伤面归零（负例回归 `tests/test_domain_recognizer.py` 锁死）；演示域
  也吃到生成式主题；旁路不再无痕。
* Bad: 弱词识别更保守——"ticket triage"（单弱词）现在走 LLM 生成而非秒回
  夹具，属有意取舍：慢一点的正确 > 秒回的错货。
* Note: 夹具首页是 `dashboard` kind（有自己的真实渲染路径），`freeformOverview`
  只服务 `monitor` kind——夹具预增强故意不造 monitor 页，不为增强而改变
  模型信息架构。
