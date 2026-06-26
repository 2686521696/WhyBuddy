import {
  finalizeReport,
  type CrossRefEdge,
  type CrossSkill,
  type Finding,
  type Projection,
  type ResolvableSurface,
  type Skill,
  type ValidateContext,
} from "../skill";
import type { LinkageAction, PageComponent, PageModel, TriggerEvent } from "./pageModel";

function sanitizeId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_]/g, "_");
}

function findDuplicates(ids: string[]): string[] {
  const seen = new Set<string>();
  const dups = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) dups.add(id);
    seen.add(id);
  }
  return [...dups];
}

function componentNodeId(componentId: string): string {
  return `cmp_${sanitizeId(componentId)}`;
}

function pageNodeId(pageId: string): string {
  return `page_${sanitizeId(pageId)}`;
}

function dataModelFieldNodeId(fieldRef: string): string {
  const [entity, field] = fieldRef.split(".");
  return entity && field ? `dm_${sanitizeId(entity)}_${sanitizeId(field)}` : `dm_${sanitizeId(fieldRef)}`;
}

function rbacRoleNodeId(roleRef: string): string {
  return `role_${sanitizeId(roleRef)}`;
}

function rbacPermissionNodeId(permissionRef: string): string {
  return `perm_${sanitizeId(permissionRef)}`;
}

function componentById(model: PageModel): Map<string, PageComponent> {
  return new Map(model.components.map(c => [c.id, c]));
}

function isLinkageCompatible(
  source: PageComponent | undefined,
  event: TriggerEvent,
  target: PageComponent | undefined,
  action: LinkageAction,
): boolean {
  if (!source || !target) return true;
  if (event === "onClick" && source.type !== "button") return false;
  if (action === "setOptions" && target.type !== "select") return false;
  return true;
}

