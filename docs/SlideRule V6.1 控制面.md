# SlideRule V6.1 控制面

V6.1 拆成一组短图，一张一个事实。V6.0 是历史实验室笔记，见 `docs/SlideRule V6.0 架构图.md` 头注。禁止再往 V6.0 打新 ⚑。

⚠ 2026-08-29：原来只有前六张，而 V6.0 的 19 个子图里有 12 个**一张也没画**——
读图的人会以为那些东西不存在（入站判定、身份、失效级联、续播、精修环……）。
逐个对着代码核过之后补齐了 8 张；有意不搬的写在最后一张里，不留空白。

| 图 | 文件 |
|---|---|
| 1. 控制面 | 本文件 |
| 2. 工厂 spec-first | `docs/SlideRule V6.1 工厂.md` |
| 3. 闸与闭环 | `docs/SlideRule V6.1 闸与闭环.md` |
| 4. 活 UI 路由 | `docs/SlideRule V6.1 活UI路由.md` |
| 5. 扩展 | `docs/SlideRule V6.1 扩展.md` |
| 6. 已知缺口 | `docs/SlideRule V6.1 已知缺口.md` |
| 7. 入站判定 | `docs/SlideRule V6.1 入站判定.md` |
| 8. 身份与权限 | `docs/SlideRule V6.1 身份与权限.md` |
| 9. 失效与重入 | `docs/SlideRule V6.1 失效与重入.md` |
| 10. 运行时与续播 | `docs/SlideRule V6.1 运行时与续播.md` |
| 11. 精修环 | `docs/SlideRule V6.1 精修环.md` |
| 12. 区块供给与窄化 | `docs/SlideRule V6.1 区块供给与窄化.md` |
| 13. 体验层 | `docs/SlideRule V6.1 体验层.md` |
| 14. 执行与记账 | `docs/SlideRule V6.1 执行与记账.md` |
| 15. V6.0 未搬清单 | `docs/SlideRule V6.1 V6.0未搬清单.md` |

一张一个事实：用户消息进入薄控制面；只有 `rehearse` / `refine` / `repair` 才进工厂信封。
源：`docs/欠缺模块清单-对照Claude与Grok-build.md` §7。本图不画能力池散文，不把 GEN5 画成脊柱。

```mermaid
flowchart TB
  U[用户消息 / 斜杠 / 点预览质疑] --> CP[薄控制面 Agent<br/>封闭工具表 · tool-calling]

  CP -->|ask_user / inspect_model / search_evidence / scope_card| CHEAP[便宜轮<br/>秒级 · 不落五系统写]
  CP -->|rehearse / refine / repair| FACTORY
  CP -->|challenge| INV[失效级联<br/>不调信封]
  CP -->|restore_version / fork_variant| VER[modelVersions / fork_app]

  subgraph FACTORY["昂贵工厂 · 信封 + 现有 live path"]
    direction TB
    ENV[start_drive_full_factory_run<br/>persist / skills / E25 / E26 / save]
    ENV --> D[drive_full_v5_session_stream]
    D --> SF[spec-first 七步]
    SF --> G[v5_model_gate + repair]
    G --> C6[publish closure 6/6]
  end

  CHEAP --> HUD[活预览 + 推演钟 + 证据 HUD]
  INV --> HUD
  C6 --> HUD
  VER --> HUD
  HUD --> U
```
