/**
 * 伴随式澄清：推演中「我替你定了什么」。
 *
 * 用户的抱怨是「澄清……不是伴随式的，各个环节都很敷衍」。点火前那一轮问答
 * 只够问粗维度；真正让产品长得不一样的分叉（登录用手机号还是工号、审批
 * 一级还是两级）是**画到 SPEC 那一步才浮出来的**，而它们此前一直是静默的。
 *
 * 这个文件守两件事：
 *   1. 卡做成澄清那种：一题一题选，点「确认继续」才往下；
 *   2. 确认时改过的那句**真的进了中途排队**，不是点了个寂寞。
 */
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AssumptionStrip } from "../AssumptionStrip";
import {
  assumptionsWereConfirmed,
  lenientStringList,
  mergeAssumptions,
  parseSpecAssumptions,
  revisePhrase,
  settleAssumption,
  shouldResetSpecAssumptions,
  type SpecAssumption,
} from "../spec-assumptions";

const LOGIN: SpecAssumption = {
  id: "a1",
  topic: "员工怎么登录",
  decision: "手机号 + 短信验证码",
  alternatives: ["工号 + 密码", "企业微信扫码"],
  why: "需求里没说身份从哪来",
};
const APPROVE: SpecAssumption = {
  id: "a2",
  topic: "审批几级",
  decision: "一级",
  alternatives: [],
  why: "",
};

describe("mergeAssumptions", () => {
  it("按 id 去重——续播会把同一条再送一遍", () => {
    /* ⚠ 这条不是可选的。run_registry.subscribe 从 since 补播整段事件日志：
       刷新页面、切走再回来、网络抖动重连都会重放 spec_assumption。
       不去重的话，用户刷一次页面面板上就多出一整份重复的卡。 */
    const once = mergeAssumptions([], [LOGIN, APPROVE]);
    const twice = mergeAssumptions(once, [LOGIN, APPROVE]);
    expect(twice.map(r => r.id)).toEqual(["a1", "a2"]);
  });

  it("同 id 后到的覆盖先到的，而且留在原位", () => {
    const prev = mergeAssumptions([], [LOGIN, APPROVE]);
    const next = mergeAssumptions(prev, [
      { ...LOGIN, decision: "工号 + 密码" },
    ]);
    /* 位置不许变：一次重连就把面板上的卡重新洗牌，用户正要点的那个跑了 */
    expect(next.map(r => r.id)).toEqual(["a1", "a2"]);
    expect(next[0].decision).toBe("工号 + 密码");
  });

  it("反向：没有 id 的行直接丢，不许摊到面板上", () => {
    const out = mergeAssumptions([], [
      { ...LOGIN, id: "" },
      APPROVE,
    ]);
    expect(out.map(r => r.id)).toEqual(["a2"]);
  });

  it("不改原数组（React state 必须换引用才重渲染）", () => {
    const src = [LOGIN];
    const out = mergeAssumptions(src, [APPROVE]);
    expect(src).toHaveLength(1);
    expect(out).not.toBe(src);
  });
});

describe("处理过的卡不许自己回来（续播恒从 since=0 全量补播）", () => {
  it("点掉之后再补播一遍，面板上不许再出现", () => {
    // ⚠ 2026-08-27 审查探针实测的真实形状：
    //     settleAssumption([LOGIN],"a1") → 0 张
    //     mergeAssumptions(那 0 张, [LOGIN]) → 1 张   ← 又回来了
    //   刷新页面 / 切走再回来 / 网络抖动重连都会走到这一步。
    const settled = new Set<string>(["a1"]);
    const list = settleAssumption([LOGIN], "a1");
    expect(list).toHaveLength(0);
    expect(mergeAssumptions(list, [LOGIN], settled)).toHaveLength(0);
  });

  it("反向：没处理过的照常进来——别把整条链去重成哑巴", () => {
    const settled = new Set<string>(["a1"]);
    expect(mergeAssumptions([], [LOGIN, APPROVE], settled)).toEqual([APPROVE]);
  });

  it("不传集合时行为跟以前一模一样（老调用点不许被这次改动改掉语义）", () => {
    expect(mergeAssumptions([], [LOGIN])).toEqual([LOGIN]);
  });
});

