# 给接手这个仓的人（含 AI）

这个仓的知识不在文档里，**在代码注释和测试 docstring 里**。随便打开一个
`services/*.py`，模块头往往是几百字的事故记录：哪天真机踩了什么、为什么这么写、
上一版错在哪。那不是话多，是这个仓的记忆方式——**读代码前先读它的注释**。

下面是从那些注释里反复出现的纪律，按被违反的频率排。

---

## 一、动手之前，先确认哪条链真的在跑

**这是本仓最贵的一条。** 2026-08-16 一天之内因为违反它打偏三次：

```
改了闭环重建那一步      而模型是主循环里生成的      （v5_full_driver:1260 vs :531）
改了提示词的收尾        同样在没被使用的那一步
把合并接在老生成器上    真正在跑的是 spec-first     （v5_capability_executor:492）
```

三次的代码本身都是对的，三次都因为装在不通电的插座上而毫无效果，三次都靠真机
日志才发现——每次损失 25 分钟真机跑 + 一次部署。

**做法**：改之前先在目标路径打一行日志或加一条断言，确认它真的被执行到。
`tests/test_refine_merge_reaches_the_live_path.py` 就是这条纪律的具象化。

## 二、判据必须能被变异咬住

写完测试，**把修复改回去，确认它变红**。没红就是判据没用。

本仓被这条抓到过的真实形态：

- 判据 grep 源码里的标识符，而那个词**同时出现在文档字符串里** → 变异后照样绿。
  修法：匹配前先剥注释。
- 判据写 `"Produce the complete" not in tail`，而实际收尾是
  `"Produce the five-system JSON now."`（不含 complete）→ **断言直接打空**。
  修法：盯**语义**（还在要求"产出一份"），别盯某句话的字面。
- 11 条测试全绿，但把调用点删掉**照样全绿**——它们只直接调那个函数，从没验证
  它接在链路上。这就是下面第三条。

## 三、"闸全绿但东西没了"

本仓数到第十次以上的失败形态：**正向判据齐全，反向判据缺失**。

- 名单里有名字 ≠ 埋点在（`test_enrich_stage_visibility` 为此同时写了正反两条）
- 函数写对了 ≠ 它被调用了
- 接口返回 200 ≠ 它真的做了事

**每写一条"应该有 X"，配一条"不该有 Y"或"X 真的被用到了"。**

## 四、只改一半必然静默失效

同一件事往往有两条实现，改一条不改另一条**不会报错，只会有一半不生效**：

| 成对的东西 | 踩过的坑 |
|---|---|
| 同步驱动 / 流式驱动 | 流式是前端主路径，只改同步等于没改（身份透传、精修模式都踩过） |
| Python 判定 / TypeScript 运行时 | `scan_bindings` 用标签栈，JS 用 `querySelectorAll`——语义不同，同一份 HTML 两个结论 |
| 生成侧 / 消费侧 | 新增 `data-*` 不加进 DOMPurify 白名单会被**静默剥掉** |

**改之前先 grep 有没有第二处。**

## 五、真机 > 机械指标

反复出现：某个数字指标说"好了"，而真实渲染出来的东西是坏的。

- 用**字符数**量页面密度 → 排序跟真实渲染的 DOM 几乎相反
- 用"页面字节变没变"验精修 → 全量重写同样让 4/4 都变，判据只能证明"有反应"
- 静态 HTML 里按钮数少了 18% → 其实是 bind 把重复行收成模板，运行时会克隆回来

**判据要落在用户真正看到的东西上。** 量渲染后的 DOM，不量源码。

## 六、标定过的参数不许拍脑袋改

`services/closure_relevance.py` 模块头写着标定集、公式对照表和为什么选这个阈值。
这类地方改数字要**连同标定一起重跑**，别只改数字。

同理，注释里写着"实测踩过，勿删"、"别再把这条注释改回去"的地方，先读完再动。

