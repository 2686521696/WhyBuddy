/**
 * D1: Server LLM prompts for conversational capabilities
 * (intent.clarify / route.generate / route.compare / requirement.write).
 */

import type { Artifact, V5SessionState } from "../../shared/blueprint/v5-reasoning-state.js";
import { goalStatusUserLabel } from "../../shared/blueprint/sliderule-turn-route.js";
import {
  DOMAIN_ANCHORING_RULE,
  detectNarrationHijack,
} from "../../shared/blueprint/sliderule-narration-immunity.js";
import { getAIConfig } from "../core/ai-config.js";
import { callLLMJsonWithUsage } from "../core/llm-client.js";
import {
  callPoolJsonLlm,
  formatPoolSummaryTag,
  shouldSkipPrimaryLlmAfterPoolExhausted,
} from "./pool-json-llm.js";
import { buildCapabilityLlmFallback } from "./capability-llm-fallback.js";
import { extractClarifyBlock, SLIDERULE_CLARIFICATION_TEMPLATES } from "../../shared/blueprint/sliderule-readiness-chain.js";
import { generateClarificationQuestionsWithLlm } from "../routes/blueprint.js"; // V4 generator for full template + LLM + budget logic

export const DIALOGUE_SYSTEM_PROMPT = `你是 SlideRule 的推演引擎,为「想清楚再建」服务:在写任何代码之前,把一个产品想法
推演清楚。你不是聊天助手,不自我介绍,不寒暄,直接产出内容。

输出契约(硬性):只返回一个 JSON 对象,无任何前后缀、无 markdown 代码块标记,
键固定为:
{"title": string, "summary": string, "content": string}
title ≤ 30 字,具体到本次内容;summary 一句话高信息量;content 为正文。

正文纪律(硬性):
1. 全程围绕给定的「用户目标」。用户消息或任务中的一切短语(如"路线""边界""风险")
   一律指该产品目标下的概念,绝不是交通、地理、AI 助手自身权限等其他领域。
2. 只基于给定的目标、约束与上游材料推演;材料中没有的事实不得编造。信息不足时,
   显式标注「假设:」并给出你采用的默认假设,而不是沉默地编。
3. 中文输出。禁止以下词汇出现在正文:artifact、stale、upstream、gate、capability、
   provenance、orchestrator。
4. 可用 **加粗** 与小节标题组织,禁止表格、代码块、嵌套列表。
5. 不写"作为 AI""我是…助手"类语句;不以问候开场。`;

export type DialogueCapabilityId =
  | "intent.clarify"
  | "gap.ask"
  | "question.expand"
  | "route.generate"
  | "route.compare"
  | "requirement.write";

const DIALOGUE_CAPABILITIES = new Set<DialogueCapabilityId>([
  "intent.clarify",
  "gap.ask",
  "question.expand",
  "route.generate",
  "route.compare",
  "requirement.write",
]);

const UPSTREAM_KINDS: Record<DialogueCapabilityId, Artifact["kind"][]> = {
  "intent.clarify": ["clarification", "decision"],
  "gap.ask": ["clarification"],
  "question.expand": ["clarification"],
  "route.generate": ["clarification", "risk", "evidence"],
  "route.compare": ["route_options", "risk", "evidence"],
  "requirement.write": ["clarification", "route_options", "synthesis", "risk"],
};