describe("lenientStringList：模型把清单写歪的那几种形状", () => {
  // 抄 grok-build serde_lenient.rs 的口径表，逐行对齐。
  it("数组里的字符串/数字都收，数字转成字符串", () => {
    expect(lenientStringList(["工号", 228])).toEqual(["工号", "228"]);
  });

  it("**裸字符串 → 单元素数组**，不是丢掉（这一条是要害）", () => {
    // 上一版写的是 `Array.isArray(x) ? x : []`，模型给的这条备选被静静扔了，
    // 卡退化成"知会一声"，用户想改都没得点。
    expect(lenientStringList("工号或扫码")).toEqual(["工号或扫码"]);
    expect(lenientStringList(228)).toEqual(["228"]);
  });

  it("null / undefined → 空数组", () => {
    expect(lenientStringList(null)).toEqual([]);
    expect(lenientStringList(undefined)).toEqual([]);
  });

  it("反向：bool / 对象 / 嵌套数组认不出来，返回 null 让调用方决定", () => {
    // 宽容不等于什么都收。true 混进去会变成"true"摆在用户面前。
    expect(lenientStringList(true)).toBeNull();
    expect(lenientStringList({ a: 1 })).toBeNull();
    expect(lenientStringList([["x"]])).toBeNull();
    expect(lenientStringList(["工号", true])).toBeNull();
  });
});

describe("revisePhrase", () => {
  it("同时说改成什么、不要什么", () => {
    /* ⚠ 只说"改成工号"，下游读到的是一条追加要求，而原来那条（手机号）
       在上一版 spec 里还立着——真机上出现过两种登录入口并存的页面。
       用户原话本来就是两句一起说的：「不要手机号，改成工号」。 */
    const said = revisePhrase(LOGIN, "工号 + 密码");
    expect(said).toContain("不要手机号 + 短信验证码");
    expect(said).toContain("改成工号 + 密码");
    expect(said).toContain("员工怎么登录");
  });

  it("反向：空选项不生成句子（调用方据此不入队）", () => {
    expect(revisePhrase(LOGIN, "   ")).toBe("");
  });

  it("选的就是已经定的那个 → 只说改成，不说自相矛盾的「不要 X，改成 X」", () => {
    expect(revisePhrase(LOGIN, "手机号 + 短信验证码")).toBe(
      "员工怎么登录：改成手机号 + 短信验证码"
    );
  });
});

describe("parseSpecAssumptions", () => {
  it("把落库 spec 那份清单洗成面板要的形状", () => {
    const out = parseSpecAssumptions([
      {
        id: "a1",
        topic: "员工怎么登录",
        decision: "手机号",
        alternatives: "工号",
        why: "没说",
      },
      { id: "a2", topic: "", decision: "一级" },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].alternatives).toEqual(["工号"]);
  });

  it("反向：不是数组就不摊", () => {
    expect(parseSpecAssumptions(null)).toEqual([]);
    expect(parseSpecAssumptions({ topic: "x" })).toEqual([]);
  });
});

describe("settleAssumption", () => {
  it("处理完的收走", () => {
    expect(settleAssumption([LOGIN, APPROVE], "a1").map(r => r.id)).toEqual([
      "a2",
    ]);
  });

  it("反向：不存在的 id 原样返回，不抛", () => {
    expect(settleAssumption([LOGIN], "nope")).toHaveLength(1);
  });
});

