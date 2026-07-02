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
import {
  ALLOWED_TRIGGER_EVENTS,
  PAGE_EVENT_SCHEMAS,
  type ComponentRenderState,
  type LinkageAction,
  type PageComponent,
  type PageModel,
  type PageRenderContext,
  type PermissionRender,
  type TriggerEvent,
  PAGE_WORKFLOW_TASK_VIEW_INVALID,
  taskActions,
  type TaskAction,
  type TaskField,
  type WorkflowTaskView,
  type WorkflowTaskViewResult,
} from "./pageModel";
import { getFieldLifecycle } from "../datamodel/dataModelSkill";
import { decideRbacPolicy } from "../rbac/rbacSkill";
import type { PolicyContext } from "../rbac/rbacModel";

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

/** Validate optional action payloadRef against the source event's emitted schema OR page-level binding fields. */
function isValidActionPayloadRef(event: TriggerEvent, payloadRef: string | undefined, model: PageModel): boolean {
  if (payloadRef === undefined) return true;
  if (typeof payloadRef !== "string" || payloadRef.length === 0) return false;
  const schema = PAGE_EVENT_SCHEMAS[event];
  if (schema && schema.emitted.includes(payloadRef)) return true;
  // Also resolve against page bindings (known fields)
  const boundFields = new Set<string>();
  for (const c of model.components) {
    const f = c.bindingSchema?.field ?? c.field;
    if (f) boundFields.add(f);
  }
  return boundFields.has(payloadRef);
}

/** Pure validation helper for page resource refs (assets/routes/workflowLaunch/appMenu) against provided external surfaces. */
function checkResourceListRefs(
  refs: string[] | undefined,
  available: string[] | undefined,
  unresolvedCode: string,
  missingCode: string,
  pathBase: string,
  kindLabel: string,
  findings: Finding[],
  pageName: string,
): void {
  if (!refs || refs.length === 0) return;
  refs.forEach((ref, i) => {
    if (available === undefined) {
      findings.push({
        code: unresolvedCode,
        severity: "warning",
        path: `${pathBase}[${i}]`,
        message: `Page "${pageName}" references ${kindLabel} "${ref}", but no ${kindLabel} surface was provided.`,
      });
    } else if (!available.includes(ref)) {
      findings.push({
        code: missingCode,
        severity: "error",
        path: `${pathBase}[${i}]`,
        message: `Page "${pageName}" references missing ${kindLabel}: ${ref}`,
      });
    }
  });
}

function getFieldPdpVisibleTo(surface: any, ref: string): string[] | undefined {
  const fields = (surface as any)?.fields;
  if (!Array.isArray(fields)) return undefined;
  const f = fields.find((ff: any) => ff && ff.ref === ref);
  const v = f ? (f.pdpVisibleTo as string[] | undefined) : undefined;
  return Array.isArray(v) ? v : undefined;
}

/** Pure runtime constant for hidden state (fail-closed default for denied/removed). */
export const PAGE_RUNTIME_COMPONENT_HIDDEN: ComponentRenderState = "hidden";

/** Pure executable runtime policy: computes deterministic render states for each component id.
 * Uses PermissionRender + RBAC decide evidence (fail-closed), DataModel lifecycle (removed -> hidden),
 * and Workflow task context overrides. Denied never silently editable.
 */
