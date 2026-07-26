# FreeformInsight 图标放开为形状校验（非白名单）

## Context and Problem Statement

FreeformInsight 早期用 12 个图标的封闭白名单，真机撞到语义不搭的硬凑
（订单销售额配 trending-up）。2026-07-24 放开为"形状校验"：只要是合法的
Ant Design 图标组件名（PascalCase + Outlined/Filled/TwoTone 结尾）就放行，
前端按名动态解析，解析不到渲染成空。架构图当时仍写"图标白名单·单一真相源"，
与实现脱节；且形状正则+legacy 别名表在 Python 与 TS 各手抄一份、无对账哨兵。

## Considered Options

* 回到封闭白名单（目录 `freeformAllowedIconRefs` 83 个）
* 维持两侧手抄的形状校验
* 形状校验，但正则与别名表收编进目录 JSON、两侧派生 + parity 哨兵

## Decision Outcome

Chosen option: 第三项（2026-07-26 落地）。目录新增 `freeformIconNamePattern` 与
`freeformLegacyIconAliases`，Python（`schema_legal.py` → `freeform_block.py`）与
前端（`block-registry.tsx`）同源派生；`tests/test_ssot_parity.py` 与
`__tests__/ssot-parity.test.ts` 双侧哨兵。安全性不依赖图标集合：图标名永远
只当组件名查表（hasOwnProperty 挡原型链），从不被当代码执行。
`freeformAllowedIconRefs` 保留为 prompt 建议清单（非校验白名单）。

### Consequences

* Good: 语义匹配自由度全量放开；两侧规则物理同源，改一处两端同步。
* Bad: "白名单"字样从安全叙事中移除——安全边界的真实来源（形状正则+
  原型链防护+组件名查表）必须在代码注释里讲清楚，避免误读为"没有防护"。