describe("面板画出来的东西（量渲染后的 DOM，不量源码）", () => {
  const html = (items: SpecAssumption[]) =>
    renderToStaticMarkup(
      <AssumptionStrip items={items} onConfirm={() => {}} />
    );

  it("一次只画当前题，推荐项带标记，其他做法是选项", () => {
    const out = html([LOGIN, APPROVE]);
    expect(out).toContain("待确认");
    expect(out).toContain("1 / 2");
    expect(out).toContain("员工怎么登录");
    expect(out).not.toContain("审批几级");
    expect(out.match(/data-testid="sliderule-assumption-option"/g)).toHaveLength(3);
    expect(out).toContain("工号 + 密码");
    expect(out).toContain("企业微信扫码");
    expect(out).toContain("推荐");
    expect(out).toContain("下一步");
  });

  it("最后一题才有确认继续", () => {
    const out = html([APPROVE]);
    expect(out).toContain("确认继续");
    expect(out).toContain('data-testid="sliderule-assumption-submit"');
    expect(out).not.toContain("sliderule-assumption-next");
    expect(out).toContain("审批几级");
  });

  it("反向：一条都没有时整个面板不渲染（不留空壳）", () => {
    expect(html([])).toBe("");
  });

  it("必须确认继续才能往下——这是它跟旧伴随式最关键的区别", () => {
    const out = html([LOGIN, APPROVE]);
    expect(out).toContain("选完再继续");
    expect(out).toContain("下一步");
    expect(html([LOGIN])).toContain("确认继续");
  });
});