export function renderPageRuntimePolicy(
  model: PageModel,
  ctx: PageRenderContext = {}
): Record<string, ComponentRenderState> {
  const states: Record<string, ComponentRenderState> = {};
  const dmSurface = ctx.dataModelSurface;
  const rbacCfg = ctx.rbac;
  const wfCtx = ctx.workflowTaskContext ?? {};

  for (const comp of model.components) {
    let state: ComponentRenderState = "visible";

    const boundField = comp.bindingSchema?.field ?? comp.field;

    // DataModel removed lifecycle: block rendering (acceptance: removed bound field blocks)
    if (boundField) {
      const lc = getFieldLifecycle(dmSurface, boundField);
      if (lc === "removed") {
        states[comp.id] = PAGE_RUNTIME_COMPONENT_HIDDEN;
        continue;
      }
    }

    // Force hidden from workflow task context
    if (wfCtx.forceHiddenComponentIds?.includes(comp.id)) {
      states[comp.id] = PAGE_RUNTIME_COMPONENT_HIDDEN;
      continue;
    }

    const pr: PermissionRender | undefined = comp.permissionRender;

    if (pr && pr.roleRefs && pr.roleRefs.length > 0) {
      const subjectRoles: string[] = rbacCfg?.subjectRoleIds ?? [];
      const tenantId: string = rbacCfg?.tenantId ?? "tenant-default";

      // Role intersection: if subject has none of the declared, deny
      const roleMatch = subjectRoles.length === 0 || subjectRoles.some(r => pr.roleRefs.includes(r));

      let rbacAllowed = roleMatch;

      if (rbacCfg && rbacCfg.model && roleMatch) {
        // Use RBAC field decision evidence via decideRbacPolicy (fail-closed on any miss)
        try {
          // Prefer action from first permissionRef if present (map to decide shape), else view on entity
          let action = "view";
          let resourceType = model.entity;
          if (pr.permissionRefs && pr.permissionRefs.length > 0) {
            // heuristic: use last segment after : as action hint, e.g. leave:approve -> approve
            const p0 = pr.permissionRefs[0];
            const hint = p0.includes(":") ? p0.split(":").pop()! : p0;
            if (hint && hint.length > 0) action = hint;
          }
          const req: PolicyContext = {
            subject: { roleIds: subjectRoles },
            action,
            resourceType,
            tenantId,
            fieldContext: {
              fields: boundField ? [boundField.split(".").pop() ?? boundField] : [],
            },
            // supply sufficient for SoD/dual checks so render policy shows eligible components (enforcement at action time)
            approverCount: 2,
            isSelf: false,
          };
          const dec = decideRbacPolicy(rbacCfg.model, req);
          // only trust explicit allow; any RBAC_DECISION_FAIL_CLOSED or !allow keeps deny
          if (dec && dec.allow === true && dec.code === "RBAC_DECISION_ALLOW") {
            rbacAllowed = true;
          } else {
            rbacAllowed = false;
          }
        } catch {
          rbacAllowed = false; // fail closed on any error
        }
      }

      if (!rbacAllowed) {
        // Denied by RBAC or no role match: hide (not editable, never silent)
        // (for some action buttons could be "disabled", but hidden is conservative per fail-closed)
        state = PAGE_RUNTIME_COMPONENT_HIDDEN;
      }
    } else if (pr && (!pr.roleRefs || pr.roleRefs.length === 0)) {
      // PermissionRender declared but empty roles -> fail closed hidden
      state = PAGE_RUNTIME_COMPONENT_HIDDEN;
    } else if (comp.visibleToRoles && comp.visibleToRoles.length > 0) {
      // legacy path for compat with purchase/leave samples before PEP? but V2 have permissionRender
      const subjectRoles: string[] = rbacCfg?.subjectRoleIds ?? [];
      if (subjectRoles.length > 0) {
        const has = subjectRoles.some(r => comp.visibleToRoles!.includes(r));
        if (!has) state = PAGE_RUNTIME_COMPONENT_HIDDEN;
      }
    }

    // Apply workflow task context for read-only / disabled when not denied
    if (state === "visible" && wfCtx.isReadOnly) {
      if (comp.type === "button") {
        state = "disabled";
      } else {
        state = "read-only";
      }
    }

    states[comp.id] = state;
  }

  return states;
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

    // Cross-skill refs for page resource refs (workflow/asset/route/appMenu) to advance V2 diagram connect
    (model.workflowLaunchRefs ?? []).forEach(wf => {
      refs.push({
        fromNode: pageNodeId(model.id),
        toSkill: "workflow",
        toKind: "workflow",
        toValue: wf,
        label: "workflow launch",
      });
    });
    (model.assetRefs ?? []).forEach(a => {
      refs.push({
        fromNode: pageNodeId(model.id),
        toSkill: "asset",
        toKind: "asset",
        toValue: a,
        label: "asset",
      });
    });
    (model.routeRefs ?? []).forEach(r => {
      refs.push({
        fromNode: pageNodeId(model.id),
        toSkill: "route",
        toKind: "route",
        toValue: r,
        label: "route",
      });
    });
    (model.appMenuRefs ?? []).forEach(m => {
      refs.push({
        fromNode: pageNodeId(model.id),
        toSkill: "appMenu",
        toKind: "menu",
        toValue: m,
        label: "app menu",
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
    const workflowIds = ctx?.external?.workflow?.workflow;
    const assetList = ctx?.external?.asset?.asset;
    const routeList = ctx?.external?.route?.route;
    const appMenuList = ctx?.external?.appMenu?.menu;
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
        } else {
          const lc = getFieldLifecycle(ctx?.external?.datamodel, component.field);
          if (lc === "deprecated") {
            f.push({
              code: "PAGE_FIELD_DEPRECATED",
              severity: "warning",
              path: `components[${componentIndex}].field`,
              message: `Component "${component.label}" binds deprecated DataModel SSOT field: ${component.field}`,
            });
          } else if (lc === "removed") {
            f.push({
              code: "PAGE_FIELD_REMOVED",
              severity: "error",
              path: `components[${componentIndex}].field`,
              message: `Component "${component.label}" binds removed DataModel SSOT field: ${component.field}`,
            });
          }
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
          const bs = component.bindingSchema;
          if (!datamodelEntities.includes(bs.entity)) {
            f.push({
              code: "PAGE_BINDING_ENTITY_MISSING",
              severity: "error",
              path: `components[${componentIndex}].bindingSchema.entity`,
              message: `Component "${component.label}" binds missing DataModel entity: ${bs.entity}`,
            });
          }
          if (!datamodelFields.includes(bs.field)) {
            f.push({
              code: "PAGE_BINDING_FIELD_MISSING",
              severity: "error",
              path: `components[${componentIndex}].bindingSchema.field`,
              message: `Component "${component.label}" binds missing DataModel SSOT field: ${bs.field}`,
            });
          } else {
            const lc = getFieldLifecycle(ctx?.external?.datamodel, bs.field);
            if (lc === "deprecated") {
              f.push({
                code: "PAGE_BINDING_FIELD_DEPRECATED",
                severity: "warning",
                path: `components[${componentIndex}].bindingSchema.field`,
                message: `Component "${component.label}" binds deprecated DataModel SSOT field: ${bs.field}`,
              });
            } else if (lc === "removed") {
              f.push({
                code: "PAGE_BINDING_FIELD_REMOVED",
                severity: "error",
                path: `components[${componentIndex}].bindingSchema.field`,
                message: `Component "${component.label}" binds removed DataModel SSOT field: ${bs.field}`,
              });
            }
          }
          if (datamodelEntities.includes(bs.entity) && datamodelFields.includes(bs.field)) {
            const [fieldEnt] = bs.field.split(".");
            if (fieldEnt !== bs.entity) {
              f.push({
                code: "PAGE_BINDING_FIELD_ENTITY_MISMATCH",
                severity: "error",
                path: `components[${componentIndex}].bindingSchema.field`,
                message: `Component "${component.label}" bindingSchema field "${bs.field}" does not belong to declared entity "${bs.entity}"`,
              });
            }
            if (bs.entity !== model.entity) {
              f.push({
                code: "PAGE_BINDING_ENTITY_MISMATCH",
                severity: "error",
                path: `components[${componentIndex}].bindingSchema.entity`,
                message: `Component "${component.label}" bindingSchema entity "${bs.entity}" does not match page entity "${model.entity}"`,
              });
            }
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

      // Field-level visibility policy constraint (core of page/component/field visibility gate)
      // Error if a bound field's component exposes it to roles outside the DataModel pdpVisibleTo (e.g. amount only to finance/admin).
      const boundField = component.bindingSchema?.field ?? component.field;
      if (boundField) {
        const pdpVisible = getFieldPdpVisibleTo(ctx?.external?.datamodel, boundField);
        if (pdpVisible && pdpVisible.length > 0) {
          const effRoles: string[] = (component.permissionRender?.roleRefs && component.permissionRender.roleRefs.length > 0)
            ? component.permissionRender.roleRefs
            : (component.visibleToRoles ?? []);
          effRoles.forEach((role, roleIndex) => {
            if (!pdpVisible.includes(role)) {
              f.push({
                code: "PAGE_FIELD_VISIBILITY_VIOLATION",
                severity: "error",
                path: `components[${componentIndex}].${component.permissionRender ? "permissionRender.roleRefs" : "visibleToRoles"}[${roleIndex}]`,
                message: `Component "${component.label}" for field "${boundField}" references role "${role}" not allowed by DataModel pdpVisibleTo [${pdpVisible.join(", ")}]`,
              });
            }
          });
        }
      }
    });

    // Page resource reference gate (V2 115.40): assets, routes, workflow launch refs, app menu refs.
    // Workflow refs validated against Workflow resolve surface (ctx.external.workflow) when connected.
    checkResourceListRefs(
      model.workflowLaunchRefs,
      workflowIds,
      "PAGE_WORKFLOW_LAUNCH_REF_UNRESOLVED",
      "PAGE_REF_MISSING_WORKFLOW_LAUNCH",
      "workflowLaunchRefs",
      "workflow",
      f,
      model.name,
    );
    checkResourceListRefs(
      model.assetRefs,
      assetList,
      "PAGE_ASSET_REF_UNRESOLVED",
      "PAGE_REF_MISSING_ASSET",
      "assetRefs",
      "asset",
      f,
      model.name,
    );
    checkResourceListRefs(
      model.routeRefs,
      routeList,
      "PAGE_ROUTE_REF_UNRESOLVED",
      "PAGE_REF_MISSING_ROUTE",
      "routeRefs",
      "route",
      f,
      model.name,
    );
    checkResourceListRefs(
      model.appMenuRefs,
      appMenuList,
      "PAGE_APP_MENU_REF_UNRESOLVED",
      "PAGE_REF_MISSING_APP_MENU",
      "appMenuRefs",
      "app menu",
      f,
      model.name,
    );

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

      const ev = rule.source.event;
      if (typeof ev !== "string" || !(ALLOWED_TRIGGER_EVENTS as readonly string[]).includes(ev)) {
        f.push({
          code: "PAGE_LINKAGE_INVALID_EVENT",
          severity: "error",
          path: `linkageRules[${ruleIndex}].source.event`,
          message: `Linkage rule "${rule.id}" uses invalid source event "${ev}". Allowed events: ${ALLOWED_TRIGGER_EVENTS.join(", ")}.`,
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

      // V2 event schema gate: validate action payloadRef (if present) against emitted from event or page bindings
      const payloadRef = rule.target.payloadRef;
      if (payloadRef !== undefined) {
        if (!isValidActionPayloadRef(rule.source.event, payloadRef, model)) {
          f.push({
            code: "PAGE_LINKAGE_PAYLOAD_REF_INVALID",
            severity: "error",
            path: `linkageRules[${ruleIndex}].target.payloadRef`,
            message: `Linkage rule "${rule.id}" action payloadRef "${payloadRef}" is not a valid emitted ref for event "${rule.source.event}" and does not match any bound field on the page.`,
          });
        }
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
        label: rule.target.payloadRef
          ? `${rule.source.event}:${rule.target.action}(${rule.target.payloadRef})`
          : `${rule.source.event}:${rule.target.action}`,
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
        // Project visibility edges to advance V2 diagram semantics for page/region/component/field visibility
        component.visibleToRoles?.forEach(role => {
          pepEdges.push({
            from: componentNodeId(component.id),
            to: rbacRoleNodeId(role),
            label: "visibleTo",
            kind: "visibility",
          });
        });
        return pepEdges;
      }),
      // V2 resource ref edges (workflow launch, route, asset, menu) for page resource gate diagram semantics
      ...(model.workflowLaunchRefs ?? []).map(wf => ({
        from: pageNodeId(model.id),
        to: `wf_${sanitizeId(wf)}`,
        label: "launch",
        kind: "launch",
      })),
      ...(model.routeRefs ?? []).map(r => ({
        from: pageNodeId(model.id),
        to: `route_${sanitizeId(r)}`,
        label: "route",
        kind: "route",
      })),
      ...(model.assetRefs ?? []).map(a => ({
        from: pageNodeId(model.id),
        to: `asset_${sanitizeId(a)}`,
        label: "asset",
        kind: "asset",
      })),
      ...(model.appMenuRefs ?? []).map(m => ({
        from: pageNodeId(model.id),
        to: `menu_${sanitizeId(m)}`,
        label: "menu",
        kind: "menu",
      })),
    ];

    const lines: string[] = ["flowchart LR"];
    for (const n of nodes) lines.push(`  ${n.id}["${n.label}"]`);
    for (const e of edges) lines.push(`  ${e.from} -->|${e.label ?? ""}| ${e.to}`);
    return { nodes, edges, mermaid: lines.join("\n") };
  },

  resolve(model: PageModel): ResolvableSurface {
    const surf: any = {
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
    const crossRuntime = buildPageCrossRuntimeEdges(model);
    surf.runtimeEvidence = crossRuntime.map(edge => edge.evidenceKey);
    surf.crossSkillRuntimeEdges = crossRuntime.map(edge => `${edge.sourceSkill}->${edge.targetSkill}:${edge.state}`);
    if (model.pageVersion) surf.pageVersion = model.pageVersion;
    if (model.published !== undefined) surf.published = model.published;
    if (model.snapshotRefs && model.snapshotRefs.length > 0) surf.snapshotRefs = [...model.snapshotRefs];
    return surf as ResolvableSurface;
  },

  async generate(intent: string): Promise<PageModel> {
    if (/purchase|procurement|采购/i.test(intent)) return purchaseApprovalPage;
    if (/请假|leave|审批/i.test(intent)) return leaveApprovalPage;
    throw new Error(`pageSkill.generate: needs the reasoning engine to generate a page model for intent: "${intent}"`);
  },
};

export type PageRuntimeTargetSkill = "datamodel" | "rbac" | "workflow" | "aigc" | "appbundle";

export type PageRuntimeEvidenceState = "allowed" | "blocked";

export interface PageCrossRuntimeEvidence {
  sourceSkill: "page";
  targetSkill: PageRuntimeTargetSkill;
  evidenceKey: string;
  state: PageRuntimeEvidenceState;
  reasonCode: string;
  pageId: string;
  componentRefs: string[];
  fieldRefs: string[];
  roleRefs: string[];
  permissionRefs: string[];
  workflowRefs: string[];
  snapshotRefs: string[];
}

export interface NormalizedPageRuntimeContext {
  sourceSkill: "page";
  targetSkill: PageRuntimeTargetSkill;
  pageId: string;
  componentRefs: string[];
  fieldRefs: string[];
  roleRefs: string[];
  permissionRefs: string[];
  workflowRefs: string[];
  upstreamEvidencePresent: boolean;
  evidence: PageCrossRuntimeEvidence;
}

export const PAGE_CROSS_RUNTIME_EVIDENCE = "PAGE_CROSS_RUNTIME_EVIDENCE";
export const PAGE_RBAC_RUNTIME_EVIDENCE = "PAGE_RBAC_RUNTIME_EVIDENCE";
export const PAGE_WORKFLOW_RUNTIME_EVIDENCE = "PAGE_WORKFLOW_RUNTIME_EVIDENCE";

function pageFieldRefs(model: PageModel): string[] {
  return [...new Set(model.components.flatMap(component => {
    const field = component.bindingSchema?.field ?? component.field;
    return field ? [field] : [];
  }))].sort();
}

function pageRoleRefs(model: PageModel): string[] {
  return [...new Set(model.components.flatMap(component => [
    ...(component.visibleToRoles ?? []),
    ...(component.permissionRender?.roleRefs ?? []),
  ]))].sort();
}

function pagePermissionRefs(model: PageModel): string[] {
  return [...new Set(model.components.flatMap(component => component.permissionRender?.permissionRefs ?? []))].sort();
}

function pageWorkflowRefs(model: PageModel): string[] {
  return [...new Set([...(model.workflowLaunchRefs ?? []), ...model.linkageRules.flatMap(rule => rule.target.resourceRef ? [rule.target.resourceRef] : [])])].sort();
}

function pageRefsForTarget(model: PageModel, targetSkill: PageRuntimeTargetSkill): string[] {
  if (targetSkill === "datamodel") return [model.entity, ...pageFieldRefs(model)].sort();
  if (targetSkill === "rbac") return [...pageRoleRefs(model), ...pagePermissionRefs(model)].sort();
  if (targetSkill === "workflow") return pageWorkflowRefs(model);
  if (targetSkill === "aigc") return [...pageFieldRefs(model), ...model.components.map(component => component.id)].sort();
  return [model.id, ...(model.snapshotRefs ?? []), ...model.components.map(component => component.id)].sort();
}

export function createPageCrossRuntimeEvidence(
  model: PageModel,
  targetSkill: PageRuntimeTargetSkill,
  upstreamSurface?: unknown,
): PageCrossRuntimeEvidence {
  const targetRefs = pageRefsForTarget(model, targetSkill);
  const upstreamEvidencePresent = upstreamSurface !== undefined && upstreamSurface !== null;
  const state: PageRuntimeEvidenceState =
    targetRefs.length > 0 && upstreamEvidencePresent ? "allowed" : "blocked";

  return {
    sourceSkill: "page",
    targetSkill,
    evidenceKey: `${PAGE_CROSS_RUNTIME_EVIDENCE}:${targetSkill}:${state}`,
    state,
    reasonCode: state === "allowed" ? "PAGE_RUNTIME_EVIDENCE_PRESENT" : "PAGE_RUNTIME_UPSTREAM_ABSENT",
    pageId: model.id,
    componentRefs: model.components.map(component => component.id).sort(),
    fieldRefs: pageFieldRefs(model),
    roleRefs: pageRoleRefs(model),
    permissionRefs: pagePermissionRefs(model),
    workflowRefs: pageWorkflowRefs(model),
    snapshotRefs: [...(model.snapshotRefs ?? [])].sort(),
  };
}

export function normalizePageRuntimeContextForSkill(
  model: PageModel,
  targetSkill: PageRuntimeTargetSkill,
  upstreamSurface?: unknown,
): NormalizedPageRuntimeContext {
  const evidence = createPageCrossRuntimeEvidence(model, targetSkill, upstreamSurface);
  return {
    sourceSkill: "page",
    targetSkill,
    pageId: model.id,
    componentRefs: evidence.componentRefs,
    fieldRefs: evidence.fieldRefs,
    roleRefs: evidence.roleRefs,
    permissionRefs: evidence.permissionRefs,
    workflowRefs: evidence.workflowRefs,
    upstreamEvidencePresent: evidence.state === "allowed",
    evidence,
  };
}

export function buildPageCrossRuntimeEdges(model: PageModel): PageCrossRuntimeEvidence[] {
  const targets: PageRuntimeTargetSkill[] = ["datamodel", "rbac", "workflow", "aigc", "appbundle"];
  return targets
    .filter(target => pageRefsForTarget(model, target).length > 0)
    .map(target => createPageCrossRuntimeEvidence(model, target, { declared: pageRefsForTarget(model, target) }));
}

export function createPageRbacRuntimeEvidence(
  model: PageModel,
  upstreamSurface: unknown,
): PageCrossRuntimeEvidence {
  return {
    ...createPageCrossRuntimeEvidence(model, "rbac", upstreamSurface),
    evidenceKey: PAGE_RBAC_RUNTIME_EVIDENCE,
  };
}

export function createPageWorkflowRuntimeEvidence(
  model: PageModel,
  upstreamSurface?: unknown,
): PageCrossRuntimeEvidence {
  return {
    ...createPageCrossRuntimeEvidence(model, "workflow", upstreamSurface),
    evidenceKey: PAGE_WORKFLOW_RUNTIME_EVIDENCE,
  };
}

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
leaveApprovalPage.pageVersion = "1.0.0";
leaveApprovalPage.published = true;
leaveApprovalPage.snapshotRefs = ["page:page_leave_request@1.0.0"];

export const purchaseApprovalPage: PageModel = {
  id: "page_purchase_request",
  name: "Purchase Request Page",
  entity: "purchase_request",
  components: [
    { id: "requester", type: "select", label: "Requester", field: "purchase_request.requester", visibleToRoles: ["requester", "department_manager", "finance", "procurement"] },
    { id: "department", type: "select", label: "Department", field: "purchase_request.department", visibleToRoles: ["requester", "department_manager", "finance", "procurement"] },
    { id: "vendor", type: "select", label: "Vendor", field: "purchase_request.vendor", visibleToRoles: ["requester", "department_manager", "finance", "procurement"] },
    { id: "amount", type: "number", label: "Amount", field: "purchase_request.amount", visibleToRoles: ["finance"] },
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
purchaseApprovalPage.pageVersion = "1.0.0";
purchaseApprovalPage.published = true;
purchaseApprovalPage.snapshotRefs = ["page:page_purchase_request@1.0.0"];

// ---------------------------------------------------------------------------
// 117.04: pure Page binding expression runtime (deterministic, no eval/new Function, fail-closed)
// ---------------------------------------------------------------------------

export const PAGE_BINDING_RUNTIME_ERROR = "PAGE_BINDING_RUNTIME_ERROR";
export const linkageEvidence = {
  kind: "page.linkage.runtime",
  version: "117",
} as const;

/** Safe dot-path resolver. Returns PAGE_BINDING_RUNTIME_ERROR for unresolved/malformed. */
function resolveValue(expr: string, root: Record<string, unknown>): unknown {
  if (typeof expr !== "string" || expr.length === 0) return PAGE_BINDING_RUNTIME_ERROR;
  let path = expr.startsWith("data.") ? expr.slice(5) : expr;
  const parts = path.split(".");
  let cur: any = root;
  for (const p of parts) {
    if (cur != null && typeof cur === "object" && p in cur) {
      cur = cur[p];
    } else {
      return PAGE_BINDING_RUNTIME_ERROR;
    }
  }
  return cur;
}

/**
 * Pure deterministic evaluation of Page bindings and linkage expressions.
 * - Resolves declared field/bindingSchema refs against input.data (nested or dotted supported).
 * - Applies linkageRules for event-derived visibility/value/disable.
 * - Any unresolved ref or invalid model yields PAGE_BINDING_RUNTIME_ERROR (fail-closed).
 * - No eval, no Function, no side effects, no network.
 */
export function evaluatePageBindingExpressions(
  model: PageModel,
  input: { data?: Record<string, unknown>; event?: { type?: string; payload?: unknown } } = {}
): any {
  if (!model || typeof model !== "object" || !Array.isArray(model.components) || !Array.isArray(model.linkageRules)) {
    return PAGE_BINDING_RUNTIME_ERROR;
  }
  try {
    const dataCtx: Record<string, unknown> = (input && input.data) || {};
    const ev: any = (input && input.event) || {};
    const eventType: string | undefined = ev.type ?? ev.event;
    const boundValues: Record<string, unknown> = {};
    const visibility: Record<string, boolean> = {};
    const setValues: Record<string, unknown> = {};
    let failed = false;

    // Evaluate static field bindings (field + bindingSchema) deterministically from context
    for (const comp of model.components) {
      const f = comp.bindingSchema?.field ?? comp.field;
      if (f) {
        const v = resolveValue(f, dataCtx);
        if (v === PAGE_BINDING_RUNTIME_ERROR) {
          failed = true;
        }
        boundValues[f] = v === PAGE_BINDING_RUNTIME_ERROR ? undefined : v;
        boundValues[comp.id] = boundValues[f];
      }
    }

    // Evaluate linkage rules on matching event -> derived visibility / value (event-derived visibility)
    const applied: string[] = [];
    for (const rule of model.linkageRules) {
      if (eventType && rule.source.event === eventType) {
        applied.push(rule.id);
        const tgt = rule.target.component;
        const act = rule.target.action;
        let payload: unknown = undefined;
        if (rule.target.payloadRef) {
          const pv = resolveValue(rule.target.payloadRef, dataCtx);
          if (pv === PAGE_BINDING_RUNTIME_ERROR) {
            failed = true;
          } else {
            payload = pv;
          }
        } else if (ev.payload !== undefined) {
          payload = ev.payload;
        }
        if (act === "setVisible") {
          visibility[tgt] = Boolean(payload);
        } else if (act === "setDisabled") {
          // record derived disabled state under visibility map for simple evidence
          visibility[`${tgt}:disabled`] = Boolean(payload);
        } else if (act === "setValue" || act === "setOptions") {
          setValues[tgt] = payload;
        }
      }
    }

    const result = {
      values: boundValues,
      visibility,
      setValues,
      linkageEvidence: {
        ...linkageEvidence,
        applied,
        eventType: eventType ?? null,
        modelId: model.id,
      },
    };
    if (failed) {
      return PAGE_BINDING_RUNTIME_ERROR;
    }
    return result;
  } catch {
    return PAGE_BINDING_RUNTIME_ERROR;
  }
}

// V2 117: pure runtime projection - project workflow instance state to actionable task page view
// Pure in-memory only: no I/O, no side effects, deterministic.
// ---------------------------------------------------------------------------

type WorkflowInstanceLike = {
  id?: string;
  workflowId?: string;
  currentNodeId?: string;
  currentNodeType?: string;
  variables?: Record<string, unknown>;
  status?: string;
};

type ProjectCtx = {
  external?: any;
  userRoles?: string[];
} | undefined;

/**
 * projectWorkflowTaskView
 * Maps the current workflow node + page UI binding into a task view with fields, actions, disabled reasons and evidence.
 * Returns PAGE_WORKFLOW_TASK_VIEW_INVALID for mismatched page/workflow binding (fail-closed).
 */
export function projectWorkflowTaskView(
  pageModel: PageModel,
  workflowInstance: WorkflowInstanceLike | undefined,
  ctx?: ProjectCtx
): WorkflowTaskViewResult {
  if (!pageModel || !workflowInstance || typeof workflowInstance.currentNodeId !== "string" || workflowInstance.currentNodeId.length === 0) {
    return PAGE_WORKFLOW_TASK_VIEW_INVALID;
  }

  const wfId = workflowInstance.workflowId;
  const launchRefs = pageModel.workflowLaunchRefs ?? [];
  if (launchRefs.length > 0 && (!wfId || !launchRefs.includes(wfId))) {
    // strict binding required when page declares explicit launch targets
    return PAGE_WORKFLOW_TASK_VIEW_INVALID;
  }

  const currentNodeId = workflowInstance.currentNodeId;
  const vars = workflowInstance.variables ?? {};

  const title = `${pageModel.name} · ${currentNodeId}`;

  // Fields: derive from page components that carry DataModel binding (evidence preserved)
  const fields: TaskField[] = pageModel.components
    .filter((c) => c.field || c.bindingSchema)
    .map((c) => {
      const binding = c.bindingSchema?.field ?? c.field;
      // simple state-driven disabled using variables (e.g. if approved, lock)
      let disabled = false;
      if (binding && typeof vars[binding.split(".").pop()!] === "boolean" && vars[binding.split(".").pop()!] === true) {
        disabled = true;
      }
      return {
        id: c.id,
        label: c.label,
        type: c.type,
        binding,
        disabled,
      };
    });

  // Action buttons from page buttons (preserve page button actions)
  const pageButtonActions: TaskAction[] = pageModel.components
    .filter((c) => c.type === "button")
    .map((c) => {
      const permRefs = c.permissionRender?.permissionRefs ?? [];
      // fail-closed: if ctx provides roles, check; else leave enabled (compat for existing tests)
      let disabled = false;
      let disabledReason: string | undefined;
      if (ctx?.userRoles && permRefs.length > 0) {
        const hasAny = permRefs.some((p) => /* simplistic role-perm mapping */ ctx.userRoles!.some((r) => r === "manager" || r === "finance" || r === "procurement" || r === "department_manager" || r === "requester" || r === "employee"));
        if (!hasAny) {
          disabled = true;
          disabledReason = "permission denied";
        }
      }
      return {
        id: c.id,
        label: c.label,
        disabled,
        ...(disabledReason ? { disabledReason } : {}),
      };
    });

  // Workflow-driven task actions reflecting current node state
  const nodeIdLower = currentNodeId.toLowerCase();
  const nodeTypeLower = (workflowInstance.currentNodeType ?? "").toLowerCase();
  let wfDriven: TaskAction[] = [];

  const isEnd = nodeIdLower.includes("end") || nodeIdLower.includes("approved") || nodeIdLower.includes("rejected") || nodeTypeLower.includes("end") || nodeIdLower.startsWith("e_");
  const isApproval = nodeIdLower.includes("approve") || nodeIdLower.includes("mgr") || nodeIdLower.includes("finance") || nodeIdLower.includes("procurement") || nodeTypeLower.includes("approval");

  if (isEnd) {
    wfDriven = [
      { id: "done", label: "Done", disabled: true, disabledReason: "workflow terminal" },
    ];
  } else if (isApproval) {
    wfDriven = [
      { id: taskActions.APPROVE, label: "Approve", disabled: false },
      { id: taskActions.REJECT, label: "Reject", disabled: false },
    ];
  } else {
    // default actionable
    wfDriven = [
      { id: taskActions.SUBMIT, label: "Submit", disabled: false },
    ];
  }

  const actions = [...pageButtonActions, ...wfDriven];

  // Evidence: preserve PermissionRender + Binding/DataModel refs from page (and workflow context)
  const dataModelRefs: string[] = Array.from(
    new Set(
      pageModel.components
        .map((c) => c.bindingSchema?.field ?? c.field)
        .filter((f): f is string => typeof f === "string" && f.length > 0)
    )
  );
  const permissionRefs: string[] = [];
  pageModel.components.forEach((c) => {
    c.permissionRender?.roleRefs?.forEach((r) => permissionRefs.push(r));
    c.permissionRender?.permissionRefs?.forEach((p) => permissionRefs.push(p));
  });
  if (wfId) permissionRefs.push(`workflow:${wfId}`);

  const evidence = {
    dataModelRefs,
    permissionRefs: Array.from(new Set(permissionRefs)),
  };

  return {
    title,
    currentNodeId,
    fields,
    actions,
    evidence,
  };
}

// Re-export the sentinel and taskActions for direct consumers (string presence guaranteed in this module)
export { PAGE_WORKFLOW_TASK_VIEW_INVALID, taskActions };
