/**
 * code-projection — 五系统 schema → 工程代码的确定性投影（代码视图一期）。
 *
 * 与运行应用同源：schema 是唯一真相，运行界面是它的交互投影，这里是
 * 它的代码投影——纯函数、零 LLM、可逐字节测试。生成的是"读得懂的
 * 工程骨架"（DDL/类型/状态机/权限/页面/AI 接口），不是可直接部署的
 * 成品；每个文件头都注明这一点，修改应回到意图重新推演而不是改产物。
 */

import type {
  FiveSystemModel,
  FiveSystemField,
  WorkflowChain,
} from "../system-screens/five-system-model";
import { normalizeFieldFormat, normalizeFieldOptions } from "./field-display";

export interface ProjectedFile {
  /** 展示用相对路径（如 "db/schema.sql"） */
  path: string;
  /** 渲染提示（纯展示，不接高亮库） */
  language: "sql" | "typescript" | "tsx" | "markdown";
  content: string;
}

const HEADER_NOTE =
  "由 SlideRule 五系统 schema 确定性投影生成（只读视图）——想改这里的内容，请回到意图重新推演，而不是改这份代码";

function comment(lang: ProjectedFile["language"], text: string): string {
  return lang === "sql"
    ? `-- ${text}`
    : lang === "markdown"
      ? `<!-- ${text} -->`
      : `// ${text}`;
}

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** 中文/非法 id → 合法标识符（保留原文进注释；确定性哈希后缀防撞） */
function toIdent(raw: string, fallback: string): string {
  const s = String(raw || "").trim();
  if (IDENT_RE.test(s)) return s;
  const ascii = s.replace(/[^A-Za-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  if (ascii && IDENT_RE.test(ascii)) return ascii;
  let hash = 0;
  for (const ch of s) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return `${fallback}_${hash.toString(36)}`;
}

function sqlType(field: FiveSystemField): string {
  switch (String(field.type || "string").toLowerCase()) {
    case "number":
      return "NUMERIC";
    case "date":
      return "DATE";
    default:
      return "TEXT"; // string / text / enum / ref 底层都存文本
  }
}

// --- db/schema.sql -----------------------------------------------------------

function buildSchemaSql(model: FiveSystemModel): string {
  const lines: string[] = [comment("sql", HEADER_NOTE), ""];
  for (const entity of model.datamodel?.entities ?? []) {
    const table = toIdent(entity.id, "entity");
    lines.push(`-- ${entity.name || entity.id}`);
    lines.push(`CREATE TABLE ${table} (`);
    const cols: string[] = [`  id TEXT PRIMARY KEY`];
    for (const field of entity.fields ?? []) {
      if (field.id === "id") continue;
      const col = toIdent(field.id, "field");
      let def = `  ${col} ${sqlType(field)}`;
      const options = normalizeFieldOptions(field.type, field.options);
      if (options.length > 0) {
        def += ` CHECK (${col} IN (${options.map(o => `'${o.id.replace(/'/g, "''")}'`).join(", ")}))`;
      }
      const notes: string[] = [];
      if (field.name && field.name !== field.id) notes.push(field.name);
      const format = normalizeFieldFormat(field.type, field.format);
      if (format) notes.push(`format=${format}`);
      if (String(field.type).toLowerCase() === "ref")
        notes.push("外键（按命名约定关联）");
      if (notes.length > 0) def += ` -- ${notes.join(" · ")}`;
      cols.push(def);
    }
    lines.push(cols.join(",\n"));
    lines.push(`);`);
    lines.push("");
  }
  return lines.join("\n");
}

// --- src/types.ts ------------------------------------------------------------

function tsType(field: FiveSystemField): string {
  const options = normalizeFieldOptions(field.type, field.options);
  if (options.length > 0)
    return options.map(o => JSON.stringify(o.id)).join(" | ");
  switch (String(field.type || "string").toLowerCase()) {
    case "number":
      return "number";
    default:
      return "string";
  }
}