describe("接线（四段都得接上）", () => {
  const read = (rel: string) =>
    readFileSync(new URL(rel, import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
  const DRIVER = read("../../../lib/sliderule-marathon-driver.ts");
  const SESSION = read("../useSlideRuleSession.ts");
  const DOCK = read("../ComposerDock.tsx");
  const PAGE = read("../../SlideRule.tsx");

  it("流：SSE 的 spec_assumption 落到回调上", () => {
    expect(DRIVER).toContain('case "spec_assumption"');
    expect(DRIVER).toContain("onSpecAssumptions");
  });

  it("hook：并进去（不是覆盖也不是追加），并且导出去", () => {
    expect(SESSION).toContain("mergeAssumptions(");
    expect(SESSION).toContain("specAssumptionsRef.current,");
    expect(SESSION).toContain("specAssumptions,");
    expect(SESSION).toContain("settleSpecAssumption,");
    expect(SESSION).toContain("reviseSpecAssumption,");
  });

  it("hook：并的时候必须把「已处理」集合传进去——否则点掉的卡续播会回来", () => {
    /* ⚠ 这一条是纯逻辑层那两条（"处理过的卡不许自己回来"）的通电判据：
       mergeAssumptions 支持第三个参数不算数，调用点**真的传了**才算。
       变异：把 settledAssumptionIdsRef 那一行删掉 → 本条红。 */
    const call = SESSION.slice(
      SESSION.indexOf("mergeAssumptions("),
      SESSION.indexOf("mergeAssumptions(") + 220
    );
    expect(call).toContain("settledAssumptionIdsRef.current");
  });

  it("hook：撤卡之前先把 id 记进「已处理」——两个入口都要", () => {
    /* 「就这样」和「改成 X」都得记。少记一个，那个入口点掉的卡照样会回来，
       而另一个入口是好的——半边生效最难查（CLAUDE.md §4）。 */
    const marks = SESSION.match(/settledAssumptionIdsRef\.current\.add\(id\)/g);
    expect(marks?.length).toBeGreaterThanOrEqual(2);
  });

  it("hook：点「改成 X」真的进中途排队——否则点了个寂寞", () => {
    /* ⚠ 这条是整件事的**唯一出口**。面板画得再好，这一行不在，
       用户点完只是把卡收走了，需求一个字都没传下去。 */
    expect(SESSION).toContain("pushQueuedTurn(phrase)");
    expect(SESSION).toContain("revisePhrase(row, alternative)");
  });

  it("新一轮 / 重置会话都要清空（否则对着过期的决定点改）", () => {
    expect(SESSION.match(/resetSpecAssumptions\(\)/g)?.length).toBe(2);
  });

  it("确认继续的 pages 跳不许清已处理集合", () => {
    /* 2026-09-03 真机：选完「确认继续」排队 pages，runTurn 开头
       resetSpecAssumptions 把 settled 清掉，落库 spec 同一张卡又摊回来。 */
    const at = SESSION.indexOf("setSpecPages([])");
    expect(at).toBeGreaterThan(-1);
    const window = SESSION.slice(at, at + 700);
    expect(window).toContain("shouldResetSpecAssumptions(hop, userText)");
    expect(window).toContain("resetSpecAssumptions()");
  });

  it("控制面收尾卡点 Structure 不许清", () => {
    expect(
      shouldResetSpecAssumptions(undefined, "进入数据模型反推（Structure）")
    ).toBe(false);
    expect(shouldResetSpecAssumptions("structure", "继续")).toBe(false);
    expect(shouldResetSpecAssumptions("pages", "假设已确认。继续画页面。")).toBe(
      false
    );
  });

  it("真的重新起草 SPEC 才清", () => {
    expect(shouldResetSpecAssumptions("spec", "做一个亲子打卡应用")).toBe(true);
    expect(shouldResetSpecAssumptions("rehearse", "开始推演")).toBe(true);
    expect(shouldResetSpecAssumptions(undefined, "把侧栏改成深色")).toBe(true);
  });

  it("确认后落库 spec 不许再把卡摊回来", () => {
    expect(SESSION).toContain("assumptionsConfirmedRef.current = true");
    expect(SESSION).toContain("if (assumptionsConfirmedRef.current) return");
  });

  it("清空必须**连「已处理」集合一起**清——否则下一轮的新假设被当回声吞掉", () => {
    /* ⚠ id 兜底是 `f"a{i+1}"`，所以下一轮的 a1 跟这一轮的 a1 是两件不同的事。
       只清列表不清集合，下一轮那条真·新假设会被 mergeAssumptions 当成
       "处理过的回声"丢掉——面板永远少一张卡，而且不报错。
       变异：把 resetSpecAssumptions 里那行 `new Set()` 删掉 → 本条红。 */
    const reset = SESSION.slice(
      SESSION.indexOf("const resetSpecAssumptions"),
      SESSION.indexOf("const resetSpecAssumptions") + 260
    );
    expect(reset).toContain("settledAssumptionIdsRef.current = new Set()");
    expect(reset).toContain("setSpecAssumptions([])");
  });

  it("输入条：画出来，两个动作都在", () => {
    expect(DOCK).toContain("AssumptionStrip");
    expect(DOCK).toContain("onSettleAssumption");
    expect(DOCK).toContain("onReviseAssumption");
  });

  it("浮层不许待在输入框那一行里", () => {
    /* ⚠ 2026-08-27 真机咬出来的。第一版把假设条和排队条放在输入框正文
       上方那个 `min-w-0` 盒子里——进流会把输入顶走，或在老胶囊单行里被挤成
       竖条。2026-09-01 会话内改成跟空态同一张多行卡片，浮层仍必须在
       absolute 那一层，不能进栅格。

       同一个文件里审查卡的注释早就写着答案：「不进外层 flex——进流会把输入
       顶走」。这条判据把那句话变成闸：两条浮层必须在 absolute 那一层里。

       ⚠ 判据只能查源码形状——本仓没有 jsdom，量不到真实布局（这也是它当初
         能溜过去的原因：19 条判据全绿，错的是没人量过会话内的那一版）。
         所以钉的是**位置关系**：浮层容器带 absolute bottom-full，两条都在它
         **里面**（出现在它之后、在它闭合之前的能力标签之前）。 */
    const at = DOCK.indexOf('data-testid="sliderule-composer-overlay"');
    expect(at).toBeGreaterThan(-1);
    // 浮层容器自己带 absolute bottom-full（跟审查卡同一层）
    expect(DOCK.slice(Math.max(0, at - 400), at)).toContain("absolute bottom-full");
    // 两条都在它里面
    const body = DOCK.slice(at, at + 3000);
    expect(body).toContain("<AssumptionStrip");
    expect(body).toContain('data-testid="sliderule-queued-turns"');
    // 反向：不许再出现在能力标签那一段（那就是被挤扁的老位置）
    const inputRow = DOCK.indexOf('data-testid="sliderule-composer-tags"');
    expect(inputRow).toBeGreaterThan(-1);
    expect(DOCK.slice(0, inputRow)).not.toContain("<AssumptionStrip");
    expect(DOCK.slice(0, inputRow)).not.toContain(
      'data-testid="sliderule-queued-turns"'
    );
  });

  it("页面：真的把假设传给了输入条（不传 = 组件永远收到空数组）", () => {
    expect(PAGE).toContain("specAssumptions={specAssumptions}");
    expect(PAGE).toContain("onSettleAssumption={settleSpecAssumption}");
    expect(PAGE).toContain("onReviseAssumption={reviseSpecAssumption}");
  });

  it("确认继续接到了输入条上——Dock 用 onConfirmAssumptions 守门，不传 = 卡不画", () => {
    /* ⚠ 2026-09-02：伴随式改成选完再继续。Dock 里 AssumptionStrip 包在
       `onConfirmAssumptions ?` 里，页面漏传这一行，面板永远是空的，
       而且不报错（CLAUDE.md §3）。
       真机第二刀：Unified 的 ComposerDock 写了这一行，但 props 是从
       `shared` 对象铺进去的——shared 里漏了 confirmSpecAssumptions，
       卡照样不画。两头都要有。 */
    expect(PAGE).toContain("onConfirmAssumptions={confirmSpecAssumptions}");
    expect(PAGE).toContain("confirmSpecAssumptions,");
    expect(DOCK).toContain("onConfirm={onConfirmAssumptions}");
    expect(DOCK).toContain("onConfirmAssumptions ?");
    const shared = PAGE.slice(
      PAGE.indexOf("const shared ="),
      PAGE.indexOf("const shared =") + 900
    );
    expect(shared).toContain("confirmSpecAssumptions");
  });

  it("确认继续必须把每条 id 记进已处理，并撤掉整面板", () => {
    const at = SESSION.indexOf("const confirmSpecAssumptions");
    expect(at).toBeGreaterThan(-1);
    const body = SESSION.slice(at, at + 1600);
    expect(body).toContain("settledAssumptionIdsRef.current.add(row.id)");
    expect(body).toContain("applySpecAssumptions([])");
  });

  it("空闲确认必须真的发出去，不许再挂着等发送键", () => {
    /* ⚠ queued-turn-has-an-exit-when-idle 那场：点了「改成 X」话进队列，
       推演已结束，flush 的五个调用点全是「某件事结束时」。确认继续若
       不自己 flush，用户对着「确认继续」点了没反应。 */
    const at = SESSION.indexOf("const confirmSpecAssumptions");
    const body = SESSION.slice(at, at + 1800);
    expect(body).toContain("runTurnRef.current");
    expect(body).toContain("假设已确认。继续画页面。");
    expect(body).toContain('pendingForcedToolRef.current = "pages"');
    expect(body).toContain('"pages"');
    expect(body).toContain("isRunningRef.current");
    // 反向：推演中是放行闸，不是再开一轮
    expect(body).toContain("releaseRun({ skip: true })");
    // 确认是 typed 答案，不许进「本轮结束后发出」那条可见队列。
    expect(body).not.toContain(
      'pushQueuedTurn("假设已确认。继续画页面。")'
    );
    expect(body).toContain("enqueueTurn(");
    expect(body).toContain("assumptionsConfirmed: true");
  });

  it("刷新必须认落盘的 assumptionsConfirmed，不许再摊卡", () => {
    const at = SESSION.indexOf("const applyPersistedState");
    expect(at).toBeGreaterThan(-1);
    const body = SESSION.slice(at, at + 900);
    expect(body).toContain("assumptionsWereConfirmed");
    expect(body).toContain("applySpecAssumptions([])");
    // 水合那一跳也要认，不能只活在 applyPersistedState 里
    // （刷新走 loadOrCreateSessionState，不经过那条）。
    const hydrate = SESSION.slice(
      SESSION.indexOf("const hydrated = preservePythonEvidenceProjection"),
      SESSION.indexOf("const hydrated = preservePythonEvidenceProjection") + 700
    );
    expect(hydrate).toContain("assumptionsWereConfirmed(hydrated)");
    expect(SESSION).toContain("assumptionsWereConfirmed(sessionState)");
  });

  it("工厂冲掉 key 之后，确认那句话仍能挡住复弹", () => {
    expect(
      assumptionsWereConfirmed({
        specFirstPages: {
          spec: { assumptions: [{ id: "a1" }] },
        },
        controlTranscript: [
          { text: "假设已确认。继续画页面。" },
        ],
      })
    ).toBe(true);
    expect(
      assumptionsWereConfirmed({
        specFirstPages: { assumptionsConfirmed: true },
      })
    ).toBe(true);
    // 反向：没确认过，spec 里有假设 → 必须摊卡
    expect(
      assumptionsWereConfirmed({
        specFirstPages: {
          spec: { assumptions: [{ id: "a1" }] },
        },
        controlTranscript: [{ text: "进入数据模型反推（structure）" }],
      })
    ).toBe(false);
  });

  it("SPEC 重起草后显式 false 必须压过旧确认，同一张卡重新出现", () => {
    expect(
      assumptionsWereConfirmed({
        specFirstPages: { assumptionsConfirmed: false },
        controlTranscript: [{ text: "假设已确认。继续画页面。" }],
        turnNarrations: [{ user: "假设已确认。继续画页面。" }],
      })
    ).toBe(false);
    expect(
      assumptionsWereConfirmed({
        specFirstPages: { spec: { assumptions: [{ id: "a1" }] } },
        controlTranscript: [
          { text: "假设已确认。继续画页面。" },
          { text: "将做成：做一个亲子打卡应用" },
        ],
      })
    ).toBe(false);
  });

  it("推演中发 Structure 进可见队列，盖掉确认留下的 pages", () => {
    const at = SESSION.indexOf("const sendMessage");
    expect(at).toBeGreaterThan(-1);
    const body = SESSION.slice(at, at + 1800);
    expect(body).toContain("factoryHopFromText(text)");
    expect(body).toContain("pendingForcedToolRef.current = hop");
    expect(body).toContain("pushQueuedTurn(text)");
    expect(body).toContain("setPendingAsk(null)");
  });

  it("确认继续的 pages 闸只在 runTurn 过了 isRunning 之后取走", () => {
    /* ⚠ 真机：flush 先清 flag 再进 runTurn，isRunning 仍真时直接 return，
       forcedTool=pages 丢了，控制面去 planning，钟又回到起草 SPEC。 */
    const at = SESSION.indexOf("const runTurn = async");
    expect(at).toBeGreaterThan(-1);
    const body = SESSION.slice(at, at + 900);
    expect(body).toContain("isRunningRef.current");
    expect(body).toContain("pendingForcedToolRef.current");
    expect(body.indexOf("isRunningRef.current")).toBeLessThan(
      body.indexOf("pendingForcedToolRef.current = undefined")
    );
    expect(SESSION).toContain("hop || forcedTool");
  });

  it("SSE 回调里不许 fetch hold——真机拦 fetch 时卡整轮不出现", () => {
    const at = SESSION.indexOf("onSpecAssumptions:");
    expect(at).toBeGreaterThan(-1);
    const body = SESSION.slice(at, at + 500);
    expect(body).not.toContain("holdRun()");
  });

  it("落库 spec 里的假设也必须摊到面板上——SSE 漏了不能没卡", () => {
    /* ⚠ 2026-09-02 真机：specFirstPages.spec.assumptions 有 3 条，
       面板整轮没出现。渲染时也要从 sessionState 派生，不能只靠 SSE。 */
    expect(SESSION).toContain("parseSpecAssumptions(");
    expect(SESSION).toContain("specAssumptionsView");
    expect(SESSION).toContain(".spec?.assumptions");
  });
});
