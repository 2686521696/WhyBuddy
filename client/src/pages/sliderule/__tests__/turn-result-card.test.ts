/**
 * 结果卡：**有东西才出卡**，而且不许编。
 *
 * ## 病（2026-09-14，用户第二次对照 Manus 截图）
 *
 * Manus 跑完留下一张卡：应用名 + 未发布 + 用时 + 缩略图 + 发布按钮，底下
 * `✓ 任务已完成 · 复制 · 重试 · 评分`。往上滚看历史，每个任务都留着那张卡。
 * 我们跑完只有一段文字——成果散在右侧预览列，**对话流里没有任何一个
 * 「东西做好了，在这儿」的锚点**。
 *
 * ## 判据的重心在反向
 *
 * 「跑完显示一张卡」写出来很容易，危险的是它到处都出：还在跑的、没产出的、
 * 纯问答的轮次全挂一张卡，对话流就变成卡片墙。所以每条正向都配一条反向。
 *
 * 真机那一趟（`shots/baseline`，真 LLM）正好撞上 provider 的 content_filter，
 * 整轮没有任何产出——这种轮次**必须不出卡**，是下面 `test_反向_失败轮不出卡`
 * 钉的形态。
 */
import { describe, expect, it } from "vitest";
import { OFFICE_FILE } from "../deliverable-kind";
import {
  formatWorkedDuration,
  OFFICE_BADGE,
  resultCardModel,
  turnDeliveredOfficeFile,
  turnDeliveredProject,
  workedLabel,
} from "../turn-result-card";
import type { TurnStep, UiTurn } from "../types";

function chip(
  tool: string,
  progressType: Extract<TurnStep, { kind: "chip" }>["progressType"] = "completed"
): Extract<TurnStep, { kind: "chip" }> {
  return {
    id: `chip-${tool}`,
    kind: "chip",
    capabilityId: tool as Extract<TurnStep, { kind: "chip" }>["capabilityId"],
    roleId: "control",
    label: tool,
    realLlm: true,
    progressType,
  };
}

function turn(over: Partial<UiTurn> = {}): UiTurn {
  return {
    id: "t1",
    user: "做一个记账小应用",
    status: "complete",
    steps: [],
    routeFacts: {} as UiTurn["routeFacts"],
    routeExpanded: false,
    routeLitCount: 0,
    assistant: "做好了。",
    assistantSource: "llm",
    main: { artifactId: "a1", kind: "page", realLlm: true },
    actions: [],
    ...over,
  };
}

describe("用时要写成人话", () => {
  it("不满一分钟说秒", () => {
    expect(formatWorkedDuration(45_000)).toBe("45s");
    expect(formatWorkedDuration(1_000)).toBe("1s");
  });

  it("过了一分钟写 2m 45s，不许让人自己把 165s 心算成两分多钟", () => {
    expect(formatWorkedDuration(165_000)).toBe("2m 45s");
    expect(formatWorkedDuration(120_000)).toBe("2m");
  });

  it("小时档也别塌成一堆分钟", () => {
    expect(formatWorkedDuration(3_600_000)).toBe("1h");
    expect(formatWorkedDuration(3_780_000)).toBe("1h 3m");
  });

  it("反向：拿不到用时就整行不出，不写 0s 也不写「未知」", () => {
    for (const bad of [undefined, null, 0, -5, NaN, Infinity, "12s"]) {
      expect(formatWorkedDuration(bad as never)).toBeNull();
      expect(workedLabel(bad as never)).toBeNull();
    }
  });

  it("标题行是「工作了 X」", () => {
    expect(workedLabel(165_000)).toBe("工作了 2m 45s");
  });
});

