# Store seed packages

Complete Agent Skill zips from GitHub (SKILL.md + Apache-2.0 / MIT). Some have `scripts/`, some are instruction packs.

清单只认 [`index.json`](index.json)。不进的 slug 写在 [`deny.json`](deny.json)。
下架过的写在 [`retired.json`](retired.json)（每条带原因）：线上库里已有的包行和安装记录由 `skill_catalog_store` 按它挡住——货架不列、已装目录不给模型、点名装不上。

**进架标准（2026-10-01 技能审查）**：Work 编排的交付物是 Office 文件、单页网页（React-Vite 模板）和文字。
进来的包要 ① 跟这些交付物对得上 ② 在 E2B 沙盒里跑得起来（没有 LibreOffice、没有能起的浏览器、不给 root）
③ 不要第三方 key、不把用户文件发出去 ④ 不抢控制面调度（「严格照本流程」「先跑我的守卫脚本」那种不进）
⑤ 仓里有 MIT / Apache-2.0 许可。工程手艺包（某语言 / 某框架 / CI / 合规）不进——模型本来就会，装了只是多一个走偏的方向。

Re-pack:

```bash
slide-rule-python/.venv/bin/python skills/seeds/vendor_anthropic.py
slide-rule-python/.venv/bin/python skills/seeds/vendor_community.py
```

索引行可带 `path`（钉死仓内目录，同仓有多份副本时用）和 `exclude`（超过单文件 512KB 上限的数据、上游自测）。
codeload 下载不了时用本地克隆打：`vendor_community.py --checkout owner/repo=/path/to/clone`（可给多次）。

官方包走 `vendor_anthropic.py`。其余（Osmani / superpowers / wshobson 里留下的几份 / office-skills / Humanizer-zh / ui-ux-pro-max / financial-analyst / copywriting / data-visualization-discipline）走 `vendor_community.py`，按索引打 zip、补 LICENSE。

Anthropic 的 `docx` / `pptx` / `xlsx` / `pdf` 禁止再分发，不进索引。

不整仓搬：alirezarezvani 380 份（只取 financial-analyst）、wshobson 183 份、VoltAgent 1000+。`using-superpowers` / `writing-plans` / `test-driven-development` / stripe 这类不进。

`../sliderule.zip` is the in-house SPEC pack. Catalog copy must say it is not the everyday “write an app” default.
