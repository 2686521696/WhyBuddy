// Page metamodel - distilled from the page designer layer. It stays runtime-less:
// no renderer, no database, only component binding + visibility + linkage rules.

export type ComponentType = "input" | "select" | "number" | "date" | "switch" | "table" | "button" | "text";

export type TriggerEvent = "onChange" | "onClick" | "onLoad";

export type LinkageAction = "setOptions" | "setVisible" | "setDisabled" | "setValue";

export interface PageComponent {
  id: string;
  type: ComponentType;
  label: string;
  /** Cross-skill DataModel field ref, e.g. leave_request.days. */
  field?: string;
  /** Cross-skill RBAC role refs controlling visibility. */
  visibleToRoles?: string[];
}

export interface LinkageRule {
  id: string;
  source: { component: string; event: TriggerEvent };
  target: { component: string; action: LinkageAction };
}

export interface PageModel {
  id: string;
  name: string;
  /** Cross-skill DataModel entity ref. */
  entity: string;
  components: PageComponent[];
  linkageRules: LinkageRule[];
}