describe("有东西才出卡", () => {
  it("正向：HTML 档画出了页面 → 出卡", () => {
    const model = resultCardModel(turn({ durationMs: 165_000 }), {
      runtimeKind: "html-prototype",
      goalText: "记账小应用",
      hasPages: true,
    });
    expect(model).not.toBeNull();
    expect(model!.title).toBe("记账小应用");
    expect(model!.badge).toBe("HTML 原型");
    expect(model!.worked).toBe("工作了 2m 45s");
    expect(model!.canPublish).toBe(false);
  });

  it("正向：工程档这一轮写了源码且有落库版本 → 出卡，而且谈得上发布", () => {
    // ⚠ 2026-09-23：夹具原来用 chip("project_create") 冒充「写了源码」。
    //   建工程不是改工程（见 PROJECT_DELIVERY_TOOLS 头注那趟真机），
    //   这条要的是真的写过，所以用 project_patch。
    const model = resultCardModel(turn({ steps: [chip("project_patch")] }), {
      runtimeKind: "project",
      goalText: "工单系统",
      projectRevision: "prv-abc",
    });
    expect(model!.badge).toBe("未发布");
    expect(model!.canPublish).toBe(true);
  });

  it("反向：还在跑的轮次不出卡", () => {
    expect(
      resultCardModel(turn({ status: "streaming" }), {
        runtimeKind: "html-prototype",
        hasPages: true,
      })
    ).toBeNull();
  });

  it("反向：失败轮不出卡——真机那趟 content_filter 就是这形态", () => {
    // 整轮没有任何产出：没画页面、没落库版本。挂一张「任务已完成」的卡
    // 就是伪造绿灯（§7：闭环类 fail-closed）。
    expect(
      resultCardModel(turn({ main: null }), {
        runtimeKind: "html-prototype",
        hasPages: false,
      })
    ).toBeNull();
    expect(
      resultCardModel(turn(), { runtimeKind: "project", projectRevision: "" })
    ).toBeNull();
    expect(
      resultCardModel(turn(), { runtimeKind: "project", projectRevision: null })
    ).toBeNull();
  });

  it("反向：会话已经有版本，提问/写计划轮仍不出卡——Manus 是做完才出卡", () => {
    // 2026-09-18：批准后模板落库，开场两轮（34s / 48s）被会话级 revision
    // 重绘成「任务已完成」。变异：produced 只看 projectRevision → 本条红。
    const asked = turn({ user: "做一个待办清单系统", steps: [] });
    const planned = turn({
      user: "批准计划并执行",
      steps: [chip("todo_write"), chip("project_status")],
    });
    for (const item of [asked, planned]) {
      expect(
        resultCardModel(item, {
          runtimeKind: "project",
          goalText: "做一个待办清单系统",
          projectRevision: "prv-f34225ac76324d96854a73c69bfcd33b",
        })
      ).toBeNull();
      expect(turnDeliveredProject(item)).toBe(false);
    }
  });

  it("反向：建完工程只读不写，不许画任务已完成（2026-09-23 真机）", () => {
    // 管理员账号，待办清单话题，执行 10m 44s。页面上的轨迹原样是：
    //   通知用户 · 创建工程 · 读取 2 次 · 读取 8 次 · 读取 6 次 · 读取 5 次
    //            · 读取 5 次 · 读取 4 次 · 读取 4 次 · 读取 4 次
    // 38 次读、project_patch / file_write 零次，src/style.css 还是模板那 2 行，
    // 而结果卡点亮了「✓ 任务已完成 10m 44s」。
    //
    // 把 "project_create" 加回 PROJECT_DELIVERY_TOOLS → 本条红。
    const readOnly = turn({
      user: "创建一个真实工程模式的待办清单应用",
      steps: [
        chip("message_notify_user"),
        chip("project_create"),
        ...Array.from({ length: 8 }, () => chip("project_read")),
      ],
    });
    expect(turnDeliveredProject(readOnly)).toBe(false);
    expect(
      resultCardModel(readOnly, {
        runtimeKind: "project",
        goalText: "创建一个真实工程模式的待办清单应用",
        // ⚠ 版本是有的——工程真的建起来了。所以**只靠 revision 判完成**
        //   正是这个病；判据必须让 revision 在场还是不出卡。
        projectRevision: "prv-61e871592e3157c8a2a01f3cb35339c8",
      })
    ).toBeNull();
  });

  it("正向：同一轮里只要真写过一次，就还是出卡", () => {
    // 反向那条不能把「读很多 + 写一次」也毙掉——读源码是正当动作。
    const wrote = turn({
      steps: [
        chip("project_create"),
        ...Array.from({ length: 8 }, () => chip("project_read")),
        chip("project_patch"),
      ],
    });
    expect(turnDeliveredProject(wrote)).toBe(true);
    expect(
      resultCardModel(wrote, { runtimeKind: "project", projectRevision: "prv-abc" })
    ).not.toBeNull();
  });

  it("反向：写了但失败的轮次不出卡，不许把红灯画成任务已完成", () => {
    expect(
      resultCardModel(turn({ steps: [chip("file_write", "failed")] }), {
        runtimeKind: "project",
        projectRevision: "prv-abc",
      })
    ).toBeNull();
  });

  it("反向：纯问答轮（没产出）不出卡", () => {
    expect(resultCardModel(turn({ main: null }), {})).toBeNull();
  });

  it("反向：办公计划 project_create 落下空工作区，不许画任务已完成", () => {
    // 2026-09-21 sr-20260921102816-KWETH78PZ0：5m 56s 绿灯，产物 0 份。
    const created = turn({
      user: "@office-skills 做一份5页PPT",
      steps: [chip("project_create"), chip("todo_write")],
    });
    expect(
      resultCardModel(created, {
        runtimeKind: "project",
        goalText: "做一份5页PPT",
        projectRevision: "prv-09497b738447421792bfb1537e73ebbe",
        deliverableKind: OFFICE_FILE,
        hasOfficeArtifact: false,
      })
    ).toBeNull();
    // ⚠ 2026-09-23：这里原来是 `toBe(true)`——那时 project_create 还在
    //   PROJECT_DELIVERY_TOOLS 里。建工程不是改工程，两条链现在一致。
    expect(turnDeliveredProject(created)).toBe(false);
    expect(turnDeliveredOfficeFile(created)).toBe(false);
  });

  it("反向：办公 bash 芯片绿了但产物库是空的，仍不出卡", () => {
    expect(
      resultCardModel(turn({ steps: [chip("bash")] }), {
        runtimeKind: "project",
        projectRevision: "prv-abc",
        deliverableKind: OFFICE_FILE,
        hasOfficeArtifact: false,
      })
    ).toBeNull();
  });

  it("正向：办公这一轮跑了 bash 且产物库有文件 → 出卡，但不谈发布", () => {
    const model = resultCardModel(turn({ steps: [chip("bash")] }), {
      runtimeKind: "project",
      goalText: "做一份5页PPT",
      projectRevision: "prv-abc",
      deliverableKind: OFFICE_FILE,
      hasOfficeArtifact: true,
    });
    expect(model).not.toBeNull();
    expect(model!.canPublish).toBe(false);
    // 2026-09-26 sr-20260926043506-7B49NNSE1M：PPT 的卡曾标「未发布」——文件没有发布这一说。
    expect(model!.badge).toBe(OFFICE_BADGE);
    expect(model!.badge).not.toBe("未发布");
    expect(turnDeliveredOfficeFile(turn({ steps: [chip("bash")] }))).toBe(true);
  });

  it("反向：坏输入不许崩", () => {
    expect(resultCardModel(null, {})).toBeNull();
    expect(resultCardModel(undefined, {})).toBeNull();
  });
});

