/**
 * installed-skills — 技能库 marketplace 的"已安装"本地层（纯函数 + localStorage）。
 *
 * 安装 = 把技能语义档案（名称/描述/输入输出线索）落进本地已安装列表，
 * 之后在「已安装」tab 里直接输入试跑（走 /aigc-tryrun 真 LLM 通道）——
 * 装完即用。与运行时行数据/画布设计同一本地层哲学：会话无关、可卸载、
 * 不改任何服务端状态。
 */

export interface InstalledSkill {
  /** 安装唯一键：语义档案 = 仓库键；原版技能包 = 包 id（一仓可装多技能） */
  repo: string;
  url: string;
  license: string;
  name: string;
  description: string;
  ioHints: string[];
  installedAt: string;
  /** "package" = 原版 SKILL.md 指令执行；缺省/"semantic" = 语义档案驱动 */
  kind?: "package" | "semantic";
  /** kind=package 时的技能包 id（/skill-package-tryrun 用） */
  packageId?: string;
}

const KEY = "sliderule:installed-skills";

export function loadInstalledSkills(): InstalledSkill[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as InstalledSkill[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function save(list: InstalledSkill[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* 存储不可用 → 内存态仍生效 */
  }
}

/** 安装唯一键：技能包按包 id（一仓多技能各装各的），语义档案按仓库键。 */
export function installKeyOf(skill: Pick<InstalledSkill, "repo" | "packageId">): string {
  return skill.packageId ?? skill.repo;
}

/** 幂等安装（同键重复安装为 no-op），返回新列表。 */
export function installSkill(
  list: InstalledSkill[],
  skill: Omit<InstalledSkill, "installedAt">
): InstalledSkill[] {
  const key = installKeyOf(skill);
  if (list.some((s) => installKeyOf(s) === key)) return list;
  const next = [...list, { ...skill, installedAt: new Date().toISOString() }];
  save(next);
  return next;
}

export function uninstallSkill(list: InstalledSkill[], key: string): InstalledSkill[] {
  const next = list.filter((s) => installKeyOf(s) !== key);
  save(next);
  return next;
}

export function isInstalled(list: InstalledSkill[], key: string): boolean {
  return list.some((s) => installKeyOf(s) === key);
}

/**
 * 推演注入载荷（技能库六期）：已安装技能瘦身为 {name, description}，
 * 上限 6 条（prompt 预算）——随 /drive-full 请求进服务端，生成契约要求
 * 每项落成一条 aigc.capabilities（字段绑定仍过门禁硬校验）。
 */
export function installedSkillsDrivePayload(): Array<{ name: string; description: string }> {
  return loadInstalledSkills()
    .slice(0, 6)
    .map((s) => ({ name: s.name.slice(0, 60), description: s.description.slice(0, 160) }));
}