export const pageSkill: Skill<PageModel> & CrossSkill<PageModel> = {
  id: "page",
  title: "页面设计器",

  crossRefs(model: PageModel): CrossRefEdge[] {
    const refs: CrossRefEdge[] = [
      {
        fromNode: pageNodeId(model.id),
        toSkill: "datamodel",
        toKind: "entity",
        toValue: model.entity,
        label: "数据实体",
      },
    ];

    model.components.forEach(component => {
      if (component.field) {
        refs.push({
          fromNode: componentNodeId(component.id),
          toSkill: "datamodel",
          toKind: "field",
          toValue: component.field,
          label: "字段",
        });
      }
      if (component.bindingSchema && component.bindingSchema.field !== component.field) {
        refs.push({
          fromNode: componentNodeId(component.id),
          toSkill: "datamodel",
          toKind: "field",
          toValue: component.bindingSchema.field,
          label: "BindingSchema",
        });
      }
      component.visibleToRoles?.forEach(role => {
        refs.push({
          fromNode: componentNodeId(component.id),
          toSkill: "rbac",
          toKind: "role",
          toValue: role,
          label: "可见角色",
        });
      });
      component.permissionRender?.roleRefs
        .filter(role => !component.visibleToRoles?.includes(role))
        .forEach(role => {
          refs.push({
            fromNode: componentNodeId(component.id),
            toSkill: "rbac",
            toKind: "role",
            toValue: role,
            label: "PDP role",
          });
        });
      component.permissionRender?.permissionRefs?.forEach(permission => {
        refs.push({
          fromNode: componentNodeId(component.id),
          toSkill: "rbac",
          toKind: "permission",
          toValue: permission,
          label: "PDP permission",
        });
      });
    });

    return refs;
  },

  refNodeId(kind: string, value: string): string | null {
    if (kind === "page") return pageNodeId(value);
    if (kind === "component") return componentNodeId(value);
    return null;
  },

  validate(model: PageModel, ctx?: ValidateContext): ReturnType<Skill<PageModel>["validate"]> {
    const f: Finding[] = [];
    const byComponent = componentById(model);
    const datamodelEntities = ctx?.external?.datamodel?.entity;
    const datamodelFields = ctx?.external?.datamodel?.field;
    const rbacRoles = ctx?.external?.rbac?.role;
    const rbacPermissions = ctx?.external?.rbac?.permission;
    const isV2Mode = Boolean(
      model.traceSpan ||
      model.componentVersion ||
      model.components.some(c => c.bindingSchema || c.permissionRender || c.componentVersion),
    );

    for (const dup of findDuplicates(model.components.map(c => c.id))) {
      f.push({
        code: "PAGE_DUP_COMPONENT_ID",
        severity: "error",
        path: `components.${dup}`,
        message: `Duplicate page component id: ${dup}`,
      });
    }

    if (datamodelEntities === undefined) {
      f.push({
        code: "PAGE_ENTITY_UNRESOLVED",
        severity: "warning",
        path: "entity",
        message: `Page "${model.name}" points at DataModel entity "${model.entity}", but no DataModel surface was provided.`,
      });
    } else if (!datamodelEntities.includes(model.entity)) {
      f.push({
        code: "PAGE_REF_MISSING_ENTITY",
        severity: "error",
        path: "entity",
        message: `Page "${model.name}" binds missing DataModel entity: ${model.entity}`,
      });
    }

    model.components.forEach((component, componentIndex) => {
      if (component.field) {
        if (datamodelFields === undefined) {
          f.push({
            code: "PAGE_FIELD_UNRESOLVED",
            severity: "warning",
            path: `components[${componentIndex}].field`,
            message: `Component "${component.label}" binds field "${component.field}", but no DataModel field surface was provided.`,
          });
        } else if (!datamodelFields.includes(component.field)) {
          f.push({
            code: "PAGE_REF_MISSING_FIELD",
            severity: "error",
            path: `components[${componentIndex}].field`,
            message: `Component "${component.label}" binds missing DataModel field: ${component.field}`,
          });
        }
      }

      component.visibleToRoles?.forEach((role, roleIndex) => {
        if (rbacRoles === undefined) {
          f.push({
            code: "PAGE_ROLE_UNRESOLVED",
            severity: "warning",
            path: `components[${componentIndex}].visibleToRoles[${roleIndex}]`,
            message: `Component "${component.label}" is visible to role "${role}", but no RBAC role surface was provided.`,
          });
        } else if (!rbacRoles.includes(role)) {
          f.push({
            code: "PAGE_REF_MISSING_ROLE",
            severity: "error",
            path: `components[${componentIndex}].visibleToRoles[${roleIndex}]`,
            message: `Component "${component.label}" references missing RBAC role: ${role}`,
          });
        }
      });

      if (component.bindingSchema) {
        if (datamodelEntities === undefined || datamodelFields === undefined) {
          f.push({
            code: "PAGE_BINDING_UNRESOLVED",
            severity: "warning",
            path: `components[${componentIndex}].bindingSchema`,
            message: `Component "${component.label}" has a BindingSchema, but no DataModel SSOT surface was provided.`,
          });
        } else {
          if (!datamodelEntities.includes(component.bindingSchema.entity)) {
            f.push({
              code: "PAGE_BINDING_ENTITY_MISSING",
              severity: "error",
              path: `components[${componentIndex}].bindingSchema.entity`,
              message: `Component "${component.label}" binds missing DataModel entity: ${component.bindingSchema.entity}`,
            });
          }
          if (!datamodelFields.includes(component.bindingSchema.field)) {
            f.push({
              code: "PAGE_BINDING_FIELD_MISSING",
              severity: "error",
              path: `components[${componentIndex}].bindingSchema.field`,
              message: `Component "${component.label}" binds missing DataModel SSOT field: ${component.bindingSchema.field}`,
            });
          }
        }
      }

      if (isV2Mode && component.visibleToRoles?.length && !component.permissionRender) {
        f.push({
          code: "PAGE_PEP_BYPASS",
          severity: "error",
          path: `components[${componentIndex}].visibleToRoles`,
          message: `Component "${component.label}" uses local-only role visibility in V2 mode instead of delegating to RBAC PDP.`,
        });
      }

      component.permissionRender?.roleRefs.forEach((role, roleIndex) => {
        if (rbacRoles === undefined) {
          f.push({
            code: "PAGE_PERMISSION_REF_UNRESOLVED",
            severity: "warning",
            path: `components[${componentIndex}].permissionRender.roleRefs[${roleIndex}]`,
            message: `Component "${component.label}" delegates role "${role}" to RBAC PDP, but no RBAC role surface was provided.`,
          });
        } else if (!rbacRoles.includes(role)) {
          f.push({
            code: "PAGE_PERMISSION_REF_MISSING",
            severity: "error",
            path: `components[${componentIndex}].permissionRender.roleRefs[${roleIndex}]`,
            message: `Component "${component.label}" delegates missing RBAC PDP role: ${role}`,
          });
        }
      });

      component.permissionRender?.permissionRefs?.forEach((permission, permissionIndex) => {
        if (rbacPermissions === undefined) {
          f.push({
            code: "PAGE_PERMISSION_REF_UNRESOLVED",
            severity: "warning",
            path: `components[${componentIndex}].permissionRender.permissionRefs[${permissionIndex}]`,
            message: `Component "${component.label}" delegates permission "${permission}" to RBAC PDP, but no RBAC permission surface was provided.`,
          });
        } else if (!rbacPermissions.includes(permission)) {
          f.push({
            code: "PAGE_PERMISSION_REF_MISSING",
            severity: "error",
            path: `components[${componentIndex}].permissionRender.permissionRefs[${permissionIndex}]`,
            message: `Component "${component.label}" delegates missing RBAC PDP permission: ${permission}`,
          });
        }
      });
    });

    model.linkageRules.forEach((rule, ruleIndex) => {
      const source = byComponent.get(rule.source.component);
      const target = byComponent.get(rule.target.component);

      if (!source) {
        f.push({
          code: "PAGE_LINKAGE_MISSING_SOURCE",
          severity: "error",
          path: `linkageRules[${ruleIndex}].source.component`,
          message: `Linkage rule "${rule.id}" points at missing source component: ${rule.source.component}`,
        });
      }
      if (!target) {
        f.push({
          code: "PAGE_LINKAGE_MISSING_TARGET",
          severity: "error",
          path: `linkageRules[${ruleIndex}].target.component`,
          message: `Linkage rule "${rule.id}" points at missing target component: ${rule.target.component}`,
        });
      }
      if (!isLinkageCompatible(source, rule.source.event, target, rule.target.action)) {
        f.push({
          code: "PAGE_LINKAGE_ACTION_INCOMPATIBLE",
          severity: "error",
          path: `linkageRules[${ruleIndex}]`,
          message: `Linkage rule "${rule.id}" is incompatible: ${rule.source.event} from ${source?.type ?? "missing"} -> ${rule.target.action} on ${target?.type ?? "missing"}.`,
        });
      }
    });

    return finalizeReport(f);
  },

  project(model: PageModel): Projection {
    const nodes: Projection["nodes"] = [
      { id: pageNodeId(model.id), label: model.name, kind: "page" },
      ...model.components.map(component => ({
        id: componentNodeId(component.id),
        label: component.label,
        kind: component.type,
      })),
    ];
    const edges: Projection["edges"] = [
      ...model.components.map(component => ({
        from: pageNodeId(model.id),
        to: componentNodeId(component.id),
        label: "contains",
        kind: "contains",
      })),
      ...model.linkageRules.map(rule => ({
        from: componentNodeId(rule.source.component),
        to: componentNodeId(rule.target.component),
        label: rule.target.action,
        kind: "linkage",
      })),
      ...model.components.flatMap(component => {
        const pepEdges: Projection["edges"] = [];
        if (component.bindingSchema) {
          pepEdges.push({
            from: componentNodeId(component.id),
            to: dataModelFieldNodeId(component.bindingSchema.field),
            label: "BindingSchema",
            kind: "binding",
          });
        }
        component.permissionRender?.roleRefs.forEach(role => {
          pepEdges.push({
            from: componentNodeId(component.id),
            to: rbacRoleNodeId(role),
            label: "PDP role",
            kind: "permission",
          });
        });
        component.permissionRender?.permissionRefs?.forEach(permission => {
          pepEdges.push({
            from: componentNodeId(component.id),
            to: rbacPermissionNodeId(permission),
            label: "PDP permission",
            kind: "permission",
          });
        });
        return pepEdges;
      }),
    ];

    const lines: string[] = ["flowchart LR"];
    for (const n of nodes) lines.push(`  ${n.id}["${n.label}"]`);
    for (const e of edges) lines.push(`  ${e.from} -->|${e.label ?? ""}| ${e.to}`);
    return { nodes, edges, mermaid: lines.join("\n") };
  },

  resolve(model: PageModel): ResolvableSurface {
    return {
      page: [model.id],
      component: model.components.map(c => c.id),
      entity: [model.entity],
      field: [
        ...new Set(model.components.flatMap(c => {
          const field = c.bindingSchema?.field ?? c.field;
          return field ? [field] : [];
        })),
      ],
    };
  },

  async generate(intent: string): Promise<PageModel> {
    if (/purchase|procurement|采购/i.test(intent)) return purchaseApprovalPage;
    if (/请假|leave|审批/i.test(intent)) return leaveApprovalPage;
    throw new Error(`pageSkill.generate: needs the reasoning engine to generate a page model for intent: "${intent}"`);
  },
};