describe("标题：拿得到什么写什么，拿不到不编", () => {
  it("优先会话话题，其次这一轮的用户原话", () => {
    const withGoal = resultCardModel(turn(), {
      runtimeKind: "html-prototype", hasPages: true, goalText: "记账小应用",
    });
    expect(withGoal!.title).toBe("记账小应用");

    const noGoal = resultCardModel(turn({ user: "做个待办清单" }), {
      runtimeKind: "html-prototype", hasPages: true, goalText: "   ",
    });
    expect(noGoal!.title).toBe("做个待办清单");
  });

  it("反向：两个都没有时给一句中性的，不许拿工具名或 id 凑", () => {
    const bare = resultCardModel(turn({ user: "" }), {
      runtimeKind: "html-prototype", hasPages: true,
    });
    expect(bare!.title).toBe("这一轮的成果");
    expect(bare!.title).not.toContain("t1");
  });
});

describe("缩略图：拿不到就是没有", () => {
  it("反向：今天恒为 null——截图服务只在生成过程里做自检，没落成会话产物", () => {
    const model = resultCardModel(turn(), {
      runtimeKind: "html-prototype", hasPages: true,
    });
    expect(model!.thumbnailUrl).toBeNull();
  });

  it("正向：真给了地址才显示（留着入口，但不自己去别处拼）", () => {
    const model = resultCardModel(turn(), {
      runtimeKind: "html-prototype", hasPages: true,
      thumbnailUrl: "/sliderule/freeform-preview/p1.png",
    });
    expect(model!.thumbnailUrl).toBe("/sliderule/freeform-preview/p1.png");
  });

  it("反向：空白字符串当成没有，不许渲染一个断图", () => {
    const model = resultCardModel(turn(), {
      runtimeKind: "html-prototype", hasPages: true, thumbnailUrl: "   ",
    });
    expect(model!.thumbnailUrl).toBeNull();
  });
});

