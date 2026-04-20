import {
  BriefcaseBusiness,
  FileSearch,
  FolderKanban,
  HelpCircle,
  LayoutGrid,
  type LucideIcon,
  Settings2,
  Shield,
} from "lucide-react";

export type PrimaryNavigationId = "office" | "more";
export type MainPathId = "office" | "tasks";
export type MoreNavigationId =
  | "config"
  | "permissions"
  | "audit"
  | "help";

export interface NavigationItem<TId extends string> {
  id: TId;
  icon: LucideIcon;
  href?: string;
}

export const LEGACY_COMMAND_CENTER_PATH = "/command-center";
export const LEGACY_COMMAND_CENTER_LEGACY_PATH = "/command-center/legacy";
export const DEBUG_PATH = "/debug";
export const DEBUG_CONFIG_PATH = "/debug/config";
export const DEBUG_PERMISSIONS_PATH = "/debug/permissions";
export const DEBUG_AUDIT_PATH = "/debug/audit";
export const DEBUG_HELP_PATH = "/debug/help";

export const PRIMARY_NAV_ITEMS: Array<NavigationItem<PrimaryNavigationId>> = [
  {
    id: "office",
    icon: BriefcaseBusiness,
    href: "/",
  },
  {
    id: "more",
    icon: LayoutGrid,
  },
];

export const MAIN_PATH_ITEMS: Array<NavigationItem<MainPathId>> = [
  {
    id: "office",
    icon: BriefcaseBusiness,
    href: "/",
  },
  {
    id: "tasks",
    icon: FolderKanban,
    href: "/tasks",
  },
];

export const MORE_NAV_ITEMS: Array<NavigationItem<MoreNavigationId>> = [
  {
    id: "config",
    icon: Settings2,
    href: DEBUG_CONFIG_PATH,
  },
  {
    id: "permissions",
    icon: Shield,
    href: DEBUG_PERMISSIONS_PATH,
  },
  {
    id: "audit",
    icon: FileSearch,
    href: DEBUG_AUDIT_PATH,
  },
  {
    id: "help",
    icon: HelpCircle,
    href: DEBUG_HELP_PATH,
  },
];

export function isLowFrequencyPath(path: string) {
  return (
    path.startsWith(DEBUG_PATH) ||
    path.startsWith("/lineage") ||
    path.startsWith(LEGACY_COMMAND_CENTER_PATH)
  );
}

export function getPrimaryNavigationId(path: string): PrimaryNavigationId {
  if (isLowFrequencyPath(path)) return "more";
  return "office";
}