export const leaveApprovalPage: PageModel = {
  id: "page_leave_request",
  name: "请假申请页",
  entity: "leave_request",
  components: [
    { id: "applicant", type: "select", label: "申请人", field: "leave_request.applicant", visibleToRoles: ["employee", "manager"] },
    { id: "leaveType", type: "select", label: "请假类型", field: "leave_request.leaveType", visibleToRoles: ["employee", "manager"] },
    { id: "days", type: "number", label: "天数", field: "leave_request.days", visibleToRoles: ["employee", "manager"] },
    { id: "reason", type: "input", label: "事由", field: "leave_request.reason", visibleToRoles: ["employee", "manager"] },
    { id: "submit", type: "button", label: "提交请假", visibleToRoles: ["employee"] },
    { id: "approve", type: "button", label: "审批通过", field: "leave_request.approved", visibleToRoles: ["manager"] },
  ],
  linkageRules: [
    {
      id: "lk_type_days",
      source: { component: "leaveType", event: "onChange" },
      target: { component: "days", action: "setVisible" },
    },
    {
      id: "lk_approve_reason",
      source: { component: "approve", event: "onClick" },
      target: { component: "reason", action: "setDisabled" },
    },
  ],
};

leaveApprovalPage.traceSpan = "page.leave.request.v2";
leaveApprovalPage.componentVersion = "1.0.0";
for (const component of leaveApprovalPage.components) {
  if (component.field) {
    component.bindingSchema = { entity: leaveApprovalPage.entity, field: component.field };
  }
  if (component.visibleToRoles?.length) {
    component.permissionRender = { roleRefs: [...component.visibleToRoles] };
  }
  if (component.id === "submit") {
    component.permissionRender = { roleRefs: ["employee"], permissionRefs: ["leave:create"] };
  }
  if (component.id === "approve") {
    component.permissionRender = { roleRefs: ["manager"], permissionRefs: ["leave:approve"] };
  }
  component.componentVersion = "1.0.0";
}