function buildTypesTs(model: FiveSystemModel): string {
  const lines: string[] = [comment("typescript", HEADER_NOTE), ""];
  for (const entity of model.datamodel?.entities ?? []) {
    const name = toIdent(entity.id, "entity")
      .split("_")
      .map(w => (w ? w[0].toUpperCase() + w.slice(1) : w))
      .join("");
    lines.push(`/** ${entity.name || entity.id} */`);
    lines.push(`export interface ${name} {`);
    for (const field of entity.fields ?? []) {
      const notes: string[] = [];
      if (field.name && field.name !== field.id) notes.push(field.name);
      const format = normalizeFieldFormat(field.type, field.format);
      if (format) notes.push(`format=${format}`);
      if (notes.length > 0) lines.push(`  /** ${notes.join(" · ")} */`);
      lines.push(`  ${toIdent(field.id, "field")}: ${tsType(field)};`);
    }
    lines.push(`}`);
    lines.push("");
  }
  return lines.join("\n");
}

// --- src/workflow.ts ---------------------------------------------------------

function chainBlock(
  label: string,
  chain: WorkflowChain,
  indent = ""
): string[] {
  const lines: string[] = [];
  lines.push(`${indent}/** ${label} */`);
  lines.push(`${indent}{`);
  lines.push(`${indent}  id: ${JSON.stringify(chain.id ?? "")},`);
  if (chain.kind) lines.push(`${indent}  kind: ${JSON.stringify(chain.kind)},`);
  lines.push(`${indent}  states: [`);
  for (const node of chain.nodes ?? []) {
    const parts = [
      `id: ${JSON.stringify(node.id)}`,
      `name: ${JSON.stringify(node.name || node.id)}`,
    ];
    if (node.assigneeRole)
      parts.push(`assigneeRole: ${JSON.stringify(node.assigneeRole)}`);
    if (node.phase) parts.push(`phase: ${JSON.stringify(node.phase)}`);
    lines.push(`${indent}    { ${parts.join(", ")} },`);
  }
  lines.push(`${indent}  ],`);
  lines.push(`${indent}  transitions: [`);
  for (const t of chain.transitions ?? []) {
    const cond = t.condition
      ? `, condition: ${JSON.stringify(t.condition)}`
      : "";
    lines.push(
      `${indent}    { from: ${JSON.stringify(t.from)}, to: ${JSON.stringify(t.to)}${cond} },`
    );
  }
  lines.push(`${indent}  ],`);
  lines.push(`${indent}},`);
  return lines;
}

function buildWorkflowTs(model: FiveSystemModel): string {
  const wf = model.workflow ?? {};
  const lines: string[] = [
    comment("typescript", HEADER_NOTE),
    "// 状态机声明：主链路 = 核心业务对象生命周期；chains = 附加业务链路",
    "",
    "export const workflows = [",
  ];
  lines.push(
    ...chainBlock(`主链路：${wf.name || wf.id || "primary"}`, wf, "  ")
  );
  for (const chain of wf.chains ?? []) {
    lines.push(
      ...chainBlock(
        `附加链路：${chain.name || chain.id || chain.kind || "chain"}`,
        chain,
        "  "
      )
    );
  }
  lines.push("] as const;");
  lines.push("");
  return lines.join("\n");
}

// --- src/rbac.ts ---------------------------------------------------------------

function buildRbacTs(model: FiveSystemModel): string {
  const rbac = model.rbac ?? {};
  const lines: string[] = [comment("typescript", HEADER_NOTE), ""];
  lines.push(
    `export const ROLES = ${JSON.stringify(rbac.roles ?? [], null, 2)} as const;`
  );
  lines.push("");
  lines.push(
    `export const PERMISSIONS = ${JSON.stringify(rbac.permissions ?? [], null, 2)} as const;`
  );
  lines.push("");
  lines.push("/** 菜单可见性与权限授予（角色 → 菜单 → 权限） */");
  lines.push("export const MENUS = [");
  for (const menu of rbac.menus ?? []) {
    lines.push(
      `  { id: ${JSON.stringify(menu.id ?? "")}, label: ${JSON.stringify(menu.label ?? "")}, roles: ${JSON.stringify(menu.roleRefs ?? [])}, permissions: ${JSON.stringify(menu.permissionRefs ?? [])} },`
    );
  }
  lines.push("] as const;");
  lines.push("");
  return lines.join("\n");
}