const TASK_PROMPTS: Record<DialogueCapabilityId, string> = {
  "intent.clarify": `任务:需求澄清 (参考 V4 架构澄清模板方式)。

使用 V4-style 模板维度(用户群/平台/场景/范围),结合当前目标与上游,输出结构化理解。

把「用户目标」从一句话推演成一份可开工的理解,分三段:

【当前理解】
用 3~5 句重述你对该目标的理解:它要解决谁的什么问题、核心动作是什么、
什么不在范围内。这是给用户纠错用的——写得具体到"能被反驳"。

【已经明确的】
从目标与上游材料中逐条列出已确定的约束与决定(每条注明依据来自用户原话
还是材料推断)。没有就写"目前只有目标一句话本身"。

【最需要回答的问题】
参考 V4 模板维度,列出 3~5 个关键未决问题(优先缺失的 users/platform/scenario/scope),按"答案会改变方案走向"的程度排序。每个问题三行:
- 问题本身(必须特定于这个目标——"数据范围按部门还是按项目隔离?"是好问题,
  "预算多少?"这种放之四海皆准的问题禁止出现)
- 为什么关键:答案不同会导致哪两种不同的做法
- 默认假设:如果用户不回答,你建议按什么假设继续,以及该假设的风险

收尾一句话:邀请用户优先回答第 1 个问题,或直接说"按默认假设继续"。`,

  "gap.ask": `任务:阻塞性缺口定位 (C_GAP)。

针对「用户目标」,列出 3~6 个**特定于这个目标**的阻塞性澄清问题,按"答案会改变方案走向"排序。

维度参考(用于打 kind 标签 + 保证覆盖面,不是题库):
- users(kind:"audience")、platform(kind:"platform")、scenario(kind:"success-criteria")、scope(kind:"scope")。
- 优先补齐目标中**缺失**的维度;若某维度目标已说清,就不要再问。
- 鼓励基于目标特性**追加针对性问题并复用最贴切的 kind**:例如涉及数据/隐私→问数据来源与合规边界(kind:"scope" 或 "success-criteria");涉及多端同步/集成→问同步与冲突策略(kind:"platform");涉及提醒/通知类→问触达渠道与时机(kind:"scenario")。
- 每个目标的问题应当**不一样**(随目标变化),禁止每次都输出同一套模板四问。

每个问题必须特定于本目标("数据范围按部门还是按项目隔离?"是好问题;"预算多少?"这类万金油禁止);
options 给 2~4 个简洁候选答法(供快速选,不替用户拍板);没有明确候选则用 free_text(省略 options)。

格式硬性要求:
【阻塞缺口】
- 每条以「?」或「？」结尾,必须特定于本目标(禁止万金油)
- 标注「阻塞原因」: 不回答会导致什么决策无法做

禁止 LLM 替用户回答;禁止宣布目标已足够清晰。

在 content 正文末尾,额外追加一个围栏块(便于前端做成可点选的澄清卡片;字段对齐 V4 BlueprintClarificationQuestion schema),格式严格如下:
\`\`\`clarify-json
[
  {"kind":"audience","prompt":"「目标」主要面向谁使用?","type":"single_choice","options":["个人 / C端","企业内部"],"context":"决定交互与合规","defaultAnswer":"个人 / C端"},
  {"kind":"scope","prompt":"本期范围边界:明确不做什么?","type":"free_text","context":"避免范围漂移"}
]
\`\`\`
- kind: 复用上面列出的模板 kind 之一 ("audience", "platform", "success-criteria", "scope") 给问题打标签(用于卡片分组/着色);选最贴切的即可。
- type: 选择题用 "single_choice"(或可多选 "multi_choice");没有明确候选则 "free_text"。
- options: type 为选择题时给 2~4 个**简洁候选答法**(供用户快速选,不是你替用户拍板);free_text 时省略。
- context: 一句话说明该问题的答案会如何影响后续路线/方案。
- defaultAnswer: 你建议的默认假设/推荐项(对应某个 option 文本或一句假设)。
每个【阻塞缺口】问题对应数组里一条。问题文本/选项必须针对本目标、随目标变化(可按目标特性增减题目);kind 仅作分组标签复用上述四类之一,不要每次都输出同一套模板四问。`,

  "question.expand": `任务:扩展关键问题 (C_QEXP)。

在 gap.ask 或澄清材料基础上,把每个阻塞缺口展开为可操作的追问:
【扩展问题】
对每个阻塞点 2~3 行:
- 追问句(必须可回答)
- 默认假设(若用户沉默则采用)
- 采用默认的风险

结尾明确:需用户从 INTAKE 补充,系统不得自答确认。`,

  "route.generate": `任务:生成实现路线。

为「用户目标」给出 2~4 条结构性不同的实现路线。"结构性不同"指:架构选型、
范围切法或建设顺序不同——同一条路的快慢版、贵贱版不算多条路线,禁止假分叉。

格式硬性要求(下游对比环节按此锚定,不得变体):
每条路线以「路线一:{≤10 字的名字}」「路线二:…」开头,内部固定四小节:
**思路**:2~3 句,这条路的核心取舍是什么
**适合的前提**:什么条件成立时该选它(团队规模、时间压力、确定性高低)
**主要代价**:选它要付出什么(技术债、范围牺牲、风险集中点),至少一条真代价,
"无明显缺点"禁止出现
**第一周做什么**:3 个可立刻执行的动作

路线之间禁止互相吹捧或贬低——对比是下一个环节的事,这里只负责把每条路
各自说清楚。所有路线必须服务于同一个目标与已知约束,不得为凑数发明用户
没提过的需求方向。`,

  "route.compare": `任务:路线对比裁决。

对比对象:上游材料中的路线方案(以「路线一/二/…」锚定)。
- 若上游存在路线:逐条对比它们,不得篡改、增删或重新发明路线内容,只做对比。
- 若上游没有任何路线:在开头第一句声明「本轮没有已生成的路线,以下基于针对
  该目标的快速候选」,然后用一句话各立 2~3 条候选,再进入对比。

对比按四个固定维度,每个维度给出排序与一句话理由:
**上线速度**:谁最快见到能用的东西
**长期演进成本**:一年后谁最不后悔
**风险集中点**:每条路最可能在哪里翻车(必须具体到环节,"有一定风险"禁止)
**小团队适配**:人少时谁最扛得住(维护面、心智负担)

收尾【条件式结论】(硬性格式):
"如果你最看重 {X} → 选{路线N},因为{一句话}"——至少给出两条不同条件下的
不同推荐。禁止"各有千秋""视情况而定"式收尾;也禁止无条件宣布唯一答案——
条件由用户的处境决定,你给的是带前提的判断。`,

  "requirement.write": `任务:需求文档草案。

基于用户目标与上游材料(澄清结论、已选路线、风险),产出可直接评审的需求草案:

**目标与边界**:2~3 句目标重述 + 明确排除项(本期不做什么,至少 2 条——
没有排除项的需求文档等于没写)

**功能需求**:按 P0 / P1 / P2 分级。每条格式:
「P0-1 {一句话需求}|验收:{可机械判定的标准}」
P0 每条必须带验收标准;验收标准必须可判定("体验好""响应快"不合格,
"列表页 1000 条数据下首屏渲染 ≤ 2 秒"合格)。P0 不超过 7 条——超过说明
没想清楚优先级,砍到 7 条以内。

**非功能需求**:只写对该目标真实存在约束的项(性能/安全/合规等),
每条同样带可判定标准。"系统应当安全稳定高性能"这类万金油禁止出现。

**未决依赖**:哪些需求依赖尚未回答的问题或尚未做出的选择,逐条指明
"依赖什么、不解决会阻塞哪条 P0"。

来源纪律:每条需求都应可追溯到目标原文或上游材料;两者都没有依据但你
认为必要的,条目前标「假设:」。`,
};