export const purchaseApprovalPage: PageModel = {
  id: "page_purchase_request",
  name: "Purchase Request Page",
  entity: "purchase_request",
  components: [
    { id: "requester", type: "select", label: "Requester", field: "purchase_request.requester", visibleToRoles: ["requester", "department_manager", "finance", "procurement"] },
    { id: "department", type: "select", label: "Department", field: "purchase_request.department", visibleToRoles: ["requester", "department_manager", "finance", "procurement"] },
    { id: "vendor", type: "select", label: "Vendor", field: "purchase_request.vendor", visibleToRoles: ["requester", "department_manager", "finance", "procurement"] },
    { id: "amount", type: "number", label: "Amount", field: "purchase_request.amount", visibleToRoles: ["requester", "department_manager", "finance"] },
    { id: "status", type: "select", label: "Approval Status", field: "purchase_request.status", visibleToRoles: ["requester", "department_manager", "finance", "procurement"] },
    { id: "budgetCheck", type: "switch", label: "Budget Check", field: "purchase_request.budgetChecked", visibleToRoles: ["department_manager", "finance"] },
    { id: "submit", type: "button", label: "Submit Purchase", visibleToRoles: ["requester"] },
    { id: "managerApprove", type: "button", label: "Manager Approve", field: "purchase_request.managerApproved", visibleToRoles: ["department_manager"] },
    { id: "financeApprove", type: "button", label: "Finance Approve", field: "purchase_request.financeApproved", visibleToRoles: ["finance"] },
    { id: "procurementFulfill", type: "button", label: "Procurement Fulfill", field: "purchase_request.procurementFulfilled", visibleToRoles: ["procurement"] },
  ],
  linkageRules: [
    {
      id: "lk_amount_budget",
      source: { component: "amount", event: "onChange" },
      target: { component: "budgetCheck", action: "setVisible" },
    },
    {
      id: "lk_finance_status",
      source: { component: "financeApprove", event: "onClick" },
      target: { component: "status", action: "setValue" },
    },
  ],
};

purchaseApprovalPage.traceSpan = "page.purchase.request.v2";
purchaseApprovalPage.componentVersion = "1.0.0";
for (const component of purchaseApprovalPage.components) {
  if (component.field) {
    component.bindingSchema = { entity: purchaseApprovalPage.entity, field: component.field };
  }
  if (component.visibleToRoles?.length) {
    component.permissionRender = { roleRefs: [...component.visibleToRoles] };
  }
  if (component.id === "submit") {
    component.permissionRender = { roleRefs: ["requester"], permissionRefs: ["purchase:create"] };
  }
  if (component.id === "managerApprove") {
    component.permissionRender = { roleRefs: ["department_manager"], permissionRefs: ["purchase:manager_approve"] };
  }
  if (component.id === "financeApprove") {
    component.permissionRender = { roleRefs: ["finance"], permissionRefs: ["purchase:finance_approve"] };
  }
  if (component.id === "procurementFulfill") {
    component.permissionRender = { roleRefs: ["procurement"], permissionRefs: ["purchase:fulfill"] };
  }
  component.componentVersion = "1.0.0";
}