describe("通电：真的接在完成轮的渲染上（§3）", () => {
  it("SlideRule.tsx 必须渲染 TurnResultCard，而且喂的是真数据", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(
      path.resolve(process.cwd(), "client/src/pages/SlideRule.tsx"), "utf8"
    );
    // ⚠ 用带边界的正则，不用 toContain。2026-09-14 变异时逮到：
    //   `toContain("<TurnResultCard")` 在改名成 `<TurnResultCardXX` 之后
    //   **照样绿**（子串还在），判据等于没写。§2 那条「把修复改回去要变红」
    //   就是这么被糊弄过去的。
    expect(src).toMatch(/<TurnResultCard[\s/>]/);
    expect(src).toContain("projectRevision={ctx.projectRevision}");
    expect(src).toContain("hasPages={Boolean(turn.main)}");
    expect(src).toContain("deliverableKind={deliverableKind}");
    expect(src).toContain("hasOfficeArtifact={hasOfficeArtifact}");
    expect(src).toMatch(/useOfficeArtifactPresent\(/);
    expect(src).not.toMatch(/hasOfficeArtifact=\{true\}/);
    // 反向：不许挂在还在跑的那一支上（那会让卡片在跑的过程中闪出来）
    const streamingBranch = src.slice(
      src.indexOf('turn.status === "streaming" ? ('),
      src.indexOf("<TurnPhaseTimeline")
    );
    expect(streamingBranch).not.toContain("<TurnResultCard");
  });

  it("出卡必须看这一轮是否写了源码，不能只看会话 revision", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const raw = fs.readFileSync(
      path.resolve(process.cwd(), "client/src/pages/sliderule/turn-result-card.ts"),
      "utf8"
    );
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    const start = code.indexOf("export function resultCardModel");
    const next = code.indexOf("export function", start + "export function resultCardModel".length);
    const fn = code.slice(start, next === -1 ? code.length : next);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(fn).toContain("turnDeliveredProject");
    expect(fn).toContain("turnDeliveredOfficeFile");
    expect(fn).toContain("hasOfficeArtifact");
    expect(fn).toContain("isOfficeFileDeliverable");
  });
});

