/**
 * GitHub Pages 演示模板 — 由真实 LLM 全程推演一次性捕获（2026-07-14，
 * gpt-5.5 · /api/sliderule/drive-full-stream 完整事件流），非手写数据。
 *
 * 用途：Pages 静态演示没有后端，访客点「发送」后由
 * github-pages-demo-playback.ts 按本模板回放推演过程与发布闭环，
 * 展示与完整版一致的画面（六系统证据、可运行数字孪生、推演总结）。
 *
 * 重新捕获：本地起完整栈后
 *   curl -sN http://localhost:9700/api/sliderule/drive-full-stream \
 *     -H 'Content-Type: application/json' \
 *     -d '{"sessionId":"<sid>","userText":"<意图>"}' > stream.sse
 * 再用 scripts 里的解析逻辑重新生成本文件。
 */

export type GithubPagesDemoSkillCapture = {
  skill: string;
  label: string;
  mermaid: string;
  modelSection: Record<string, unknown>;
};

export type GithubPagesDemoTemplate = {
  goal: string;
  skills: GithubPagesDemoSkillCapture[];
  publishClosure: Record<string, unknown>;
  chatSummary: string;
};

export const GITHUB_PAGES_DEMO_TEMPLATE: GithubPagesDemoTemplate = {
  "goal": "做一个权限管理系统（支持 RBAC + 数据范围）",
  "skills": [
    {
      "skill": "dataModel",
      "label": "datamodel",
      "mermaid": "flowchart LR\n  datamodel[\"datamodel\"] -->|DM_RBAC_FIELD_POLICY_EVIDENCE| rbac[\"rbac\"]\n  datamodel[\"datamodel\"] -->|DM_PAGE_BINDING_IMPACT_EVIDENCE| page[\"page\"]",
      "modelSection": {
        "entities": [
          {
            "id": "user_account",
            "name": "用户账号",
            "fields": [
              {
                "id": "username",
                "name": "登录名",
                "type": "string"
              },
              {
                "id": "display_name",
                "name": "姓名",
                "type": "string"
              },
              {
                "id": "mobile",
                "name": "手机号",
                "type": "string",
                "format": "masked"
              },
              {
                "id": "department",
                "name": "所属部门",
                "type": "string"
              },
              {
                "id": "account_status",
                "name": "账号状态",
                "type": "enum",
                "options": [
                  {
                    "id": "active",
                    "label": "启用",
                    "tone": "success"
                  },
                  {
                    "id": "locked",
                    "label": "锁定",
                    "tone": "danger"
                  },
                  {
                    "id": "disabled",
                    "label": "停用",
                    "tone": "default"
                  }
                ]
              },
              {
                "id": "last_login_at",
                "name": "最后登录时间",
                "type": "date"
              }
            ]
          },
          {
            "id": "role_profile",
            "name": "角色",
            "fields": [
              {
                "id": "role_code",
                "name": "角色编码",
                "type": "string"
              },
              {
                "id": "role_name",
                "name": "角色名称",
                "type": "string"
              },
              {
                "id": "role_type",
                "name": "角色类型",
                "type": "enum",
                "options": [
                  {
                    "id": "business",
                    "label": "业务角色",
                    "tone": "processing"
                  },
                  {
                    "id": "admin",
                    "label": "管理角色",
                    "tone": "warning"
                  },
                  {
                    "id": "audit",
                    "label": "审计角色",
                    "tone": "default"
                  }
                ]
              },
              {
                "id": "owner_department",
                "name": "归属部门",
                "type": "string"
              },
              {
                "id": "role_status",
                "name": "角色状态",
                "type": "enum",
                "options": [
                  {
                    "id": "draft",
                    "label": "草稿",
                    "tone": "default"
                  },
                  {
                    "id": "pending",
                    "label": "待审批",
                    "tone": "warning"
                  },
                  {
                    "id": "active",
                    "label": "已生效",
                    "tone": "success"
                  },
                  {
                    "id": "suspended",
                    "label": "已暂停",
                    "tone": "danger"
                  }
                ]
              }
            ]
          },
          {
            "id": "permission_item",
            "name": "权限点",
            "fields": [
              {
                "id": "permission_code",
                "name": "权限编码",
                "type": "string"
              },
              {
                "id": "permission_name",
                "name": "权限名称",
                "type": "string"
              },
              {
                "id": "resource_type",
                "name": "资源类型",
                "type": "enum",
                "options": [
                  {
                    "id": "menu",
                    "label": "菜单",
                    "tone": "default"
                  },
                  {
                    "id": "button",
                    "label": "按钮",
                    "tone": "processing"
                  },
                  {
                    "id": "api",
                    "label": "接口",
                    "tone": "warning"
                  },
                  {
                    "id": "data",
                    "label": "数据权限",
                    "tone": "success"
                  }
                ]
              },
              {
                "id": "sensitivity_level",
                "name": "敏感级别",
                "type": "enum",
                "options": [
                  {
                    "id": "low",
                    "label": "低",
                    "tone": "success"
                  },
                  {
                    "id": "medium",
                    "label": "中",
                    "tone": "warning"
                  },
                  {
                    "id": "high",
                    "label": "高",
                    "tone": "danger"
                  }
                ]
              },
              {
                "id": "permission_status",
                "name": "权限状态",
                "type": "enum",
                "options": [
                  {
                    "id": "enabled",
                    "label": "启用",
                    "tone": "success"
                  },
                  {
                    "id": "deprecated",
                    "label": "废弃",
                    "tone": "warning"
                  },
                  {
                    "id": "disabled",
                    "label": "停用",
                    "tone": "default"
                  }
                ]
              }
            ]
          },
          {
            "id": "menu_resource",
            "name": "菜单资源",
            "fields": [
              {
                "id": "menu_code",
                "name": "菜单编码",
                "type": "string"
              },
              {
                "id": "menu_name",
                "name": "菜单名称",
                "type": "string"
              },
              {
                "id": "parent_menu",
                "name": "上级菜单",
                "type": "ref"
              },
              {
                "id": "bound_permission",
                "name": "绑定权限点",
                "type": "ref"
              },
              {
                "id": "menu_status",
                "name": "菜单状态",
                "type": "enum",
                "options": [
                  {
                    "id": "visible",
                    "label": "可见",
                    "tone": "success"
                  },
                  {
                    "id": "hidden",
                    "label": "隐藏",
                    "tone": "default"
                  },
                  {
                    "id": "retired",
                    "label": "下线",
                    "tone": "danger"
                  }
                ]
              }
            ]
          },
          {
            "id": "data_scope_policy",
            "name": "数据范围策略",
            "fields": [
              {
                "id": "policy_name",
                "name": "策略名称",
                "type": "string"
              },
              {
                "id": "scope_type",
                "name": "范围类型",
                "type": "enum",
                "options": [
                  {
                    "id": "self",
                    "label": "仅本人",
                    "tone": "default"
                  },
                  {
                    "id": "department",
                    "label": "本部门",
                    "tone": "processing"
                  },
                  {
                    "id": "department_tree",
                    "label": "本部门及下级",
                    "tone": "warning"
                  },
                  {
                    "id": "all",
                    "label": "全部数据",
                    "tone": "danger"
                  },
                  {
                    "id": "custom",
                    "label": "自定义",
                    "tone": "processing"
                  }
                ]
              },
              {
                "id": "scope_rule",
                "name": "范围规则",
                "type": "string"
              },
              {
                "id": "risk_score",
                "name": "风险评分",
                "type": "number",
                "format": "score"
              },
              {
                "id": "policy_status",
                "name": "策略状态",
                "type": "enum",
                "options": [
                  {
                    "id": "draft",
                    "label": "草稿",
                    "tone": "default"
                  },
                  {
                    "id": "reviewing",
                    "label": "审核中",
                    "tone": "processing"
                  },
                  {
                    "id": "effective",
                    "label": "已生效",
                    "tone": "success"
                  },
                  {
                    "id": "rejected",
                    "label": "已驳回",
                    "tone": "danger"
                  }
                ]
              }
            ]
          },
          {
            "id": "role_assignment",
            "name": "角色授权",
            "fields": [
              {
                "id": "user_ref",
                "name": "授权用户",
                "type": "ref"
              },
              {
                "id": "role_ref",
                "name": "授权角色",
                "type": "ref"
              },
              {
                "id": "data_scope_ref",
                "name": "数据范围",
                "type": "ref"
              },
              {
                "id": "valid_from",
                "name": "生效日期",
                "type": "date"
              },
              {
                "id": "valid_to",
                "name": "失效日期",
                "type": "date"
              },
              {
                "id": "assignment_status",
                "name": "授权状态",
                "type": "enum",
                "options": [
                  {
                    "id": "pending",
                    "label": "待生效",
                    "tone": "warning"
                  },
                  {
                    "id": "active",
                    "label": "生效中",
                    "tone": "success"
                  },
                  {
                    "id": "expired",
                    "label": "已过期",
                    "tone": "default"
                  },
                  {
                    "id": "revoked",
                    "label": "已撤销",
                    "tone": "danger"
                  }
                ]
              }
            ]
          },
          {
            "id": "access_request",
            "name": "权限申请单",
            "fields": [
              {
                "id": "request_no",
                "name": "申请单号",
                "type": "string"
              },
              {
                "id": "requester_ref",
                "name": "申请人",
                "type": "ref"
              },
              {
                "id": "target_user_ref",
                "name": "目标用户",
                "type": "ref"
              },
              {
                "id": "requested_role_ref",
                "name": "申请角色",
                "type": "ref"
              },
              {
                "id": "requested_scope_ref",
                "name": "申请数据范围",
                "type": "ref"
              },
              {
                "id": "business_reason",
                "name": "申请理由",
                "type": "string"
              },
              {
                "id": "risk_summary",
                "name": "风险摘要",
                "type": "string"
              },
              {
                "id": "approval_note",
                "name": "审批意见",
                "type": "string"
              },
              {
                "id": "status",
                "name": "申请状态",
                "type": "enum",
                "options": [
                  {
                    "id": "draft",
                    "label": "草稿",
                    "tone": "default"
                  },
                  {
                    "id": "reviewing",
                    "label": "审核中",
                    "tone": "processing"
                  },
                  {
                    "id": "provisioning",
                    "label": "生效中",
                    "tone": "warning"
                  },
                  {
                    "id": "completed",
                    "label": "已完成",
                    "tone": "success"
                  },
                  {
                    "id": "rejected",
                    "label": "已驳回",
                    "tone": "danger"
                  }
                ]
              },
              {
                "id": "created_at",
                "name": "创建时间",
                "type": "date"
              }
            ]
          },
          {
            "id": "audit_log",
            "name": "权限审计日志",
            "fields": [
              {
                "id": "actor_ref",
                "name": "操作人",
                "type": "ref"
              },
              {
                "id": "target_entity",
                "name": "对象类型",
                "type": "string"
              },
              {
                "id": "target_id",
                "name": "对象标识",
                "type": "string"
              },
              {
                "id": "operation",
                "name": "操作动作",
                "type": "enum",
                "options": [
                  {
                    "id": "create",
                    "label": "创建",
                    "tone": "processing"
                  },
                  {
                    "id": "approve",
                    "label": "审批",
                    "tone": "success"
                  },
                  {
                    "id": "reject",
                    "label": "驳回",
                    "tone": "danger"
                  },
                  {
                    "id": "grant",
                    "label": "授权",
                    "tone": "warning"
                  },
                  {
                    "id": "revoke",
                    "label": "撤权",
                    "tone": "danger"
                  },
                  {
                    "id": "sync",
                    "label": "同步",
                    "tone": "default"
                  }
                ]
              },
              {
                "id": "result",
                "name": "操作结果",
                "type": "enum",
                "options": [
                  {
                    "id": "success",
                    "label": "成功",
                    "tone": "success"
                  },
                  {
                    "id": "failed",
                    "label": "失败",
                    "tone": "danger"
                  },
                  {
                    "id": "partial",
                    "label": "部分成功",
                    "tone": "warning"
                  }
                ]
              },
              {
                "id": "occurred_at",
                "name": "发生时间",
                "type": "date"
              }
            ]
          }
        ]
      }
    },
    {
      "skill": "rbac",
      "label": "rbac",
      "mermaid": "flowchart LR\n  datamodel[\"datamodel\"] -->|DM_RBAC_FIELD_POLICY_EVIDENCE| rbac[\"rbac\"]\n  rbac[\"rbac\"] -->|RBAC_WORKFLOW_ASSIGNEE_EVIDENCE| workflow[\"workflow\"]",
      "modelSection": {
        "roles": [
          "requester",
          "org_admin",
          "security_admin",
          "approver",
          "auditor"
        ],
        "permissions": [
          "access_request:create",
          "access_request:read",
          "access_request:review",
          "access_request:provision",
          "role_profile:read",
          "role_profile:manage",
          "permission_item:read",
          "permission_item:manage",
          "menu_resource:read",
          "menu_resource:manage",
          "data_scope_policy:read",
          "data_scope_policy:manage",
          "role_assignment:read",
          "role_assignment:revoke",
          "audit_log:read",
          "audit_log:export"
        ],
        "menus": [
          {
            "id": "menu_requester_workspace",
            "label": "我的权限申请",
            "roleRefs": [
              "requester"
            ],
            "permissionRefs": [
              "access_request:create",
              "access_request:read",
              "role_profile:read",
              "data_scope_policy:read"
            ]
          },
          {
            "id": "menu_org_admin_assignment",
            "label": "组织授权管理",
            "roleRefs": [
              "org_admin"
            ],
            "permissionRefs": [
              "access_request:read",
              "access_request:review",
              "role_assignment:read",
              "role_assignment:revoke",
              "role_profile:read",
              "data_scope_policy:read"
            ]
          },
          {
            "id": "menu_security_admin_config",
            "label": "权限模型配置",
            "roleRefs": [
              "security_admin"
            ],
            "permissionRefs": [
              "access_request:read",
              "access_request:provision",
              "role_profile:manage",
              "permission_item:manage",
              "menu_resource:manage",
              "data_scope_policy:manage",
              "role_assignment:read"
            ]
          },
          {
            "id": "menu_approver_review",
            "label": "权限审批中心",
            "roleRefs": [
              "approver"
            ],
            "permissionRefs": [
              "access_request:read",
              "access_request:review",
              "permission_item:read",
              "menu_resource:read",
              "data_scope_policy:read"
            ]
          },
          {
            "id": "menu_auditor_console",
            "label": "权限审计看板",
            "roleRefs": [
              "auditor"
            ],
            "permissionRefs": [
              "audit_log:read",
              "audit_log:export",
              "role_assignment:read",
              "permission_item:read",
              "menu_resource:read",
              "role_profile:read",
              "data_scope_policy:read"
            ]
          }
        ]
      }
    },
    {
      "skill": "workflow",
      "label": "workflow",
      "mermaid": "flowchart LR\n  rbac[\"rbac\"] -->|RBAC_WORKFLOW_ASSIGNEE_EVIDENCE| workflow[\"workflow\"]\n  workflow[\"workflow\"] -->|WORKFLOW_PAGE_TASK_SURFACE_EVIDENCE| page[\"page\"]",
      "modelSection": {
        "id": "access_request_lifecycle",
        "name": "权限申请单生命周期",
        "nodes": [
          {
            "id": "ar_draft",
            "name": "填写权限申请",
            "assigneeRole": "requester",
            "phase": "提交"
          },
          {
            "id": "ar_org_review",
            "name": "部门管理员核验",
            "assigneeRole": "org_admin",
            "phase": "校验"
          },
          {
            "id": "ar_security_review",
            "name": "安全审批",
            "assigneeRole": "approver",
            "phase": "校验"
          },
          {
            "id": "ar_provision",
            "name": "执行授权生效",
            "assigneeRole": "security_admin",
            "phase": "生效"
          },
          {
            "id": "ar_completed",
            "name": "归档完成",
            "assigneeRole": "auditor",
            "phase": "归档"
          },
          {
            "id": "ar_rejected",
            "name": "驳回关闭",
            "assigneeRole": "requester",
            "phase": "归档"
          }
        ],
        "transitions": [
          {
            "from": "ar_draft",
            "to": "ar_org_review",
            "condition": "申请资料完整"
          },
          {
            "from": "ar_org_review",
            "to": "ar_draft",
            "condition": "业务理由不充分，退回补充"
          },
          {
            "from": "ar_org_review",
            "to": "ar_security_review",
            "condition": "部门核验通过"
          },
          {
            "from": "ar_org_review",
            "to": "ar_rejected",
            "condition": "申请人与岗位不匹配"
          },
          {
            "from": "ar_security_review",
            "to": "ar_provision",
            "condition": "风险可接受"
          },
          {
            "from": "ar_security_review",
            "to": "ar_rejected",
            "condition": "高敏权限或数据范围过大"
          },
          {
            "from": "ar_provision",
            "to": "ar_completed",
            "condition": "角色与数据范围写入成功"
          },
          {
            "from": "ar_provision",
            "to": "ar_security_review",
            "condition": "授权写入失败需复核"
          }
        ],
        "chains": [
          {
            "id": "role_policy_governance",
            "name": "角色与数据范围治理审批",
            "kind": "governance",
            "nodes": [
              {
                "id": "gov_submit_change",
                "name": "提交角色或策略变更",
                "assigneeRole": "security_admin",
                "phase": "提交"
              },
              {
                "id": "gov_business_review",
                "name": "业务负责人评审",
                "assigneeRole": "approver",
                "phase": "评审"
              },
              {
                "id": "gov_audit_review",
                "name": "审计合规复核",
                "assigneeRole": "auditor",
                "phase": "评审"
              },
              {
                "id": "gov_publish",
                "name": "发布权限模型",
                "assigneeRole": "security_admin",
                "phase": "发布"
              },
              {
                "id": "gov_rejected",
                "name": "治理变更驳回",
                "assigneeRole": "security_admin",
                "phase": "关闭"
              }
            ],
            "transitions": [
              {
                "from": "gov_submit_change",
                "to": "gov_business_review",
                "condition": "变更说明完整"
              },
              {
                "from": "gov_business_review",
                "to": "gov_submit_change",
                "condition": "影响范围不清退回修订"
              },
              {
                "from": "gov_business_review",
                "to": "gov_audit_review",
                "condition": "业务评审通过"
              },
              {
                "from": "gov_audit_review",
                "to": "gov_publish",
                "condition": "符合最小权限要求"
              },
              {
                "from": "gov_audit_review",
                "to": "gov_rejected",
                "condition": "存在越权或职责冲突"
              },
              {
                "from": "gov_publish",
                "to": "gov_audit_review",
                "condition": "发布校验失败回审"
              },
              {
                "from": "gov_publish",
                "to": "gov_submit_change",
                "condition": "需重新拆分权限包"
              }
            ]
          },
          {
            "id": "permission_sync_recovery",
            "name": "权限缓存与同步恢复",
            "kind": "recovery",
            "nodes": [
              {
                "id": "rec_detect_failure",
                "name": "发现授权同步异常",
                "assigneeRole": "security_admin",
                "phase": "发现"
              },
              {
                "id": "rec_retry_sync",
                "name": "重试同步权限缓存",
                "assigneeRole": "security_admin",
                "phase": "修复"
              },
              {
                "id": "rec_manual_reconcile",
                "name": "人工核对授权差异",
                "assigneeRole": "auditor",
                "phase": "修复"
              },
              {
                "id": "rec_restore_service",
                "name": "恢复访问控制服务",
                "assigneeRole": "security_admin",
                "phase": "恢复"
              },
              {
                "id": "rec_close_incident",
                "name": "关闭恢复工单",
                "assigneeRole": "auditor",
                "phase": "关闭"
              }
            ],
            "transitions": [
              {
                "from": "rec_detect_failure",
                "to": "rec_retry_sync",
                "condition": "异常可自动重试"
              },
              {
                "from": "rec_detect_failure",
                "to": "rec_manual_reconcile",
                "condition": "发现授权账实不一致"
              },
              {
                "from": "rec_retry_sync",
                "to": "rec_restore_service",
                "condition": "缓存重建成功"
              },
              {
                "from": "rec_retry_sync",
                "to": "rec_manual_reconcile",
                "condition": "重试仍失败"
              },
              {
                "from": "rec_manual_reconcile",
                "to": "rec_retry_sync",
                "condition": "差异修正后再次同步"
              },
              {
                "from": "rec_restore_service",
                "to": "rec_close_incident",
                "condition": "访问校验通过"
              },
              {
                "from": "rec_restore_service",
                "to": "rec_manual_reconcile",
                "condition": "仍存在漏授权或越权"
              }
            ]
          }
        ]
      }
    },
    {
      "skill": "page",
      "label": "page",
      "mermaid": "flowchart LR\n  datamodel[\"datamodel\"] -->|DM_PAGE_BINDING_IMPACT_EVIDENCE| page[\"page\"]\n  workflow[\"workflow\"] -->|WORKFLOW_PAGE_TASK_SURFACE_EVIDENCE| page[\"page\"]\n  page[\"page\"] -->|PAGE_APPBUNDLE_RUNTIME_SURFACE_EVIDENCE| appbundle[\"appbundle\"]",
      "modelSection": {
        "pages": [
          {
            "id": "page_access_request_kanban",
            "name": "权限申请看板",
            "kind": "kanban",
            "statusField": "access_request.status",
            "fieldBindings": [
              "access_request.request_no",
              "access_request.requester_ref",
              "access_request.target_user_ref",
              "access_request.requested_role_ref",
              "access_request.requested_scope_ref",
              "access_request.business_reason",
              "access_request.risk_summary",
              "access_request.approval_note",
              "access_request.status",
              "access_request.created_at"
            ],
            "actionPermissions": [
              "access_request:create",
              "access_request:read",
              "access_request:review",
              "access_request:provision"
            ]
          },
          {
            "id": "page_role_permission_workbench",
            "name": "角色权限配置台",
            "kind": "workbench",
            "fieldBindings": [
              "role_profile.role_code",
              "role_profile.role_name",
              "role_profile.role_type",
              "role_profile.owner_department",
              "role_profile.role_status",
              "permission_item.permission_code",
              "permission_item.permission_name",
              "permission_item.resource_type",
              "permission_item.sensitivity_level",
              "permission_item.permission_status",
              "menu_resource.menu_code",
              "menu_resource.menu_name",
              "menu_resource.parent_menu",
              "menu_resource.bound_permission",
              "menu_resource.menu_status"
            ],
            "actionPermissions": [
              "role_profile:read",
              "role_profile:manage",
              "permission_item:read",
              "permission_item:manage",
              "menu_resource:read",
              "menu_resource:manage"
            ]
          },
          {
            "id": "page_data_scope_workbench",
            "name": "数据范围策略台",
            "kind": "workbench",
            "fieldBindings": [
              "data_scope_policy.policy_name",
              "data_scope_policy.scope_type",
              "data_scope_policy.scope_rule",
              "data_scope_policy.risk_score",
              "data_scope_policy.policy_status",
              "role_assignment.user_ref",
              "role_assignment.role_ref",
              "role_assignment.data_scope_ref",
              "role_assignment.valid_from",
              "role_assignment.valid_to",
              "role_assignment.assignment_status"
            ],
            "actionPermissions": [
              "data_scope_policy:read",
              "data_scope_policy:manage",
              "role_assignment:read",
              "role_assignment:revoke"
            ]
          },
          {
            "id": "page_user_account_workbench",
            "name": "用户账号管理",
            "kind": "workbench",
            "fieldBindings": [
              "user_account.username",
              "user_account.display_name",
              "user_account.mobile",
              "user_account.department",
              "user_account.account_status",
              "user_account.last_login_at"
            ],
            "actionPermissions": [
              "role_assignment:read",
              "access_request:create",
              "access_request:read"
            ]
          },
          {
            "id": "page_audit_dashboard",
            "name": "权限审计看板",
            "kind": "dashboard",
            "fieldBindings": [
              "audit_log.actor_ref",
              "audit_log.target_entity",
              "audit_log.target_id",
              "audit_log.operation",
              "audit_log.result",
              "audit_log.occurred_at",
              "role_assignment.assignment_status",
              "data_scope_policy.scope_type"
            ],
            "actionPermissions": [
              "audit_log:read",
              "audit_log:export",
              "role_assignment:read"
            ],
            "stats": [
              {
                "id": "stat_audit_events",
                "name": "审计事件数",
                "entity": "audit_log",
                "metric": "count",
                "format": "number"
              },
              {
                "id": "stat_active_assignments",
                "name": "授权记录数",
                "entity": "role_assignment",
                "metric": "count",
                "format": "number"
              },
              {
                "id": "stat_avg_scope_risk",
                "name": "平均范围风险",
                "entity": "data_scope_policy",
                "metric": "avg:data_scope_policy.risk_score",
                "format": "number"
              }
            ],
            "charts": [
              {
                "id": "chart_operations_by_type",
                "name": "操作动作分布",
                "type": "bar",
                "dimension": "audit_log.operation",
                "metric": "count"
              },
              {
                "id": "chart_scope_type_share",
                "name": "数据范围类型占比",
                "type": "pie",
                "dimension": "data_scope_policy.scope_type",
                "metric": "count"
              }
            ]
          }
        ]
      }
    },
    {
      "skill": "aigc",
      "label": "aigc",
      "mermaid": "flowchart LR\n  aigc[\"aigc\"] -->|AIGC_APPBUNDLE_RUNTIME_EVIDENCE| appbundle[\"appbundle\"]",
      "modelSection": {
        "capabilities": [
          {
            "id": "cap_analyze_access_risk",
            "name": "权限申请风险摘要生成",
            "inputFields": [
              "access_request.business_reason",
              "access_request.requested_role_ref",
              "access_request.requested_scope_ref"
            ],
            "outputField": "access_request.risk_summary",
            "roleRefs": [
              "approver",
              "security_admin"
            ]
          },
          {
            "id": "cap_recommend_scope_rule",
            "name": "数据范围规则建议",
            "inputFields": [
              "access_request.risk_summary",
              "data_scope_policy.scope_type",
              "data_scope_policy.risk_score"
            ],
            "outputField": "data_scope_policy.scope_rule",
            "roleRefs": [
              "security_admin",
              "org_admin"
            ]
          },
          {
            "id": "cap_generate_approval_note",
            "name": "审批意见草拟",
            "inputFields": [
              "data_scope_policy.scope_rule",
              "access_request.risk_summary",
              "access_request.business_reason"
            ],
            "outputField": "access_request.approval_note",
            "roleRefs": [
              "approver",
              "org_admin"
            ]
          },
          {
            "id": "cap_summarize_audit_log",
            "name": "审计日志异常摘要",
            "inputFields": [
              "audit_log.operation",
              "audit_log.result",
              "audit_log.target_entity"
            ],
            "outputField": "access_request.risk_summary",
            "roleRefs": [
              "auditor"
            ]
          }
        ],
        "pipelines": [
          {
            "id": "pipeline_access_request_review",
            "name": "权限申请智能评审编排",
            "steps": [
              "cap_analyze_access_risk",
              "cap_recommend_scope_rule",
              "cap_generate_approval_note"
            ]
          }
        ]
      }
    },
    {
      "skill": "appBundle",
      "label": "appbundle",
      "mermaid": "flowchart LR\n  page[\"page\"] -->|PAGE_APPBUNDLE_RUNTIME_SURFACE_EVIDENCE| appbundle[\"appbundle\"]\n  aigc[\"aigc\"] -->|AIGC_APPBUNDLE_RUNTIME_EVIDENCE| appbundle[\"appbundle\"]",
      "modelSection": {
        "pageBindings": [
          {
            "pageRef": "page_access_request_kanban",
            "workflowRef": "access_request_lifecycle"
          },
          {
            "pageRef": "page_role_permission_workbench",
            "workflowRef": "gov_submit_change"
          },
          {
            "pageRef": "page_data_scope_workbench",
            "workflowRef": "role_policy_governance"
          },
          {
            "pageRef": "page_user_account_workbench",
            "workflowRef": "ar_draft"
          },
          {
            "pageRef": "page_audit_dashboard",
            "workflowRef": "rec_close_incident"
          }
        ],
        "roleRefs": [
          "requester",
          "org_admin",
          "security_admin",
          "approver",
          "auditor"
        ],
        "dataModelRefs": [
          "user_account",
          "role_profile",
          "permission_item",
          "menu_resource",
          "data_scope_policy",
          "role_assignment",
          "access_request",
          "audit_log"
        ],
        "invariants": [
          {
            "id": "assignment_requires_completed_request",
            "statement": "任何角色授权记录变为生效中之前，必须存在已完成的权限申请单审批链路。",
            "systems": [
              "datamodel",
              "workflow",
              "page"
            ],
            "refs": [
              "role_assignment.assignment_status",
              "access_request.status",
              "ar_completed"
            ]
          },
          {
            "id": "high_scope_requires_security_review",
            "statement": "申请全部数据或高风险数据范围时，必须经过安全审批节点且不得由申请人直接生效。",
            "systems": [
              "datamodel",
              "workflow",
              "rbac"
            ],
            "refs": [
              "data_scope_policy.scope_type",
              "data_scope_policy.risk_score",
              "ar_security_review",
              "requester",
              "security_admin"
            ]
          },
          {
            "id": "permission_model_changes_governed",
            "statement": "角色、权限点、菜单资源和数据范围策略的管理操作必须先通过治理审批后才能发布。",
            "systems": [
              "datamodel",
              "rbac",
              "workflow"
            ],
            "refs": [
              "role_profile",
              "permission_item",
              "menu_resource",
              "data_scope_policy",
              "role_profile:manage",
              "permission_item:manage",
              "menu_resource:manage",
              "data_scope_policy:manage",
              "gov_publish"
            ]
          },
          {
            "id": "data_scope_not_broader_than_role",
            "statement": "授权记录绑定的数据范围不得宽于被授权角色在数据范围策略台中配置的范围规则。",
            "systems": [
              "datamodel",
              "page"
            ],
            "refs": [
              "role_assignment.role_ref",
              "role_assignment.data_scope_ref",
              "data_scope_policy.scope_rule",
              "page_data_scope_workbench"
            ]
          },
          {
            "id": "audit_log_for_every_grant_or_revoke",
            "statement": "每一次授权生效或撤权操作都必须产生一条成功或失败的权限审计日志。",
            "systems": [
              "datamodel",
              "rbac",
              "workflow"
            ],
            "refs": [
              "role_assignment.assignment_status",
              "audit_log.operation",
              "audit_log.result",
              "access_request:provision",
              "role_assignment:revoke",
              "ar_provision"
            ]
          },
          {
            "id": "ai_generated_review_is_not_final_approval",
            "statement": "AIGC 生成的风险摘要和审批意见只能作为辅助输入，最终审批必须由审批人角色在工作流节点上确认。",
            "systems": [
              "aigc",
              "workflow",
              "rbac",
              "datamodel"
            ],
            "refs": [
              "cap_analyze_access_risk",
              "cap_generate_approval_note",
              "access_request.risk_summary",
              "access_request.approval_note",
              "approver",
              "ar_security_review"
            ]
          },
          {
            "id": "sync_failure_requires_recovery_closure",
            "statement": "权限缓存同步失败后，只有恢复链路关闭并完成审计核对，相关异常申请才能再次进入生效节点。",
            "systems": [
              "workflow",
              "datamodel"
            ],
            "refs": [
              "rec_detect_failure",
              "rec_manual_reconcile",
              "rec_close_incident",
              "ar_provision",
              "audit_log.result"
            ]
          }
        ]
      }
    }
  ],
  "publishClosure": {
    "blocked": false,
    "blockerCount": 0,
    "evidencePresentCount": 6,
    "skillCount": 6,
    "versionPinsChecked": true,
    "closureId": "appbundle:app_purchase_approval@1.0.0:runtime-closure",
    "closureHash": "3ce79ac0",
    "stableDigest": "1fe65032",
    "tierCounts": {
      "hard_blocker": 0,
      "warning": 0,
      "info": 0
    },
    "perSkillEvidence": {
      "datamodel": {
        "evidencePresent": true,
        "evidenceRef": "evidence:datamodel:llm-linkage-datamodel",
        "path": "skills/datamodel/closure-evidence.json",
        "artifactId": "llm-linkage-datamodel",
        "digest": "5b03ca8344295e4c",
        "modelSection": {
          "entities": [
            {
              "id": "user_account",
              "name": "用户账号",
              "fields": [
                {
                  "id": "username",
                  "name": "登录名",
                  "type": "string"
                },
                {
                  "id": "display_name",
                  "name": "姓名",
                  "type": "string"
                },
                {
                  "id": "mobile",
                  "name": "手机号",
                  "type": "string",
                  "format": "masked"
                },
                {
                  "id": "department",
                  "name": "所属部门",
                  "type": "string"
                },
                {
                  "id": "account_status",
                  "name": "账号状态",
                  "type": "enum",
                  "options": [
                    {
                      "id": "active",
                      "label": "启用",
                      "tone": "success"
                    },
                    {
                      "id": "locked",
                      "label": "锁定",
                      "tone": "danger"
                    },
                    {
                      "id": "disabled",
                      "label": "停用",
                      "tone": "default"
                    }
                  ]
                },
                {
                  "id": "last_login_at",
                  "name": "最后登录时间",
                  "type": "date"
                }
              ]
            },
            {
              "id": "role_profile",
              "name": "角色",
              "fields": [
                {
                  "id": "role_code",
                  "name": "角色编码",
                  "type": "string"
                },
                {
                  "id": "role_name",
                  "name": "角色名称",
                  "type": "string"
                },
                {
                  "id": "role_type",
                  "name": "角色类型",
                  "type": "enum",
                  "options": [
                    {
                      "id": "business",
                      "label": "业务角色",
                      "tone": "processing"
                    },
                    {
                      "id": "admin",
                      "label": "管理角色",
                      "tone": "warning"
                    },
                    {
                      "id": "audit",
                      "label": "审计角色",
                      "tone": "default"
                    }
                  ]
                },
                {
                  "id": "owner_department",
                  "name": "归属部门",
                  "type": "string"
                },
                {
                  "id": "role_status",
                  "name": "角色状态",
                  "type": "enum",
                  "options": [
                    {
                      "id": "draft",
                      "label": "草稿",
                      "tone": "default"
                    },
                    {
                      "id": "pending",
                      "label": "待审批",
                      "tone": "warning"
                    },
                    {
                      "id": "active",
                      "label": "已生效",
                      "tone": "success"
                    },
                    {
                      "id": "suspended",
                      "label": "已暂停",
                      "tone": "danger"
                    }
                  ]
                }
              ]
            },
            {
              "id": "permission_item",
              "name": "权限点",
              "fields": [
                {
                  "id": "permission_code",
                  "name": "权限编码",
                  "type": "string"
                },
                {
                  "id": "permission_name",
                  "name": "权限名称",
                  "type": "string"
                },
                {
                  "id": "resource_type",
                  "name": "资源类型",
                  "type": "enum",
                  "options": [
                    {
                      "id": "menu",
                      "label": "菜单",
                      "tone": "default"
                    },
                    {
                      "id": "button",
                      "label": "按钮",
                      "tone": "processing"
                    },
                    {
                      "id": "api",
                      "label": "接口",
                      "tone": "warning"
                    },
                    {
                      "id": "data",
                      "label": "数据权限",
                      "tone": "success"
                    }
                  ]
                },
                {
                  "id": "sensitivity_level",
                  "name": "敏感级别",
                  "type": "enum",
                  "options": [
                    {
                      "id": "low",
                      "label": "低",
                      "tone": "success"
                    },
                    {
                      "id": "medium",
                      "label": "中",
                      "tone": "warning"
                    },
                    {
                      "id": "high",
                      "label": "高",
                      "tone": "danger"
                    }
                  ]
                },
                {
                  "id": "permission_status",
                  "name": "权限状态",
                  "type": "enum",
                  "options": [
                    {
                      "id": "enabled",
                      "label": "启用",
                      "tone": "success"
                    },
                    {
                      "id": "deprecated",
                      "label": "废弃",
                      "tone": "warning"
                    },
                    {
                      "id": "disabled",
                      "label": "停用",
                      "tone": "default"
                    }
                  ]
                }
              ]
            },
            {
              "id": "menu_resource",
              "name": "菜单资源",
              "fields": [
                {
                  "id": "menu_code",
                  "name": "菜单编码",
                  "type": "string"
                },
                {
                  "id": "menu_name",
                  "name": "菜单名称",
                  "type": "string"
                },
                {
                  "id": "parent_menu",
                  "name": "上级菜单",
                  "type": "ref"
                },
                {
                  "id": "bound_permission",
                  "name": "绑定权限点",
                  "type": "ref"
                },
                {
                  "id": "menu_status",
                  "name": "菜单状态",
                  "type": "enum",
                  "options": [
                    {
                      "id": "visible",
                      "label": "可见",
                      "tone": "success"
                    },
                    {
                      "id": "hidden",
                      "label": "隐藏",
                      "tone": "default"
                    },
                    {
                      "id": "retired",
                      "label": "下线",
                      "tone": "danger"
                    }
                  ]
                }
              ]
            },
            {
              "id": "data_scope_policy",
              "name": "数据范围策略",
              "fields": [
                {
                  "id": "policy_name",
                  "name": "策略名称",
                  "type": "string"
                },
                {
                  "id": "scope_type",
                  "name": "范围类型",
                  "type": "enum",
                  "options": [
                    {
                      "id": "self",
                      "label": "仅本人",
                      "tone": "default"
                    },
                    {
                      "id": "department",
                      "label": "本部门",
                      "tone": "processing"
                    },
                    {
                      "id": "department_tree",
                      "label": "本部门及下级",
                      "tone": "warning"
                    },
                    {
                      "id": "all",
                      "label": "全部数据",
                      "tone": "danger"
                    },
                    {
                      "id": "custom",
                      "label": "自定义",
                      "tone": "processing"
                    }
                  ]
                },
                {
                  "id": "scope_rule",
                  "name": "范围规则",
                  "type": "string"
                },
                {
                  "id": "risk_score",
                  "name": "风险评分",
                  "type": "number",
                  "format": "score"
                },
                {
                  "id": "policy_status",
                  "name": "策略状态",
                  "type": "enum",
                  "options": [
                    {
                      "id": "draft",
                      "label": "草稿",
                      "tone": "default"
                    },
                    {
                      "id": "reviewing",
                      "label": "审核中",
                      "tone": "processing"
                    },
                    {
                      "id": "effective",
                      "label": "已生效",
                      "tone": "success"
                    },
                    {
                      "id": "rejected",
                      "label": "已驳回",
                      "tone": "danger"
                    }
                  ]
                }
              ]
            },
            {
              "id": "role_assignment",
              "name": "角色授权",
              "fields": [
                {
                  "id": "user_ref",
                  "name": "授权用户",
                  "type": "ref"
                },
                {
                  "id": "role_ref",
                  "name": "授权角色",
                  "type": "ref"
                },
                {
                  "id": "data_scope_ref",
                  "name": "数据范围",
                  "type": "ref"
                },
                {
                  "id": "valid_from",
                  "name": "生效日期",
                  "type": "date"
                },
                {
                  "id": "valid_to",
                  "name": "失效日期",
                  "type": "date"
                },
                {
                  "id": "assignment_status",
                  "name": "授权状态",
                  "type": "enum",
                  "options": [
                    {
                      "id": "pending",
                      "label": "待生效",
                      "tone": "warning"
                    },
                    {
                      "id": "active",
                      "label": "生效中",
                      "tone": "success"
                    },
                    {
                      "id": "expired",
                      "label": "已过期",
                      "tone": "default"
                    },
                    {
                      "id": "revoked",
                      "label": "已撤销",
                      "tone": "danger"
                    }
                  ]
                }
              ]
            },
            {
              "id": "access_request",
              "name": "权限申请单",
              "fields": [
                {
                  "id": "request_no",
                  "name": "申请单号",
                  "type": "string"
                },
                {
                  "id": "requester_ref",
                  "name": "申请人",
                  "type": "ref"
                },
                {
                  "id": "target_user_ref",
                  "name": "目标用户",
                  "type": "ref"
                },
                {
                  "id": "requested_role_ref",
                  "name": "申请角色",
                  "type": "ref"
                },
                {
                  "id": "requested_scope_ref",
                  "name": "申请数据范围",
                  "type": "ref"
                },
                {
                  "id": "business_reason",
                  "name": "申请理由",
                  "type": "string"
                },
                {
                  "id": "risk_summary",
                  "name": "风险摘要",
                  "type": "string"
                },
                {
                  "id": "approval_note",
                  "name": "审批意见",
                  "type": "string"
                },
                {
                  "id": "status",
                  "name": "申请状态",
                  "type": "enum",
                  "options": [
                    {
                      "id": "draft",
                      "label": "草稿",
                      "tone": "default"
                    },
                    {
                      "id": "reviewing",
                      "label": "审核中",
                      "tone": "processing"
                    },
                    {
                      "id": "provisioning",
                      "label": "生效中",
                      "tone": "warning"
                    },
                    {
                      "id": "completed",
                      "label": "已完成",
                      "tone": "success"
                    },
                    {
                      "id": "rejected",
                      "label": "已驳回",
                      "tone": "danger"
                    }
                  ]
                },
                {
                  "id": "created_at",
                  "name": "创建时间",
                  "type": "date"
                }
              ]
            },
            {
              "id": "audit_log",
              "name": "权限审计日志",
              "fields": [
                {
                  "id": "actor_ref",
                  "name": "操作人",
                  "type": "ref"
                },
                {
                  "id": "target_entity",
                  "name": "对象类型",
                  "type": "string"
                },
                {
                  "id": "target_id",
                  "name": "对象标识",
                  "type": "string"
                },
                {
                  "id": "operation",
                  "name": "操作动作",
                  "type": "enum",
                  "options": [
                    {
                      "id": "create",
                      "label": "创建",
                      "tone": "processing"
                    },
                    {
                      "id": "approve",
                      "label": "审批",
                      "tone": "success"
                    },
                    {
                      "id": "reject",
                      "label": "驳回",
                      "tone": "danger"
                    },
                    {
                      "id": "grant",
                      "label": "授权",
                      "tone": "warning"
                    },
                    {
                      "id": "revoke",
                      "label": "撤权",
                      "tone": "danger"
                    },
                    {
                      "id": "sync",
                      "label": "同步",
                      "tone": "default"
                    }
                  ]
                },
                {
                  "id": "result",
                  "name": "操作结果",
                  "type": "enum",
                  "options": [
                    {
                      "id": "success",
                      "label": "成功",
                      "tone": "success"
                    },
                    {
                      "id": "failed",
                      "label": "失败",
                      "tone": "danger"
                    },
                    {
                      "id": "partial",
                      "label": "部分成功",
                      "tone": "warning"
                    }
                  ]
                },
                {
                  "id": "occurred_at",
                  "name": "发生时间",
                  "type": "date"
                }
              ]
            }
          ]
        }
      },
      "rbac": {
        "evidencePresent": true,
        "evidenceRef": "evidence:rbac:llm-linkage-rbac",
        "path": "skills/rbac/closure-evidence.json",
        "artifactId": "llm-linkage-rbac",
        "digest": "522fe6a69e34fc20",
        "modelSection": {
          "roles": [
            "requester",
            "org_admin",
            "security_admin",
            "approver",
            "auditor"
          ],
          "permissions": [
            "access_request:create",
            "access_request:read",
            "access_request:review",
            "access_request:provision",
            "role_profile:read",
            "role_profile:manage",
            "permission_item:read",
            "permission_item:manage",
            "menu_resource:read",
            "menu_resource:manage",
            "data_scope_policy:read",
            "data_scope_policy:manage",
            "role_assignment:read",
            "role_assignment:revoke",
            "audit_log:read",
            "audit_log:export"
          ],
          "menus": [
            {
              "id": "menu_requester_workspace",
              "label": "我的权限申请",
              "roleRefs": [
                "requester"
              ],
              "permissionRefs": [
                "access_request:create",
                "access_request:read",
                "role_profile:read",
                "data_scope_policy:read"
              ]
            },
            {
              "id": "menu_org_admin_assignment",
              "label": "组织授权管理",
              "roleRefs": [
                "org_admin"
              ],
              "permissionRefs": [
                "access_request:read",
                "access_request:review",
                "role_assignment:read",
                "role_assignment:revoke",
                "role_profile:read",
                "data_scope_policy:read"
              ]
            },
            {
              "id": "menu_security_admin_config",
              "label": "权限模型配置",
              "roleRefs": [
                "security_admin"
              ],
              "permissionRefs": [
                "access_request:read",
                "access_request:provision",
                "role_profile:manage",
                "permission_item:manage",
                "menu_resource:manage",
                "data_scope_policy:manage",
                "role_assignment:read"
              ]
            },
            {
              "id": "menu_approver_review",
              "label": "权限审批中心",
              "roleRefs": [
                "approver"
              ],
              "permissionRefs": [
                "access_request:read",
                "access_request:review",
                "permission_item:read",
                "menu_resource:read",
                "data_scope_policy:read"
              ]
            },
            {
              "id": "menu_auditor_console",
              "label": "权限审计看板",
              "roleRefs": [
                "auditor"
              ],
              "permissionRefs": [
                "audit_log:read",
                "audit_log:export",
                "role_assignment:read",
                "permission_item:read",
                "menu_resource:read",
                "role_profile:read",
                "data_scope_policy:read"
              ]
            }
          ]
        }
      },
      "workflow": {
        "evidencePresent": true,
        "evidenceRef": "evidence:workflow:llm-linkage-workflow",
        "path": "skills/workflow/closure-evidence.json",
        "artifactId": "llm-linkage-workflow",
        "digest": "2b54e8a4fd79e59f",
        "modelSection": {
          "id": "access_request_lifecycle",
          "name": "权限申请单生命周期",
          "nodes": [
            {
              "id": "ar_draft",
              "name": "填写权限申请",
              "assigneeRole": "requester",
              "phase": "提交"
            },
            {
              "id": "ar_org_review",
              "name": "部门管理员核验",
              "assigneeRole": "org_admin",
              "phase": "校验"
            },
            {
              "id": "ar_security_review",
              "name": "安全审批",
              "assigneeRole": "approver",
              "phase": "校验"
            },
            {
              "id": "ar_provision",
              "name": "执行授权生效",
              "assigneeRole": "security_admin",
              "phase": "生效"
            },
            {
              "id": "ar_completed",
              "name": "归档完成",
              "assigneeRole": "auditor",
              "phase": "归档"
            },
            {
              "id": "ar_rejected",
              "name": "驳回关闭",
              "assigneeRole": "requester",
              "phase": "归档"
            }
          ],
          "transitions": [
            {
              "from": "ar_draft",
              "to": "ar_org_review",
              "condition": "申请资料完整"
            },
            {
              "from": "ar_org_review",
              "to": "ar_draft",
              "condition": "业务理由不充分，退回补充"
            },
            {
              "from": "ar_org_review",
              "to": "ar_security_review",
              "condition": "部门核验通过"
            },
            {
              "from": "ar_org_review",
              "to": "ar_rejected",
              "condition": "申请人与岗位不匹配"
            },
            {
              "from": "ar_security_review",
              "to": "ar_provision",
              "condition": "风险可接受"
            },
            {
              "from": "ar_security_review",
              "to": "ar_rejected",
              "condition": "高敏权限或数据范围过大"
            },
            {
              "from": "ar_provision",
              "to": "ar_completed",
              "condition": "角色与数据范围写入成功"
            },
            {
              "from": "ar_provision",
              "to": "ar_security_review",
              "condition": "授权写入失败需复核"
            }
          ],
          "chains": [
            {
              "id": "role_policy_governance",
              "name": "角色与数据范围治理审批",
              "kind": "governance",
              "nodes": [
                {
                  "id": "gov_submit_change",
                  "name": "提交角色或策略变更",
                  "assigneeRole": "security_admin",
                  "phase": "提交"
                },
                {
                  "id": "gov_business_review",
                  "name": "业务负责人评审",
                  "assigneeRole": "approver",
                  "phase": "评审"
                },
                {
                  "id": "gov_audit_review",
                  "name": "审计合规复核",
                  "assigneeRole": "auditor",
                  "phase": "评审"
                },
                {
                  "id": "gov_publish",
                  "name": "发布权限模型",
                  "assigneeRole": "security_admin",
                  "phase": "发布"
                },
                {
                  "id": "gov_rejected",
                  "name": "治理变更驳回",
                  "assigneeRole": "security_admin",
                  "phase": "关闭"
                }
              ],
              "transitions": [
                {
                  "from": "gov_submit_change",
                  "to": "gov_business_review",
                  "condition": "变更说明完整"
                },
                {
                  "from": "gov_business_review",
                  "to": "gov_submit_change",
                  "condition": "影响范围不清退回修订"
                },
                {
                  "from": "gov_business_review",
                  "to": "gov_audit_review",
                  "condition": "业务评审通过"
                },
                {
                  "from": "gov_audit_review",
                  "to": "gov_publish",
                  "condition": "符合最小权限要求"
                },
                {
                  "from": "gov_audit_review",
                  "to": "gov_rejected",
                  "condition": "存在越权或职责冲突"
                },
                {
                  "from": "gov_publish",
                  "to": "gov_audit_review",
                  "condition": "发布校验失败回审"
                },
                {
                  "from": "gov_publish",
                  "to": "gov_submit_change",
                  "condition": "需重新拆分权限包"
                }
              ]
            },
            {
              "id": "permission_sync_recovery",
              "name": "权限缓存与同步恢复",
              "kind": "recovery",
              "nodes": [
                {
                  "id": "rec_detect_failure",
                  "name": "发现授权同步异常",
                  "assigneeRole": "security_admin",
                  "phase": "发现"
                },
                {
                  "id": "rec_retry_sync",
                  "name": "重试同步权限缓存",
                  "assigneeRole": "security_admin",
                  "phase": "修复"
                },
                {
                  "id": "rec_manual_reconcile",
                  "name": "人工核对授权差异",
                  "assigneeRole": "auditor",
                  "phase": "修复"
                },
                {
                  "id": "rec_restore_service",
                  "name": "恢复访问控制服务",
                  "assigneeRole": "security_admin",
                  "phase": "恢复"
                },
                {
                  "id": "rec_close_incident",
                  "name": "关闭恢复工单",
                  "assigneeRole": "auditor",
                  "phase": "关闭"
                }
              ],
              "transitions": [
                {
                  "from": "rec_detect_failure",
                  "to": "rec_retry_sync",
                  "condition": "异常可自动重试"
                },
                {
                  "from": "rec_detect_failure",
                  "to": "rec_manual_reconcile",
                  "condition": "发现授权账实不一致"
                },
                {
                  "from": "rec_retry_sync",
                  "to": "rec_restore_service",
                  "condition": "缓存重建成功"
                },
                {
                  "from": "rec_retry_sync",
                  "to": "rec_manual_reconcile",
                  "condition": "重试仍失败"
                },
                {
                  "from": "rec_manual_reconcile",
                  "to": "rec_retry_sync",
                  "condition": "差异修正后再次同步"
                },
                {
                  "from": "rec_restore_service",
                  "to": "rec_close_incident",
                  "condition": "访问校验通过"
                },
                {
                  "from": "rec_restore_service",
                  "to": "rec_manual_reconcile",
                  "condition": "仍存在漏授权或越权"
                }
              ]
            }
          ]
        }
      },
      "page": {
        "evidencePresent": true,
        "evidenceRef": "evidence:page:llm-linkage-page",
        "path": "skills/page/closure-evidence.json",
        "artifactId": "llm-linkage-page",
        "digest": "6f3f92be15d2c1c5",
        "modelSection": {
          "pages": [
            {
              "id": "page_access_request_kanban",
              "name": "权限申请看板",
              "kind": "kanban",
              "statusField": "access_request.status",
              "fieldBindings": [
                "access_request.request_no",
                "access_request.requester_ref",
                "access_request.target_user_ref",
                "access_request.requested_role_ref",
                "access_request.requested_scope_ref",
                "access_request.business_reason",
                "access_request.risk_summary",
                "access_request.approval_note",
                "access_request.status",
                "access_request.created_at"
              ],
              "actionPermissions": [
                "access_request:create",
                "access_request:read",
                "access_request:review",
                "access_request:provision"
              ]
            },
            {
              "id": "page_role_permission_workbench",
              "name": "角色权限配置台",
              "kind": "workbench",
              "fieldBindings": [
                "role_profile.role_code",
                "role_profile.role_name",
                "role_profile.role_type",
                "role_profile.owner_department",
                "role_profile.role_status",
                "permission_item.permission_code",
                "permission_item.permission_name",
                "permission_item.resource_type",
                "permission_item.sensitivity_level",
                "permission_item.permission_status",
                "menu_resource.menu_code",
                "menu_resource.menu_name",
                "menu_resource.parent_menu",
                "menu_resource.bound_permission",
                "menu_resource.menu_status"
              ],
              "actionPermissions": [
                "role_profile:read",
                "role_profile:manage",
                "permission_item:read",
                "permission_item:manage",
                "menu_resource:read",
                "menu_resource:manage"
              ]
            },
            {
              "id": "page_data_scope_workbench",
              "name": "数据范围策略台",
              "kind": "workbench",
              "fieldBindings": [
                "data_scope_policy.policy_name",
                "data_scope_policy.scope_type",
                "data_scope_policy.scope_rule",
                "data_scope_policy.risk_score",
                "data_scope_policy.policy_status",
                "role_assignment.user_ref",
                "role_assignment.role_ref",
                "role_assignment.data_scope_ref",
                "role_assignment.valid_from",
                "role_assignment.valid_to",
                "role_assignment.assignment_status"
              ],
              "actionPermissions": [
                "data_scope_policy:read",
                "data_scope_policy:manage",
                "role_assignment:read",
                "role_assignment:revoke"
              ]
            },
            {
              "id": "page_user_account_workbench",
              "name": "用户账号管理",
              "kind": "workbench",
              "fieldBindings": [
                "user_account.username",
                "user_account.display_name",
                "user_account.mobile",
                "user_account.department",
                "user_account.account_status",
                "user_account.last_login_at"
              ],
              "actionPermissions": [
                "role_assignment:read",
                "access_request:create",
                "access_request:read"
              ]
            },
            {
              "id": "page_audit_dashboard",
              "name": "权限审计看板",
              "kind": "dashboard",
              "fieldBindings": [
                "audit_log.actor_ref",
                "audit_log.target_entity",
                "audit_log.target_id",
                "audit_log.operation",
                "audit_log.result",
                "audit_log.occurred_at",
                "role_assignment.assignment_status",
                "data_scope_policy.scope_type"
              ],
              "actionPermissions": [
                "audit_log:read",
                "audit_log:export",
                "role_assignment:read"
              ],
              "stats": [
                {
                  "id": "stat_audit_events",
                  "name": "审计事件数",
                  "entity": "audit_log",
                  "metric": "count",
                  "format": "number"
                },
                {
                  "id": "stat_active_assignments",
                  "name": "授权记录数",
                  "entity": "role_assignment",
                  "metric": "count",
                  "format": "number"
                },
                {
                  "id": "stat_avg_scope_risk",
                  "name": "平均范围风险",
                  "entity": "data_scope_policy",
                  "metric": "avg:data_scope_policy.risk_score",
                  "format": "number"
                }
              ],
              "charts": [
                {
                  "id": "chart_operations_by_type",
                  "name": "操作动作分布",
                  "type": "bar",
                  "dimension": "audit_log.operation",
                  "metric": "count"
                },
                {
                  "id": "chart_scope_type_share",
                  "name": "数据范围类型占比",
                  "type": "pie",
                  "dimension": "data_scope_policy.scope_type",
                  "metric": "count"
                }
              ]
            }
          ]
        }
      },
      "aigc": {
        "evidencePresent": true,
        "evidenceRef": "evidence:aigc:llm-linkage-aigc",
        "path": "skills/aigc/closure-evidence.json",
        "artifactId": "llm-linkage-aigc",
        "digest": "c7c312869c975413",
        "modelSection": {
          "capabilities": [
            {
              "id": "cap_analyze_access_risk",
              "name": "权限申请风险摘要生成",
              "inputFields": [
                "access_request.business_reason",
                "access_request.requested_role_ref",
                "access_request.requested_scope_ref"
              ],
              "outputField": "access_request.risk_summary",
              "roleRefs": [
                "approver",
                "security_admin"
              ]
            },
            {
              "id": "cap_recommend_scope_rule",
              "name": "数据范围规则建议",
              "inputFields": [
                "access_request.risk_summary",
                "data_scope_policy.scope_type",
                "data_scope_policy.risk_score"
              ],
              "outputField": "data_scope_policy.scope_rule",
              "roleRefs": [
                "security_admin",
                "org_admin"
              ]
            },
            {
              "id": "cap_generate_approval_note",
              "name": "审批意见草拟",
              "inputFields": [
                "data_scope_policy.scope_rule",
                "access_request.risk_summary",
                "access_request.business_reason"
              ],
              "outputField": "access_request.approval_note",
              "roleRefs": [
                "approver",
                "org_admin"
              ]
            },
            {
              "id": "cap_summarize_audit_log",
              "name": "审计日志异常摘要",
              "inputFields": [
                "audit_log.operation",
                "audit_log.result",
                "audit_log.target_entity"
              ],
              "outputField": "access_request.risk_summary",
              "roleRefs": [
                "auditor"
              ]
            }
          ],
          "pipelines": [
            {
              "id": "pipeline_access_request_review",
              "name": "权限申请智能评审编排",
              "steps": [
                "cap_analyze_access_risk",
                "cap_recommend_scope_rule",
                "cap_generate_approval_note"
              ]
            }
          ]
        }
      },
      "appbundle": {
        "evidencePresent": true,
        "evidenceRef": "evidence:appbundle:llm-linkage-appbundle",
        "path": "skills/appbundle/closure-evidence.json",
        "artifactId": "llm-linkage-appbundle",
        "digest": "5a2cdd96073191bc",
        "modelSection": {
          "pageBindings": [
            {
              "pageRef": "page_access_request_kanban",
              "workflowRef": "access_request_lifecycle"
            },
            {
              "pageRef": "page_role_permission_workbench",
              "workflowRef": "gov_submit_change"
            },
            {
              "pageRef": "page_data_scope_workbench",
              "workflowRef": "role_policy_governance"
            },
            {
              "pageRef": "page_user_account_workbench",
              "workflowRef": "ar_draft"
            },
            {
              "pageRef": "page_audit_dashboard",
              "workflowRef": "rec_close_incident"
            }
          ],
          "roleRefs": [
            "requester",
            "org_admin",
            "security_admin",
            "approver",
            "auditor"
          ],
          "dataModelRefs": [
            "user_account",
            "role_profile",
            "permission_item",
            "menu_resource",
            "data_scope_policy",
            "role_assignment",
            "access_request",
            "audit_log"
          ],
          "invariants": [
            {
              "id": "assignment_requires_completed_request",
              "statement": "任何角色授权记录变为生效中之前，必须存在已完成的权限申请单审批链路。",
              "systems": [
                "datamodel",
                "workflow",
                "page"
              ],
              "refs": [
                "role_assignment.assignment_status",
                "access_request.status",
                "ar_completed"
              ]
            },
            {
              "id": "high_scope_requires_security_review",
              "statement": "申请全部数据或高风险数据范围时，必须经过安全审批节点且不得由申请人直接生效。",
              "systems": [
                "datamodel",
                "workflow",
                "rbac"
              ],
              "refs": [
                "data_scope_policy.scope_type",
                "data_scope_policy.risk_score",
                "ar_security_review",
                "requester",
                "security_admin"
              ]
            },
            {
              "id": "permission_model_changes_governed",
              "statement": "角色、权限点、菜单资源和数据范围策略的管理操作必须先通过治理审批后才能发布。",
              "systems": [
                "datamodel",
                "rbac",
                "workflow"
              ],
              "refs": [
                "role_profile",
                "permission_item",
                "menu_resource",
                "data_scope_policy",
                "role_profile:manage",
                "permission_item:manage",
                "menu_resource:manage",
                "data_scope_policy:manage",
                "gov_publish"
              ]
            },
            {
              "id": "data_scope_not_broader_than_role",
              "statement": "授权记录绑定的数据范围不得宽于被授权角色在数据范围策略台中配置的范围规则。",
              "systems": [
                "datamodel",
                "page"
              ],
              "refs": [
                "role_assignment.role_ref",
                "role_assignment.data_scope_ref",
                "data_scope_policy.scope_rule",
                "page_data_scope_workbench"
              ]
            },
            {
              "id": "audit_log_for_every_grant_or_revoke",
              "statement": "每一次授权生效或撤权操作都必须产生一条成功或失败的权限审计日志。",
              "systems": [
                "datamodel",
                "rbac",
                "workflow"
              ],
              "refs": [
                "role_assignment.assignment_status",
                "audit_log.operation",
                "audit_log.result",
                "access_request:provision",
                "role_assignment:revoke",
                "ar_provision"
              ]
            },
            {
              "id": "ai_generated_review_is_not_final_approval",
              "statement": "AIGC 生成的风险摘要和审批意见只能作为辅助输入，最终审批必须由审批人角色在工作流节点上确认。",
              "systems": [
                "aigc",
                "workflow",
                "rbac",
                "datamodel"
              ],
              "refs": [
                "cap_analyze_access_risk",
                "cap_generate_approval_note",
                "access_request.risk_summary",
                "access_request.approval_note",
                "approver",
                "ar_security_review"
              ]
            },
            {
              "id": "sync_failure_requires_recovery_closure",
              "statement": "权限缓存同步失败后，只有恢复链路关闭并完成审计核对，相关异常申请才能再次进入生效节点。",
              "systems": [
                "workflow",
                "datamodel"
              ],
              "refs": [
                "rec_detect_failure",
                "rec_manual_reconcile",
                "rec_close_incident",
                "ar_provision",
                "audit_log.result"
              ]
            }
          ]
        }
      }
    },
    "topBlockers": [],
    "chatSummary": "闭环结论：**closed**，证据 **6/6**。当前方案已形成一版可落地的权限管理系统轮廓。\n\n现在这个应用能做：\n\n- 管理 **用户账号、角色、权限点、菜单资源、数据范围策略、角色授权、权限申请单、权限审计日志** 等 8 类核心对象。\n- 支持 **权限申请、审批、授权配置、数据范围配置、审计查看** 等流程。\n- 覆盖 5 类角色：申请人、组织管理员、安全管理员、审批人、审计员。\n- 提供 5 个页面：权限申请看板、角色权限配置台、数据范围策略台、用户账号管理、权限审计看板。\n- AI 可辅助生成权限申请风险摘要、数据范围规则建议、审批意见草稿、审计日志异常摘要。\n\n关键风险与分歧：\n\n- **权限粒度和模型边界仍需定准**：菜单、按钮、API、数据行是否都管，决定后续复杂度。\n- **数据范围是高风险点**：若只靠前端或零散 SQL 过滤，导出、批量接口、统计接口可能绕过限制。\n- **多角色数据范围规则未完全定案**：并集、交集或优先级会直接影响越权风险和用户体验。\n\n建议下一步：\n\n1. 先落地最小表结构与枚举：user、role、permission、department、user_role、role_permission、role_data_scope；数据范围先用 ALL、DEPT、DEPT_AND_CHILD、SELF、CUSTOM。\n2. 选一个真实业务列表接口做闭环验证：完成 RBAC 判断、数据范围过滤、无权限/跨部门访问拒绝、权限变更后的缓存生效测试。"
  },
  "chatSummary": "闭环结论：**closed**，证据 **6/6**。当前方案已形成一版可落地的权限管理系统轮廓。\n\n现在这个应用能做：\n\n- 管理 **用户账号、角色、权限点、菜单资源、数据范围策略、角色授权、权限申请单、权限审计日志** 等 8 类核心对象。\n- 支持 **权限申请、审批、授权配置、数据范围配置、审计查看** 等流程。\n- 覆盖 5 类角色：申请人、组织管理员、安全管理员、审批人、审计员。\n- 提供 5 个页面：权限申请看板、角色权限配置台、数据范围策略台、用户账号管理、权限审计看板。\n- AI 可辅助生成权限申请风险摘要、数据范围规则建议、审批意见草稿、审计日志异常摘要。\n\n关键风险与分歧：\n\n- **权限粒度和模型边界仍需定准**：菜单、按钮、API、数据行是否都管，决定后续复杂度。\n- **数据范围是高风险点**：若只靠前端或零散 SQL 过滤，导出、批量接口、统计接口可能绕过限制。\n- **多角色数据范围规则未完全定案**：并集、交集或优先级会直接影响越权风险和用户体验。\n\n建议下一步：\n\n1. 先落地最小表结构与枚举：user、role、permission、department、user_role、role_permission、role_data_scope；数据范围先用 ALL、DEPT、DEPT_AND_CHILD、SELF、CUSTOM。\n2. 选一个真实业务列表接口做闭环验证：完成 RBAC 判断、数据范围过滤、无权限/跨部门访问拒绝、权限变更后的缓存生效测试。"
};