const TEMPERATURE: Record<DialogueCapabilityId, number> = {
  "intent.clarify": 0.3,
  "gap.ask": 0.25,
  "question.expand": 0.35,
  "route.generate": 0.5,
  "route.compare": 0.25,
  "requirement.write": 0.3,
};

export type DialogueExecArgs = {
  capabilityId: DialogueCapabilityId;
  state: V5SessionState;
  inputArtifactIds?: string[];
  roleId?: string;
  turnId: string;
};

export type DialogueExecutorResult = {
  title: string;
  summary: string;
  content: string;
  provenance?: "llm" | "llm_fallback";
  /** gap.ask 结构化澄清问题（clarify-json 解析）→ 物化带选项的 open_question gaps。 */
  payload?: { clarifyQuestions?: unknown };
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    model?: string;
  };
};

export function isDialogueCapability(id: string): id is DialogueCapabilityId {
  return DIALOGUE_CAPABILITIES.has(id as DialogueCapabilityId);
}

function isHealthyArtifact(artifact: Artifact, staleSet: Set<string>): boolean {
  return (
    (artifact.trustLevel === "gated_pass" || artifact.trustLevel === "audited") &&
    !staleSet.has(artifact.id)
  );
}

function artifactSnippet(artifact: Artifact): Record<string, string> {
  const text = String(artifact.content || artifact.summary || artifact.title || "").trim();
  const limit = artifact.kind === "route_options" ? 2000 : 300;
  return {
    id: artifact.id,
    kind: artifact.kind,
    title: String(artifact.title || "").slice(0, 80),
    content: text.slice(0, limit),
  };
}

