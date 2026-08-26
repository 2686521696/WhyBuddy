# SlideRule V6.1 已知缺口

一张一个事实：只画**此刻仍为真**的欠账。已落地的不要再标「尚未做」。
本图对照的是 PR-4 之后、短清单/斜杠动词/骨架接线尚未合入的代码。数字不写在图上。

已落地、图上不许再欠：spec-first 已接主轴；`POST /control-turn-stream` 是新烧插座；侧栏「推演」；AppsWorkbench 可见性开关；续播 `GET /runs/{id}/stream`。

```mermaid
flowchart TB
  subgraph STILL["仍为真"]
    ESSAY[工厂点火前仍调度作文能力<br/>v5_agentic_pick · 短清单未合]
    TMPL[app_template 未进 run_spec_first]
    CKPT[pendingRuns / 轮级 checkpoint 未做]
    SLASH[斜杠推演动词未进控制面]
    PACK[领域 pack 未接工厂]
    COST[执行器 token 仍 len 除 4]
  end

  subgraph NOTDEBT["不是欠账"]
    SF[spec-first 已是默认工厂]
    CP[控制面已是新烧 HTTP]
    NAV[侧栏第一项已是推演]
  end
```