## 七、fail-open 与 fail-closed 是分开的，别混

- **增强类**（生图、取色、缓存、合并优化）：自己炸了**不许**拖垮主链路 → fail-open
- **证据/闭环类**：缺证据就是缺，**不许**伪造绿灯 → fail-closed

新写的东西先想清楚属于哪一类。把优化写成 fail-closed 会让一次能跑完的推演崩掉；
把闭环写成 fail-open 会端出"成功但内容为空"。

## 八、注释要记录**事故**，不是记录代码在做什么

本仓的好注释长这样：

> ⚠ 第一版只认前者，真机（烘焙那趟）四页的面包屑全是后者——修复静静地不生效，
> 没有报错、没有告警、判据全绿。

写清**哪天、什么场景、错在哪、为什么现在这么写**。下一个人（很可能还是你）会感谢。

---

## 常用命令

```bash
# Python（必须用 venv，系统 python 缺依赖）
# ⚠ 两个路径都得带 slide-rule-python/ 前缀：venv 和 tests/ 都在包里，不在仓根。
#   写成 `... -m pytest tests/ -q` 在仓根跑是 "file or directory not found: tests/"，
#   而这是"开局必读"里的第一条命令——2026-08-17 新会话照抄就卡住了。
slide-rule-python/.venv/bin/python -m pytest slide-rule-python/tests/ -q -k "关键词"

# 前端
npx vitest run client/src/pages/sliderule/__tests__
npx tsc --noEmit -p tsconfig.json

# 架构图改完必须跑（改完不跑 = 提交了但渲染不出来）
node scripts/mermaid-render-check.mjs "docs/SlideRule V6.0 架构图.md"

# 架构：依赖图**不许手画**，改完代码重新生成 + 过闸
slide-rule-python/.venv/bin/python slide-rule-python/arch_graph.py --emit    # 重新生成
slide-rule-python/.venv/bin/python slide-rule-python/arch_graph.py --check   # 闸（CI 里由 pytest 跑）
```

## 架构边界

`docs/SlideRule V6.2 架构图（自动生成）.md` 是**生成的，别手改**——改了
`tests/test_architecture.py::Test图与代码同步` 会红。依赖规则写在
`slide-rule-python/architecture.toml`，新增跨包依赖必须先在 `may_depend_on` 里
声明（并写清为什么），新增循环依赖直接红。

⚠ 存量违规/环冻在 `[baseline]` 里，**只许变短**：修好了要从基线里删掉，
否则下一个人以为那笔欠账还在。往基线里加东西 = 有意接受一笔新欠账，
不该出现在日常流程里。

⚠ 函数体里的 import **一样算数**。全仓 62% 的内部 import 在函数体里，
不算就等于默认放行三分之二，而且「把 import 挪进函数」会变成一句话绕过闸的办法。

`services` 内部还分三层（抄 grok 的叶子 crate，声明在同一个 toml 里）：

    util  117 个  纯工具，**不依赖 services 里任何其它模块**
    core   52 个  模型 / 闸 / 闭环，只能依赖 util
    flow   26 个  驱动器 / 流水线 / 控制面，可以依赖 core 与 util

新写的 services 模块要落进某一层，落不进通常说明它该被拆成两个。
叶子层是「import 不必躲进函数体」的前提——它谁都不依赖，所以谁都能安全 import 它。

## 部署

镜像由 `.github/workflows/deploy-images.yml` 在 main 推送后构建到 ghcr。
服务器上**手动**拉取（watchtower 是可选 profile，默认不开）：

```bash
docker compose -f docker-compose.prod.yml pull && docker compose -f docker-compose.prod.yml up -d
```

⚠ **"镜像构建成功"≠"线上在跑"。** 验线上行为之前先确认版本——查静态包的
`last-modified` 是否落在目标构建的时间窗内。纯 Python 的改动不会换前端包，那时
只能靠日志或行为判断。
