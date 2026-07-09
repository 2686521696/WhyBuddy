/**
 * installed-skills — 技能库 marketplace 的"已安装"本地层（纯函数 + localStorage）。
 *
 * 安装 = 把技能语义档案（名称/描述/输入输出线索）落进本地已安装列表，
 * 之后在「已安装」tab 里直接输入试跑（走 /aigc-tryrun 真 LLM 通道）——
 * 装完即用。与运行时行数据/画布设计同一本地层哲学：会话无关、可卸载、
 * 不改任何服务端状态。
 */

export interface InstalledSkill {
  /** 仓库键（host/owner/repo），也是安装唯一键 */
  repo: string;
  url: string;
  license: string;
  name: string;
  description: string;
  ioHints: string[];
  installedAt: string;
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

/** 幂等安装（同 repo 重复安装为 no-op），返回新列表。 */
export function installSkill(
  list: InstalledSkill[],
  skill: Omit<InstalledSkill, "installedAt">
): InstalledSkill[] {
  if (list.some((s) => s.repo === skill.repo)) return list;
  const next = [...list, { ...skill, installedAt: new Date().toISOString() }];
  save(next);
  return next;
}

export function uninstallSkill(list: InstalledSkill[], repo: string): InstalledSkill[] {
  const next = list.filter((s) => s.repo !== repo);
  save(next);
  return next;
}

export function isInstalled(list: InstalledSkill[], repo: string): boolean {
  return list.some((s) => s.repo === repo);
}