/**
 * ⚠ 2026-09-25 隔离真机 sr-20260925025649-74E9KCWHAB（记账网页）：构建过了、
 *   预览和独立浏览器都没起来，宿主 `/delivery` 判 eligible=false，后端结算
 *   追了一句 goal_not_delivered——而对话流里这张卡照样写「✓ 任务已完成」。
 *   卡上的「完成」只认宿主判定：没拿到判定（null）也不算完成。
 *   把 verdictGated 那一行改回恒为 "done"，前三条变红。
 */
describe("网页工程：任务已完成只认宿主交付判定", () => {
  const web = (delivered?: boolean | null) =>
    resultCardModel(turn({ steps: [chip("project_patch")] }), {
      runtimeKind: "project",
      projectRevision: "prv-1",
      ...(delivered === undefined ? {} : { delivered }),
    });

  it("判定没通过：出卡（东西确实写了），但不说已完成", () => {
    expect(web(false)?.status).toBe("undelivered");
  });

  it("还没拿到判定：不当成已交付", () => {
    expect(web(null)?.status).toBe("undelivered");
  });

  it("判定通过才是已完成", () => {
    expect(web(true)?.status).toBe("done");
  });

  it("反向：历史轮次不传判定，不回头把旧卡改成未交付", () => {
    expect(web(undefined)?.status).toBe("done");
  });

  it("反向：办公文件按产物库证据判，不受网页判定影响", () => {
    const m = resultCardModel(
      turn({ steps: [chip("project_create"), chip("shell_exec")] }),
      {
        runtimeKind: "project",
        projectRevision: "prv-1",
        deliverableKind: OFFICE_FILE,
        hasOfficeArtifact: true,
        delivered: false,
      }
    );
    expect(m?.status).toBe("done");
  });

  it("通电：SlideRule 给最新一轮喂的是 /delivery 的判定，不是写死的值", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs
      .readFileSync(path.resolve(process.cwd(), "client/src/pages/SlideRule.tsx"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    expect(src).toMatch(/useProjectDeliveryVerdict\(/);
    expect(src).toMatch(
      /delivered=\{\s*turn\.id === ctx\.latestTurnId \? \(deliveryVerdict\?\.eligible \?\? null\) : undefined\s*\}/
    );
    expect(src).toMatch(
      /deliveryBlockedReasons=\{\s*turn\.id === ctx\.latestTurnId \? deliveryVerdict\?\.blockedReasons : undefined\s*\}/
    );
    expect(src).not.toMatch(/delivered=\{true\}/);
  });
});

/**
 * ⚠ 2026-09-25 隔离真机 sr-20260925070944-QGT6D76EYV：验收被预览访问票挡住，收尾
 *   通知说「没能在这个环境里跑起来」，卡上却写「还没通过交付验收」。缺项码取服务端
 *   /delivery 原样的 blockedReasons。
 */
describe("没交付的是哪一种：没通过 / 没能跑起来", () => {
  const web = (reasons?: string[]) =>
    resultCardModel(turn({ steps: [chip("project_patch")] }), {
      runtimeKind: "project",
      projectRevision: "prv-1",
      delivered: false,
      deliveryBlockedReasons: reasons,
    });

  it("只剩环境挡着：说没能跑起来", () => {
    expect(web(["project_verification_environment_blocked"])?.undeliveredWhy).toBe("environment");
  });

  it("反向：验收确实没过，照旧是没通过", () => {
    expect(web(["project_current_business_verification_required"])?.undeliveredWhy).toBe("not_passed");
  });

  it("反向：环境挡着之外还缺别的，不能只怪环境", () => {
    expect(
      web(["project_verification_environment_blocked", "project_plan_approval_required"])?.undeliveredWhy
    ).toBe("not_passed");
  });

  it("反向：没拿到缺项码，不猜", () => {
    expect(web(undefined)?.undeliveredWhy).toBe("not_passed");
    expect(web([])?.undeliveredWhy).toBe("not_passed");
  });
});