// --- src/pages.tsx --------------------------------------------------------------

function buildPagesTsx(model: FiveSystemModel): string {
  const lines: string[] = [
    comment("tsx", HEADER_NOTE),
    "// 页面骨架：kind 决定视图范式（与运行应用同一套语义）",
    "",
  ];
  for (const [i, page] of (model.page?.pages ?? []).entries()) {
    const compName = toIdent(page.id ?? `page_${i + 1}`, "page")
      .split("_")
      .map(w => (w ? w[0].toUpperCase() + w.slice(1) : w))
      .join("");
    const kind = String(page.kind ?? "workbench");
    lines.push(`/** ${page.name || page.id} · 范式：${kind} */`);
    lines.push(`export function ${compName}Page() {`);
    for (const stat of page.stats ?? []) {
      lines.push(
        `  // KPI：${stat.name ?? stat.id}（${stat.metric ?? "count"}${stat.format && stat.format !== "number" ? ` · ${stat.format}` : ""}）`
      );
    }
    for (const chart of page.charts ?? []) {
      lines.push(
        `  // 图表：${chart.name ?? chart.id}（${chart.type} · ${chart.dimension} · ${chart.metric ?? "count"}）`
      );
    }
    lines.push(`  return (`);
    if (kind === "kanban") {
      lines.push(
        `    <KanbanBoard statusField=${JSON.stringify(page.statusField ?? "")} />`
      );
    } else if (kind === "calendar") {
      const colorBy = page.colorBy
        ? ` colorBy=${JSON.stringify(page.colorBy)}`
        : "";
      lines.push(
        `    <CalendarBoard dateField=${JSON.stringify(page.dateField ?? "")}${colorBy} />`
      );
    } else {
      lines.push(`    <DataTable`);
      lines.push(`      columns={${JSON.stringify(page.fieldBindings ?? [])}}`);
      lines.push(
        `      actions={${JSON.stringify(page.actionPermissions ?? [])}}`
      );
      lines.push(`    />`);
    }
    lines.push(`  );`);
    lines.push(`}`);
    lines.push("");
  }
  return lines.join("\n");
}

// --- src/aigc.ts ----------------------------------------------------------------

function buildAigcTs(model: FiveSystemModel): string {
  const aigc = model.aigc ?? {};
  const lines: string[] = [
    comment("typescript", HEADER_NOTE),
    "// AI 能力接口：inputFields → outputField 是字段级契约（运行时建议式写回，",
    "// 用户确认才落数据——见 AiSuggestionCard）",
    "",
  ];
  for (const [i, cap] of (aigc.capabilities ?? []).entries()) {
    const fn = toIdent(cap.id ?? `cap_${i + 1}`, "cap");
    lines.push(
      `/** ${cap.name ?? cap.id} · 可用角色：${(cap.roleRefs ?? []).join("/") || "全部"} */`
    );
    lines.push(`export async function ${fn}(input: {`);
    for (const ref of cap.inputFields ?? []) {
      lines.push(`  ${JSON.stringify(ref)}: string;`);
    }
    lines.push(
      `}): Promise<{ output: string; confidence?: number; rationale?: string }> {`
    );
    lines.push(`  // 写回目标：${cap.outputField ?? "（未声明）"}`);
    lines.push(
      `  return callLlmExplain(${JSON.stringify(cap.name ?? cap.id ?? fn)}, input);`
    );
    lines.push(`}`);
    lines.push("");
  }
  for (const pipe of aigc.pipelines ?? []) {
    const steps = pipe.steps ?? [];
    lines.push(
      `/** 编排：${pipe.name ?? pipe.id}（上一步 outputField 必须是下一步 inputFields 之一） */`
    );
    lines.push(
      `export const ${toIdent(pipe.id ?? "pipeline", "pipeline")} = ${JSON.stringify(steps)} as const;`
    );
    lines.push("");
  }
  return lines.join("\n");
}