/** Exported for D1-A1 tests — upstream filter + prefix assembly. */
export function buildDialogueUserPrompt(args: DialogueExecArgs): string {
  const { capabilityId, state, roleId, inputArtifactIds = [] } = args;
  if (!isDialogueCapability(capabilityId)) {
    throw new Error(`not a dialogue capability: ${capabilityId}`);
  }

  const kinds = UPSTREAM_KINDS[capabilityId];
  const staleSet = new Set(state.staleArtifactIds || []);
  const allHealthy = (state.artifacts || []).filter((a) => isHealthyArtifact(a, staleSet));

  let matched = allHealthy.filter((a) => kinds.includes(a.kind));

  if (capabilityId === "route.compare" && inputArtifactIds.length > 0) {
    const idSet = new Set(inputArtifactIds);
    const prioritized = matched.filter((a) => idSet.has(a.id));
    const rest = matched.filter((a) => !idSet.has(a.id));
    matched = [...prioritized, ...rest];
  } else if (inputArtifactIds.length > 0) {
    const idSet = new Set(inputArtifactIds);
    const fromInputs = matched.filter((a) => idSet.has(a.id));
    const rest = matched.filter((a) => !idSet.has(a.id));
    if (fromInputs.length > 0) {
      matched = [...fromInputs, ...rest];
    }
  }

  const filteredArtifacts = matched.map(artifactSnippet);
  const goalText = state.goal?.text || "";
  const statusLabel = goalStatusUserLabel(state.goal?.status);

  let prefix =
    `用户目标:${goalText}\n` +
    `目标当前状态(机械裁决,照实参考,不得自行宣布更乐观的判断):${statusLabel}\n` +
    `执行角色视角:${roleId || "综合"}\n` +
    `已知上游材料(只可引用,不可篡改;为空则视为信息不足并按纪律 2 处理):\n` +
    `${JSON.stringify(filteredArtifacts, null, 0)}\n`;

  if (capabilityId === "intent.clarify") {
    const tail = (state.conversation || [])
      .slice(-6)
      .map((c) => ({
        role: c.role,
        text: String(c.text || "").slice(0, 300),
      }));
    prefix += `${JSON.stringify(tail, null, 0)}\n`;
  }

  prefix += `${DOMAIN_ANCHORING_RULE}\n`;

  return `${prefix}\n${TASK_PROMPTS[capabilityId]}`;
}

function assertContentNotHijacked(title: string, summary: string, content: string): void {
  for (const blob of [content, title, summary]) {
    const hijack = detectNarrationHijack(blob);
    if (hijack.hijacked) {
      const err = new Error(`llm content hijacked: ${hijack.reason}`);
      throw err;
    }
  }
}