// --- README.md ------------------------------------------------------------------

function buildReadme(model: FiveSystemModel, appName: string): string {
  const entities = model.datamodel?.entities ?? [];
  const pages = model.page?.pages ?? [];
  const caps = model.aigc?.capabilities ?? [];
  const invariants = model.appbundle?.invariants ?? [];
  const lines: string[] = [
    `# ${appName}`,
    "",
    comment("markdown", HEADER_NOTE),
    "",
    "本目录是五系统 schema 的**代码投影**：与右侧运行应用同源同真相。",
    "",
    "| 文件 | 来源系统 | 内容 |",
    "|---|---|---|",
    "| `db/schema.sql` | datamodel | 表结构（enum 取值落成 CHECK 约束） |",
    "| `src/types.ts` | datamodel | 实体类型（enum 取值落成 union） |",
    "| `src/workflow.ts` | workflow | 状态机（主链路 + 附加链路） |",
    "| `src/rbac.ts` | rbac | 角色 / 权限 / 菜单授予 |",
    "| `src/pages.tsx` | page | 页面骨架（范式 / KPI / 图表声明） |",
    "| `src/aigc.ts` | aigc | AI 能力接口（字段级输入输出契约） |",
    "",
    `规模：${entities.length} 实体 · ${pages.length} 页面 · ${caps.length} 项 AI 能力`,
    "",
  ];
  if (invariants.length > 0) {
    lines.push("## 不变式（实现验收清单）");
    lines.push("");
    for (const inv of invariants) {
      lines.push(
        `- [ ] ${inv.statement ?? inv.id}（约束：${(inv.systems ?? []).join("/")}；落点：${(inv.refs ?? []).join(", ")}）`
      );
    }
    lines.push("");
  }
  return lines.join("\n");
}

/**
 * 五系统模型 → 代码投影文件组。模型缺段时对应文件如实缺席（不伪造）；
 * 五段全空时连 README 也不出（没有可投影的内容就是没有）。
 */
export function deriveCodeProjection(
  model: FiveSystemModel | null | undefined,
  appName = "推演应用"
): ProjectedFile[] {
  if (!model) return [];
  const files: ProjectedFile[] = [];
  if ((model.datamodel?.entities ?? []).length > 0) {
    files.push({
      path: "db/schema.sql",
      language: "sql",
      content: buildSchemaSql(model),
    });
    files.push({
      path: "src/types.ts",
      language: "typescript",
      content: buildTypesTs(model),
    });
  }
  if ((model.workflow?.nodes ?? []).length > 0) {
    files.push({
      path: "src/workflow.ts",
      language: "typescript",
      content: buildWorkflowTs(model),
    });
  }
  if ((model.rbac?.roles ?? []).length > 0) {
    files.push({
      path: "src/rbac.ts",
      language: "typescript",
      content: buildRbacTs(model),
    });
  }
  if ((model.page?.pages ?? []).length > 0) {
    files.push({
      path: "src/pages.tsx",
      language: "tsx",
      content: buildPagesTsx(model),
    });
  }
  if ((model.aigc?.capabilities ?? []).length > 0) {
    files.push({
      path: "src/aigc.ts",
      language: "typescript",
      content: buildAigcTs(model),
    });
  }
  if (files.length === 0) return [];
  return [
    {
      path: "README.md",
      language: "markdown" as const,
      content: buildReadme(model, appName),
    },
    ...files,
  ];
}