export async function executeDialogueCapability(
  args: DialogueExecArgs
): Promise<DialogueExecutorResult> {
  const config = getAIConfig();
  const userPrompt = buildDialogueUserPrompt(args);
  const temperature = TEMPERATURE[args.capabilityId] ?? 0.3;

  // 完整 generator 切换 for clarify: 直接调用 V4 的 generateClarificationQuestionsWithLlm
  // 传入我们的 SLIDERULE_CLARIFICATION_TEMPLATES 映射为 V4 blueprint + goal/state 作为 input
  // 让 LLM 走 V4 完整逻辑 (budget, 过滤, 多轮 preview + LLM, fallback to templates)
  if (args.capabilityId === "gap.ask" || args.capabilityId === "intent.clarify") {
    try {
      // 映射我们的 templates 到 V4 的 BlueprintClarificationQuestionBlueprint 形状
      const templateQuestions = SLIDERULE_CLARIFICATION_TEMPLATES.map(t => ({
        id: t.id,
        kind: t.kind as any,
        prompt: t.promptTemplate.replace("{goal}", args.state?.goal?.text || ""),
        required: true,
        routeDimension: t.key as any,
        readinessSignal: t.key as any,
        // defaultAnswer 可从模板
      } as any));

      // 最小 intake for SlideRule: 用 goal 作为 targetText, 空 sources (V4 会 fallback)
      const intake = {
        id: args.turnId || "sliderule-clarify",
        targetText: args.state?.goal?.text || "",
        githubUrls: [],
        sources: [],
        domainNotes: "",
        assets: [],
      } as any;

      const strategy = {
        id: "sliderule-readiness",
        label: "SlideRule readiness clarification",
        templateId: "sliderule-readiness",
        summary: "Readiness gaps for users/platform/scenario/scope using V4 templates",
      } as any;

      const v4Result = await generateClarificationQuestionsWithLlm({
        intake,
        strategy,
        templateQuestions,
        now: new Date().toISOString(),
        locale: "zh-CN",
      } as any);

      const v4Questions = v4Result.questions || [];
      if (v4Questions.length > 0) {
        // 映射回我们的 ClarifyQuestion (kind, prompt, type, options, context, defaultAnswer)
        const mapped = v4Questions.map((q: any) => ({
          id: q.id,
          kind: q.kind,
          prompt: q.prompt,
          type: q.type || (q.options?.length ? "single_choice" : "free_text"),
          options: q.options,
          defaultAnswer: q.defaultAnswer,
          context: q.context,
        }));

        const title = "需求澄清";
        const summary = "基于 V4 模板的结构化澄清问题";
        // 构造 content 包含阻塞缺口描述 + clarify-json 块 (保持向下兼容 extract / payload)
        let content = `【阻塞缺口】\n${mapped.map((q: any) => `- ${q.prompt}`).join("\n")}\n\n`;
        content += "```clarify-json\n" + JSON.stringify(mapped.map((q: any) => ({
          kind: q.kind,
          prompt: q.prompt,
          type: q.type,
          options: q.options,
          context: q.context,
          defaultAnswer: q.defaultAnswer,
        }))) + "\n```";

        return {
          title,
          summary,
          content,
          provenance: v4Result.source === "llm" ? "llm" : "llm_fallback",
          payload: { clarifyQuestions: mapped },
          usage: v4Result.model ? { model: v4Result.model } : undefined,
        };
      }
    } catch (e) {
      // fallback to original prompt + LLM path below
    }
  }

  try {
    const pooled = await callPoolJsonLlm<{
      title?: string;
      summary?: string;
      content?: string;
    }>(DIALOGUE_SYSTEM_PROMPT, userPrompt, temperature);

    let json: { title?: string; summary?: string; content?: string } | undefined;
    let usage:
      | { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
      | undefined;
    let modelTag = config.model;
    let summaryTag = `[server-llm:${config.model}]`;

    if (pooled?.json) {
      json = pooled.json;
      usage = pooled.usage
        ? {
            prompt_tokens: pooled.usage.inputTokens,
            completion_tokens: pooled.usage.outputTokens,
            total_tokens: pooled.usage.totalTokens,
          }
        : undefined;
      modelTag = pooled.model;
      summaryTag = formatPoolSummaryTag(pooled.model, pooled.poolLabel);
    } else if (config.apiKey && !shouldSkipPrimaryLlmAfterPoolExhausted()) {
      const primary = await callLLMJsonWithUsage<{
        title?: string;
        summary?: string;
        content?: string;
      }>(
        [
          { role: "system", content: DIALOGUE_SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        {
          model: config.model,
          temperature,
          maxTokens: 8000,
          timeoutMs: Math.min(config.timeoutMs, 120_000),
          retryAttempts: 1,
        } as any
      );
      json = primary.json;
      usage = primary.usage;
    }

    const title = String(json?.title || "").trim().slice(0, 30) || "推演结果";
    const summary = String(json?.summary || "").trim();
    let content = String(json?.content || "").trim();
    if (!content) {
      throw new Error("empty dialogue content from LLM");
    }

    // gap.ask: 解析 clarify-json 围栏块 → 结构化澄清问题(带选项),并从可见正文剥离。
    let clarifyPayload: { clarifyQuestions?: unknown } | undefined;
    if (args.capabilityId === "gap.ask") {
      const { questions, cleanedContent } = extractClarifyBlock(content);
      if (questions && questions.length > 0) {
        clarifyPayload = { clarifyQuestions: questions };
        content = cleanedContent || content;
      }
    }

    assertContentNotHijacked(title, summary, content);

    return {
      title,
      summary: summary ? `${summary} ${summaryTag}` : summaryTag,
      content,
      provenance: "llm",
      ...(clarifyPayload ? { payload: clarifyPayload } : {}),
      usage: usage
        ? {
            inputTokens: usage.prompt_tokens,
            outputTokens: usage.completion_tokens,
            totalTokens: usage.total_tokens,
            model: modelTag,
          }
        : undefined,
    };
  } catch (e: any) {
    const msg = String(e?.message || e);
    if (/hijacked/i.test(msg)) throw e;
    const fb = buildCapabilityLlmFallback({
      capabilityId: args.capabilityId,
      state: args.state,
      inputArtifactIds: args.inputArtifactIds,
      roleId: args.roleId,
      turnId: args.turnId,
      reason: msg.slice(0, 120),
    });
    if (!fb) throw e;
    return {
      title: fb.title,
      summary: fb.summary,
      content: fb.content,
      provenance: "llm_fallback" as const,
    };
  }
}