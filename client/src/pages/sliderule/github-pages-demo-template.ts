/**
 * GitHub Pages 演示模板 — 由真实 LLM 全程推演一次性捕获（2026-07-16，
 * gpt-5.5 · 新引擎：E17 证据上下文管道 + P2a 真搜索 + 轮内并行屏障），
 * 非手写数据。生成器：scripts/capture-pages-demo.mjs（一条命令重录）。
 *
 * 用途：Pages 静态演示没有后端，访客点「发送」后由
 * github-pages-demo-playback.ts 按本模板回放推演过程与发布闭环。
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
  "goal": "社区宠物医院预约问诊系统——预约、分诊、复诊提醒一体化",
  "skills": [
    {
      "skill": "dataModel",
      "label": "datamodel",
      "mermaid": "flowchart LR\n  datamodel[\"datamodel\"] -->|DM_RBAC_FIELD_POLICY_EVIDENCE| rbac[\"rbac\"]\n  datamodel[\"datamodel\"] -->|DM_PAGE_BINDING_IMPACT_EVIDENCE| page[\"page\"]",
      "modelSection": {
        "entities": [
          {
            "id": "pet_owner",
            "name": "宠物主人",
            "fields": [
              {
                "id": "name",
                "name": "主人姓名",
                "type": "string"
              },
              {
                "id": "phone",
                "name": "联系电话",
                "type": "string",
                "format": "masked"
              },
              {
                "id": "wechat_id",
                "name": "微信号",
                "type": "string",
                "format": "masked"
              },
              {
                "id": "membership_level",
                "name": "会员等级",
                "type": "enum",
                "options": [
                  {
                    "id": "normal",
                    "label": "普通",
                    "tone": "default"
                  },
                  {
                    "id": "silver",
                    "label": "银卡",
                    "tone": "processing"
                  },
                  {
                    "id": "gold",
                    "label": "金卡",
                    "tone": "success"
                  }
                ]
              }
            ]
          },
          {
            "id": "pet",
            "name": "宠物档案",
            "fields": [
              {
                "id": "owner_ref",
                "name": "所属主人",
                "type": "ref"
              },
              {
                "id": "pet_name",
                "name": "宠物名",
                "type": "string"
              },
              {
                "id": "species",
                "name": "物种",
                "type": "enum",
                "options": [
                  {
                    "id": "cat",
                    "label": "猫",
                    "tone": "default"
                  },
                  {
                    "id": "dog",
                    "label": "狗",
                    "tone": "default"
                  },
                  {
                    "id": "rabbit",
                    "label": "兔",
                    "tone": "default"
                  },
                  {
                    "id": "other",
                    "label": "其他",
                    "tone": "warning"
                  }
                ]
              },
              {
                "id": "breed",
                "name": "品种",
                "type": "string"
              },
              {
                "id": "age_years",
                "name": "年龄",
                "type": "number"
              },
              {
                "id": "neuter_status",
                "name": "绝育状态",
                "type": "enum",
                "options": [
                  {
                    "id": "unknown",
                    "label": "未知",
                    "tone": "default"
                  },
                  {
                    "id": "not_neutered",
                    "label": "未绝育",
                    "tone": "warning"
                  },
                  {
                    "id": "neutered",
                    "label": "已绝育",
                    "tone": "success"
                  }
                ]
              }
            ]
          },
          {
            "id": "appointment",
            "name": "预约问诊",
            "fields": [
              {
                "id": "owner_ref",
                "name": "预约主人",
                "type": "ref"
              },
              {
                "id": "pet_ref",
                "name": "就诊宠物",
                "type": "ref"
              },
              {
                "id": "scheduled_at",
                "name": "预约时间",
                "type": "date"
              },
              {
                "id": "reason",
                "name": "主诉原因",
                "type": "string"
              },
              {
                "id": "status",
                "name": "预约状态",
                "type": "enum",
                "options": [
                  {
                    "id": "draft",
                    "label": "待确认",
                    "tone": "default"
                  },
                  {
                    "id": "confirmed",
                    "label": "已确认",
                    "tone": "processing"
                  },
                  {
                    "id": "triaged",
                    "label": "已分诊",
                    "tone": "processing"
                  },
                  {
                    "id": "consulting",
                    "label": "问诊中",
                    "tone": "processing"
                  },
                  {
                    "id": "completed",
                    "label": "已完成",
                    "tone": "success"
                  },
                  {
                    "id": "cancelled",
                    "label": "已取消",
                    "tone": "danger"
                  }
                ]
              },
              {
                "id": "triage_level",
                "name": "分诊等级",
                "type": "enum",
                "options": [
                  {
                    "id": "routine",
                    "label": "常规",
                    "tone": "default"
                  },
                  {
                    "id": "priority",
                    "label": "优先",
                    "tone": "warning"
                  },
                  {
                    "id": "emergency",
                    "label": "急诊",
                    "tone": "danger"
                  }
                ]
              },
              {
                "id": "consult_fee",
                "name": "问诊费",
                "type": "number",
                "format": "money"
              },
              {
                "id": "wait_minutes",
                "name": "等待分钟",
                "type": "number"
              }
            ]
          },
          {
            "id": "triage_record",
            "name": "分诊记录",
            "fields": [
              {
                "id": "appointment_ref",
                "name": "关联预约",
                "type": "ref"
              },
              {
                "id": "temperature",
                "name": "体温",
                "type": "number"
              },
              {
                "id": "weight_kg",
                "name": "体重公斤",
                "type": "number"
              },
              {
                "id": "symptom_notes",
                "name": "症状记录",
                "type": "string"
              },
              {
                "id": "ai_triage_suggestion",
                "name": "AI分诊建议",
                "type": "string"
              },
              {
                "id": "risk_level",
                "name": "风险等级",
                "type": "enum",
                "options": [
                  {
                    "id": "low",
                    "label": "低风险",
                    "tone": "success"
                  },
                  {
                    "id": "medium",
                    "label": "中风险",
                    "tone": "warning"
                  },
                  {
                    "id": "high",
                    "label": "高风险",
                    "tone": "danger"
                  }
                ]
              }
            ]
          },
          {
            "id": "medical_record",
            "name": "门诊病例",
            "fields": [
              {
                "id": "appointment_ref",
                "name": "关联预约",
                "type": "ref"
              },
              {
                "id": "veterinarian_ref",
                "name": "接诊兽医",
                "type": "ref"
              },
              {
                "id": "transcript_text",
                "name": "问诊转写文本",
                "type": "string"
              },
              {
                "id": "soap_summary",
                "name": "SOAP结构化病例",
                "type": "string"
              },
              {
                "id": "diagnosis",
                "name": "诊断结论",
                "type": "string"
              },
              {
                "id": "audit_status",
                "name": "病例审核状态",
                "type": "enum",
                "options": [
                  {
                    "id": "draft",
                    "label": "草稿",
                    "tone": "default"
                  },
                  {
                    "id": "submitted",
                    "label": "待审核",
                    "tone": "warning"
                  },
                  {
                    "id": "approved",
                    "label": "已通过",
                    "tone": "success"
                  },
                  {
                    "id": "returned",
                    "label": "已退回",
                    "tone": "danger"
                  }
                ]
              },
              {
                "id": "quality_score",
                "name": "病例质量分",
                "type": "number",
                "format": "score"
              }
            ]
          },
          {
            "id": "followup_plan",
            "name": "复诊提醒计划",
            "fields": [
              {
                "id": "appointment_ref",
                "name": "来源预约",
                "type": "ref"
              },
              {
                "id": "pet_ref",
                "name": "复诊宠物",
                "type": "ref"
              },
              {
                "id": "due_date",
                "name": "复诊日期",
                "type": "date"
              },
              {
                "id": "reminder_content",
                "name": "提醒内容",
                "type": "string"
              },
              {
                "id": "reminder_status",
                "name": "提醒状态",
                "type": "enum",
                "options": [
                  {
                    "id": "pending",
                    "label": "待发送",
                    "tone": "warning"
                  },
                  {
                    "id": "sent",
                    "label": "已发送",
                    "tone": "success"
                  },
                  {
                    "id": "failed",
                    "label": "发送失败",
                    "tone": "danger"
                  },
                  {
                    "id": "confirmed",
                    "label": "已确认复诊",
                    "tone": "success"
                  }
                ]
              }
            ]
          },
          {
            "id": "payment",
            "name": "问诊支付",
            "fields": [
              {
                "id": "appointment_ref",
                "name": "关联预约",
                "type": "ref"
              },
              {
                "id": "amount",
                "name": "支付金额",
                "type": "number",
                "format": "money"
              },
              {
                "id": "payment_status",
                "name": "支付状态",
                "type": "enum",
                "options": [
                  {
                    "id": "unpaid",
                    "label": "未支付",
                    "tone": "warning"
                  },
                  {
                    "id": "paid",
                    "label": "已支付",
                    "tone": "success"
                  },
                  {
                    "id": "refunding",
                    "label": "退款中",
                    "tone": "processing"
                  },
                  {
                    "id": "refunded",
                    "label": "已退款",
                    "tone": "default"
                  },
                  {
                    "id": "failed",
                    "label": "支付失败",
                    "tone": "danger"
                  }
                ]
              },
              {
                "id": "paid_at",
                "name": "支付时间",
                "type": "date"
              },
              {
                "id": "gateway_trade_no",
                "name": "支付网关单号",
                "type": "string"
              }
            ]
          },
          {
            "id": "reminder_log",
            "name": "提醒发送日志",
            "fields": [
              {
                "id": "followup_plan_ref",
                "name": "关联复诊计划",
                "type": "ref"
              },
              {
                "id": "sent_at",
                "name": "发送时间",
                "type": "date"
              },
              {
                "id": "channel",
                "name": "发送渠道",
                "type": "enum",
                "options": [
                  {
                    "id": "sms",
                    "label": "短信",
                    "tone": "default"
                  },
                  {
                    "id": "wechat",
                    "label": "微信",
                    "tone": "success"
                  },
                  {
                    "id": "phone",
                    "label": "电话",
                    "tone": "processing"
                  }
                ]
              },
              {
                "id": "delivery_status",
                "name": "送达状态",
                "type": "enum",
                "options": [
                  {
                    "id": "queued",
                    "label": "排队中",
                    "tone": "processing"
                  },
                  {
                    "id": "delivered",
                    "label": "已送达",
                    "tone": "success"
                  },
                  {
                    "id": "bounced",
                    "label": "退信",
                    "tone": "danger"
                  }
                ]
              },
              {
                "id": "retry_count",
                "name": "重试次数",
                "type": "number"
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
          "receptionist",
          "triage_nurse",
          "veterinarian",
          "finance_clerk",
          "clinic_manager",
          "ops_staff"
        ],
        "permissions": [
          "owner:read",
          "pet:read",
          "appointment:create",
          "appointment:read",
          "appointment:update",
          "appointment:cancel",
          "triage:read",
          "triage:update",
          "record:read",
          "record:write",
          "record:audit",
          "followup:read",
          "followup:create",
          "followup:update",
          "payment:read",
          "payment:confirm",
          "payment:refund",
          "reminder:retry",
          "dashboard:view",
          "ai:run"
        ],
        "menus": [
          {
            "id": "front_desk_menu",
            "label": "前台预约台",
            "roleRefs": [
              "receptionist"
            ],
            "permissionRefs": [
              "owner:read",
              "pet:read",
              "appointment:create",
              "appointment:read",
              "appointment:update",
              "appointment:cancel",
              "payment:read"
            ]
          },
          {
            "id": "triage_menu",
            "label": "护士分诊台",
            "roleRefs": [
              "triage_nurse"
            ],
            "permissionRefs": [
              "appointment:read",
              "triage:read",
              "triage:update",
              "ai:run"
            ]
          },
          {
            "id": "doctor_menu",
            "label": "兽医问诊台",
            "roleRefs": [
              "veterinarian"
            ],
            "permissionRefs": [
              "appointment:read",
              "triage:read",
              "record:read",
              "record:write",
              "followup:read",
              "followup:create",
              "followup:update",
              "ai:run"
            ]
          },
          {
            "id": "finance_menu",
            "label": "财务支付台",
            "roleRefs": [
              "finance_clerk"
            ],
            "permissionRefs": [
              "payment:read",
              "payment:confirm",
              "payment:refund"
            ]
          },
          {
            "id": "manager_menu",
            "label": "院长质控台",
            "roleRefs": [
              "clinic_manager"
            ],
            "permissionRefs": [
              "record:read",
              "record:audit",
              "dashboard:view",
              "appointment:read",
              "followup:read",
              "payment:read"
            ]
          },
          {
            "id": "ops_menu",
            "label": "运营提醒台",
            "roleRefs": [
              "ops_staff"
            ],
            "permissionRefs": [
              "followup:read",
              "followup:update",
              "reminder:retry",
              "dashboard:view"
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
        "id": "appointment_lifecycle",
        "name": "预约问诊生命周期",
        "nodes": [
          {
            "id": "appt_submit",
            "name": "提交预约",
            "assigneeRole": "receptionist",
            "phase": "预约"
          },
          {
            "id": "appt_confirm",
            "name": "确认档期与宠物信息",
            "assigneeRole": "receptionist",
            "phase": "预约"
          },
          {
            "id": "appt_cancelled",
            "name": "取消预约",
            "assigneeRole": "receptionist",
            "phase": "预约"
          },
          {
            "id": "triage_assess",
            "name": "护士分诊评估",
            "assigneeRole": "triage_nurse",
            "phase": "分诊"
          },
          {
            "id": "vet_consult",
            "name": "兽医问诊",
            "assigneeRole": "veterinarian",
            "phase": "问诊"
          },
          {
            "id": "emergency_transfer",
            "name": "急诊转处置",
            "assigneeRole": "veterinarian",
            "phase": "问诊"
          },
          {
            "id": "record_complete",
            "name": "完成病例",
            "assigneeRole": "veterinarian",
            "phase": "问诊"
          },
          {
            "id": "followup_schedule",
            "name": "制定复诊提醒",
            "assigneeRole": "veterinarian",
            "phase": "复诊"
          },
          {
            "id": "case_closed",
            "name": "问诊归档",
            "assigneeRole": "receptionist",
            "phase": "复诊"
          }
        ],
        "transitions": [
          {
            "from": "appt_submit",
            "to": "appt_confirm",
            "condition": "资料完整"
          },
          {
            "from": "appt_confirm",
            "to": "appt_cancelled",
            "condition": "主人取消或档期不可用"
          },
          {
            "from": "appt_confirm",
            "to": "triage_assess",
            "condition": "到院或线上签到"
          },
          {
            "from": "triage_assess",
            "to": "appt_confirm",
            "condition": "宠物信息缺失需补充"
          },
          {
            "from": "triage_assess",
            "to": "vet_consult",
            "condition": "常规或优先问诊"
          },
          {
            "from": "triage_assess",
            "to": "emergency_transfer",
            "condition": "急诊等级"
          },
          {
            "from": "emergency_transfer",
            "to": "vet_consult",
            "condition": "生命体征稳定后补问诊"
          },
          {
            "from": "vet_consult",
            "to": "record_complete",
            "condition": "问诊结束"
          },
          {
            "from": "record_complete",
            "to": "vet_consult",
            "condition": "病例信息不完整"
          },
          {
            "from": "record_complete",
            "to": "followup_schedule",
            "condition": "需要复诊"
          },
          {
            "from": "record_complete",
            "to": "case_closed",
            "condition": "无需复诊"
          },
          {
            "from": "followup_schedule",
            "to": "case_closed",
            "condition": "提醒计划已生成"
          }
        ],
        "chains": [
          {
            "id": "consult_payment_chain",
            "name": "问诊费支付入账链",
            "kind": "money",
            "nodes": [
              {
                "id": "pay_order_create",
                "name": "生成问诊费账单",
                "assigneeRole": "receptionist",
                "phase": "计费"
              },
              {
                "id": "pay_owner_pay",
                "name": "主人支付",
                "assigneeRole": "receptionist",
                "phase": "支付"
              },
              {
                "id": "pay_callback_verify",
                "name": "服务端核验回调",
                "assigneeRole": "finance_clerk",
                "phase": "支付"
              },
              {
                "id": "pay_failed",
                "name": "支付失败处理",
                "assigneeRole": "finance_clerk",
                "phase": "支付"
              },
              {
                "id": "pay_ledger_post",
                "name": "入账留痕",
                "assigneeRole": "finance_clerk",
                "phase": "入账"
              },
              {
                "id": "pay_refund_review",
                "name": "退款复核",
                "assigneeRole": "clinic_manager",
                "phase": "入账"
              }
            ],
            "transitions": [
              {
                "from": "pay_order_create",
                "to": "pay_owner_pay",
                "condition": "账单金额确认"
              },
              {
                "from": "pay_owner_pay",
                "to": "pay_callback_verify",
                "condition": "收到支付网关通知"
              },
              {
                "from": "pay_callback_verify",
                "to": "pay_ledger_post",
                "condition": "签名与金额一致"
              },
              {
                "from": "pay_callback_verify",
                "to": "pay_failed",
                "condition": "签名错误或金额不一致"
              },
              {
                "from": "pay_failed",
                "to": "pay_owner_pay",
                "condition": "允许重新支付"
              },
              {
                "from": "pay_ledger_post",
                "to": "pay_refund_review",
                "condition": "预约取消且符合退款规则"
              },
              {
                "from": "pay_refund_review",
                "to": "pay_ledger_post",
                "condition": "退款完成后补记负向流水"
              }
            ]
          },
          {
            "id": "record_governance_chain",
            "name": "病例质控审核链",
            "kind": "governance",
            "nodes": [
              {
                "id": "record_submit_audit",
                "name": "提交病例审核",
                "assigneeRole": "veterinarian",
                "phase": "提交"
              },
              {
                "id": "record_quality_review",
                "name": "院长质控审核",
                "assigneeRole": "clinic_manager",
                "phase": "审核"
              },
              {
                "id": "record_return_fix",
                "name": "退回修订病例",
                "assigneeRole": "veterinarian",
                "phase": "审核"
              },
              {
                "id": "record_approved_archive",
                "name": "病例审核归档",
                "assigneeRole": "clinic_manager",
                "phase": "归档"
              }
            ],
            "transitions": [
              {
                "from": "record_submit_audit",
                "to": "record_quality_review",
                "condition": "病例质量分达到提交线"
              },
              {
                "from": "record_quality_review",
                "to": "record_approved_archive",
                "condition": "审核通过"
              },
              {
                "from": "record_quality_review",
                "to": "record_return_fix",
                "condition": "诊断或用药记录不完整"
              },
              {
                "from": "record_return_fix",
                "to": "record_submit_audit",
                "condition": "兽医修订后重新提交"
              }
            ]
          },
          {
            "id": "reminder_recovery_chain",
            "name": "复诊提醒失败恢复链",
            "kind": "recovery",
            "nodes": [
              {
                "id": "reminder_detect_failure",
                "name": "检测提醒失败",
                "assigneeRole": "ops_staff",
                "phase": "检测"
              },
              {
                "id": "reminder_auto_retry",
                "name": "自动切换渠道重试",
                "assigneeRole": "ops_staff",
                "phase": "重试"
              },
              {
                "id": "reminder_manual_call",
                "name": "人工电话确认",
                "assigneeRole": "receptionist",
                "phase": "重试"
              },
              {
                "id": "reminder_closed",
                "name": "关闭提醒工单",
                "assigneeRole": "ops_staff",
                "phase": "闭环"
              }
            ],
            "transitions": [
              {
                "from": "reminder_detect_failure",
                "to": "reminder_auto_retry",
                "condition": "重试次数小于3次"
              },
              {
                "from": "reminder_detect_failure",
                "to": "reminder_manual_call",
                "condition": "连续退信或电话优先客户"
              },
              {
                "from": "reminder_auto_retry",
                "to": "reminder_closed",
                "condition": "送达成功"
              },
              {
                "from": "reminder_auto_retry",
                "to": "reminder_manual_call",
                "condition": "重试后仍失败"
              },
              {
                "from": "reminder_manual_call",
                "to": "reminder_detect_failure",
                "condition": "号码错误需回到检测更新资料"
              },
              {
                "from": "reminder_manual_call",
                "to": "reminder_closed",
                "condition": "主人已确认复诊"
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
            "id": "appointment_kanban",
            "name": "预约流转看板",
            "kind": "kanban",
            "statusField": "appointment.status",
            "fieldBindings": [
              "appointment.owner_ref",
              "appointment.pet_ref",
              "appointment.scheduled_at",
              "appointment.reason",
              "appointment.status",
              "appointment.triage_level",
              "appointment.consult_fee"
            ],
            "actionPermissions": [
              "appointment:create",
              "appointment:read",
              "appointment:update",
              "appointment:cancel"
            ]
          },
          {
            "id": "schedule_calendar",
            "name": "预约排班日历",
            "kind": "calendar",
            "dateField": "appointment.scheduled_at",
            "colorBy": "appointment.triage_level",
            "fieldBindings": [
              "appointment.scheduled_at",
              "appointment.status",
              "appointment.triage_level",
              "pet.pet_name",
              "pet.species",
              "pet_owner.name",
              "pet_owner.phone"
            ],
            "actionPermissions": [
              "appointment:read",
              "appointment:update",
              "owner:read",
              "pet:read"
            ]
          },
          {
            "id": "triage_workbench",
            "name": "护士分诊工作台",
            "kind": "workbench",
            "fieldBindings": [
              "triage_record.appointment_ref",
              "triage_record.temperature",
              "triage_record.weight_kg",
              "triage_record.symptom_notes",
              "triage_record.ai_triage_suggestion",
              "triage_record.risk_level",
              "appointment.reason",
              "appointment.triage_level"
            ],
            "actionPermissions": [
              "triage:read",
              "triage:update",
              "appointment:read",
              "ai:run"
            ]
          },
          {
            "id": "doctor_consult_workbench",
            "name": "兽医问诊工作台",
            "kind": "workbench",
            "fieldBindings": [
              "medical_record.appointment_ref",
              "medical_record.transcript_text",
              "medical_record.soap_summary",
              "medical_record.diagnosis",
              "medical_record.audit_status",
              "medical_record.quality_score",
              "followup_plan.due_date",
              "followup_plan.reminder_content"
            ],
            "actionPermissions": [
              "record:read",
              "record:write",
              "followup:read",
              "followup:create",
              "followup:update",
              "ai:run"
            ]
          },
          {
            "id": "followup_ops_workbench",
            "name": "复诊提醒运营台",
            "kind": "workbench",
            "fieldBindings": [
              "followup_plan.appointment_ref",
              "followup_plan.pet_ref",
              "followup_plan.due_date",
              "followup_plan.reminder_content",
              "followup_plan.reminder_status",
              "reminder_log.channel",
              "reminder_log.delivery_status",
              "reminder_log.retry_count"
            ],
            "actionPermissions": [
              "followup:read",
              "followup:update",
              "reminder:retry"
            ]
          },
          {
            "id": "finance_workbench",
            "name": "问诊收费台",
            "kind": "dashboard",
            "fieldBindings": [
              "payment.appointment_ref",
              "payment.amount",
              "payment.payment_status",
              "payment.paid_at",
              "payment.gateway_trade_no",
              "appointment.consult_fee"
            ],
            "actionPermissions": [
              "payment:read",
              "payment:confirm",
              "payment:refund"
            ],
            "stats": [
              {
                "id": "paid_amount",
                "name": "已收问诊费",
                "entity": "payment",
                "metric": "sum:payment.amount",
                "format": "money"
              },
              {
                "id": "payment_orders",
                "name": "支付单数",
                "entity": "payment",
                "metric": "count",
                "format": "number"
              },
              {
                "id": "avg_fee",
                "name": "平均问诊费",
                "entity": "appointment",
                "metric": "avg:appointment.consult_fee",
                "format": "money"
              }
            ],
            "charts": [
              {
                "id": "payment_status_share",
                "name": "支付状态分布",
                "type": "pie",
                "dimension": "payment.payment_status",
                "metric": "count"
              },
              {
                "id": "fee_by_triage",
                "name": "分诊等级收入",
                "type": "bar",
                "dimension": "appointment.triage_level",
                "metric": "sum:appointment.consult_fee"
              }
            ]
          },
          {
            "id": "clinic_dashboard",
            "name": "医院运营总览",
            "kind": "dashboard",
            "fieldBindings": [
              "appointment.status",
              "appointment.wait_minutes",
              "triage_record.risk_level",
              "medical_record.audit_status",
              "followup_plan.reminder_status",
              "reminder_log.delivery_status"
            ],
            "actionPermissions": [
              "dashboard:view",
              "appointment:read",
              "record:read",
              "followup:read",
              "payment:read"
            ],
            "stats": [
              {
                "id": "today_appointments",
                "name": "预约总量",
                "entity": "appointment",
                "metric": "count",
                "format": "number"
              },
              {
                "id": "avg_wait",
                "name": "平均等待分钟",
                "entity": "appointment",
                "metric": "avg:appointment.wait_minutes",
                "format": "number"
              },
              {
                "id": "followup_pending",
                "name": "复诊计划数",
                "entity": "followup_plan",
                "metric": "count",
                "format": "number"
              },
              {
                "id": "record_quality",
                "name": "平均病例质量分",
                "entity": "medical_record",
                "metric": "avg:medical_record.quality_score",
                "format": "number"
              }
            ],
            "charts": [
              {
                "id": "appointment_status_bar",
                "name": "预约状态对比",
                "type": "bar",
                "dimension": "appointment.status",
                "metric": "count"
              },
              {
                "id": "risk_level_pie",
                "name": "分诊风险占比",
                "type": "pie",
                "dimension": "triage_record.risk_level",
                "metric": "count"
              }
            ]
          },
          {
            "id": "record_audit_workbench",
            "name": "病例质控审核台",
            "kind": "workbench",
            "fieldBindings": [
              "medical_record.appointment_ref",
              "medical_record.veterinarian_ref",
              "medical_record.soap_summary",
              "medical_record.diagnosis",
              "medical_record.audit_status",
              "medical_record.quality_score"
            ],
            "actionPermissions": [
              "record:read",
              "record:audit"
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
            "id": "ai_triage_suggestion",
            "name": "主诉智能分诊建议",
            "inputFields": [
              "appointment.reason",
              "pet.species",
              "pet.age_years",
              "triage_record.symptom_notes"
            ],
            "outputField": "triage_record.ai_triage_suggestion",
            "roleRefs": [
              "triage_nurse",
              "veterinarian"
            ]
          },
          {
            "id": "ai_dialog_transcription",
            "name": "问诊对话转写",
            "inputFields": [
              "appointment.reason",
              "triage_record.symptom_notes"
            ],
            "outputField": "medical_record.transcript_text",
            "roleRefs": [
              "veterinarian"
            ]
          },
          {
            "id": "ai_soap_summary",
            "name": "生成SOAP结构化病例",
            "inputFields": [
              "medical_record.transcript_text",
              "triage_record.ai_triage_suggestion"
            ],
            "outputField": "medical_record.soap_summary",
            "roleRefs": [
              "veterinarian"
            ]
          },
          {
            "id": "ai_followup_reminder",
            "name": "生成复诊提醒文案",
            "inputFields": [
              "medical_record.soap_summary",
              "medical_record.diagnosis",
              "followup_plan.due_date"
            ],
            "outputField": "followup_plan.reminder_content",
            "roleRefs": [
              "veterinarian",
              "ops_staff"
            ]
          }
        ],
        "pipelines": [
          {
            "id": "consult_record_pipeline",
            "name": "问诊转写到病例生成",
            "steps": [
              "ai_dialog_transcription",
              "ai_soap_summary",
              "ai_followup_reminder"
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
            "pageRef": "appointment_kanban",
            "workflowRef": "appointment_lifecycle"
          },
          {
            "pageRef": "schedule_calendar",
            "workflowRef": "appt_confirm"
          },
          {
            "pageRef": "triage_workbench",
            "workflowRef": "triage_assess"
          },
          {
            "pageRef": "doctor_consult_workbench",
            "workflowRef": "vet_consult"
          },
          {
            "pageRef": "followup_ops_workbench",
            "workflowRef": "reminder_detect_failure"
          },
          {
            "pageRef": "finance_workbench",
            "workflowRef": "pay_callback_verify"
          },
          {
            "pageRef": "clinic_dashboard",
            "workflowRef": "case_closed"
          },
          {
            "pageRef": "record_audit_workbench",
            "workflowRef": "record_quality_review"
          }
        ],
        "roleRefs": [
          "receptionist",
          "triage_nurse",
          "veterinarian",
          "finance_clerk",
          "clinic_manager",
          "ops_staff"
        ],
        "dataModelRefs": [
          "pet_owner",
          "pet",
          "appointment",
          "triage_record",
          "medical_record",
          "followup_plan",
          "payment",
          "reminder_log"
        ],
        "invariants": [
          {
            "id": "triage_before_consult",
            "statement": "除急诊转处置外，兽医问诊必须在护士完成分诊评估之后开始。",
            "systems": [
              "workflow",
              "datamodel"
            ],
            "refs": [
              "triage_assess",
              "vet_consult",
              "emergency_transfer",
              "appointment.triage_level"
            ]
          },
          {
            "id": "payment_callback_source_of_truth",
            "statement": "支付状态只能由服务端核验回调或财务退款复核节点改变，前台页面不得直接标记为已支付。",
            "systems": [
              "datamodel",
              "workflow",
              "rbac",
              "page"
            ],
            "refs": [
              "payment.payment_status",
              "pay_callback_verify",
              "pay_refund_review",
              "payment:confirm",
              "payment:refund"
            ]
          },
          {
            "id": "record_requires_appointment",
            "statement": "每份门诊病例必须关联一个已进入问诊或已完成状态的预约。",
            "systems": [
              "datamodel",
              "workflow"
            ],
            "refs": [
              "medical_record.appointment_ref",
              "appointment.status",
              "vet_consult",
              "record_complete"
            ]
          },
          {
            "id": "followup_requires_diagnosis",
            "statement": "复诊提醒计划必须在病例存在诊断结论后才能生成并发送。",
            "systems": [
              "datamodel",
              "workflow",
              "aigc"
            ],
            "refs": [
              "followup_plan.reminder_content",
              "medical_record.diagnosis",
              "followup_schedule",
              "ai_followup_reminder"
            ]
          },
          {
            "id": "failed_reminder_must_have_log",
            "statement": "任何发送失败的复诊提醒都必须保留提醒发送日志并进入失败恢复链。",
            "systems": [
              "datamodel",
              "workflow",
              "page"
            ],
            "refs": [
              "followup_plan.reminder_status",
              "reminder_log.delivery_status",
              "reminder_detect_failure",
              "reminder:retry"
            ]
          },
          {
            "id": "audit_before_archive",
            "statement": "病例归档前必须经过院长质控审核通过，不得直接从草稿归档。",
            "systems": [
              "datamodel",
              "workflow",
              "rbac"
            ],
            "refs": [
              "medical_record.audit_status",
              "record_quality_review",
              "record_approved_archive",
              "clinic_manager",
              "record:audit"
            ]
          },
          {
            "id": "owner_contact_masked",
            "statement": "宠物主人手机号和微信号在非联系场景必须以脱敏格式展示。",
            "systems": [
              "datamodel",
              "page",
              "rbac"
            ],
            "refs": [
              "pet_owner.phone",
              "pet_owner.wechat_id",
              "owner:read",
              "schedule_calendar"
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
    "closureHash": "dcebe941",
    "stableDigest": "9c98fbec",
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
              "id": "pet_owner",
              "name": "宠物主人",
              "fields": [
                {
                  "id": "name",
                  "name": "主人姓名",
                  "type": "string"
                },
                {
                  "id": "phone",
                  "name": "联系电话",
                  "type": "string",
                  "format": "masked"
                },
                {
                  "id": "wechat_id",
                  "name": "微信号",
                  "type": "string",
                  "format": "masked"
                },
                {
                  "id": "membership_level",
                  "name": "会员等级",
                  "type": "enum",
                  "options": [
                    {
                      "id": "normal",
                      "label": "普通",
                      "tone": "default"
                    },
                    {
                      "id": "silver",
                      "label": "银卡",
                      "tone": "processing"
                    },
                    {
                      "id": "gold",
                      "label": "金卡",
                      "tone": "success"
                    }
                  ]
                }
              ]
            },
            {
              "id": "pet",
              "name": "宠物档案",
              "fields": [
                {
                  "id": "owner_ref",
                  "name": "所属主人",
                  "type": "ref"
                },
                {
                  "id": "pet_name",
                  "name": "宠物名",
                  "type": "string"
                },
                {
                  "id": "species",
                  "name": "物种",
                  "type": "enum",
                  "options": [
                    {
                      "id": "cat",
                      "label": "猫",
                      "tone": "default"
                    },
                    {
                      "id": "dog",
                      "label": "狗",
                      "tone": "default"
                    },
                    {
                      "id": "rabbit",
                      "label": "兔",
                      "tone": "default"
                    },
                    {
                      "id": "other",
                      "label": "其他",
                      "tone": "warning"
                    }
                  ]
                },
                {
                  "id": "breed",
                  "name": "品种",
                  "type": "string"
                },
                {
                  "id": "age_years",
                  "name": "年龄",
                  "type": "number"
                },
                {
                  "id": "neuter_status",
                  "name": "绝育状态",
                  "type": "enum",
                  "options": [
                    {
                      "id": "unknown",
                      "label": "未知",
                      "tone": "default"
                    },
                    {
                      "id": "not_neutered",
                      "label": "未绝育",
                      "tone": "warning"
                    },
                    {
                      "id": "neutered",
                      "label": "已绝育",
                      "tone": "success"
                    }
                  ]
                }
              ]
            },
            {
              "id": "appointment",
              "name": "预约问诊",
              "fields": [
                {
                  "id": "owner_ref",
                  "name": "预约主人",
                  "type": "ref"
                },
                {
                  "id": "pet_ref",
                  "name": "就诊宠物",
                  "type": "ref"
                },
                {
                  "id": "scheduled_at",
                  "name": "预约时间",
                  "type": "date"
                },
                {
                  "id": "reason",
                  "name": "主诉原因",
                  "type": "string"
                },
                {
                  "id": "status",
                  "name": "预约状态",
                  "type": "enum",
                  "options": [
                    {
                      "id": "draft",
                      "label": "待确认",
                      "tone": "default"
                    },
                    {
                      "id": "confirmed",
                      "label": "已确认",
                      "tone": "processing"
                    },
                    {
                      "id": "triaged",
                      "label": "已分诊",
                      "tone": "processing"
                    },
                    {
                      "id": "consulting",
                      "label": "问诊中",
                      "tone": "processing"
                    },
                    {
                      "id": "completed",
                      "label": "已完成",
                      "tone": "success"
                    },
                    {
                      "id": "cancelled",
                      "label": "已取消",
                      "tone": "danger"
                    }
                  ]
                },
                {
                  "id": "triage_level",
                  "name": "分诊等级",
                  "type": "enum",
                  "options": [
                    {
                      "id": "routine",
                      "label": "常规",
                      "tone": "default"
                    },
                    {
                      "id": "priority",
                      "label": "优先",
                      "tone": "warning"
                    },
                    {
                      "id": "emergency",
                      "label": "急诊",
                      "tone": "danger"
                    }
                  ]
                },
                {
                  "id": "consult_fee",
                  "name": "问诊费",
                  "type": "number",
                  "format": "money"
                },
                {
                  "id": "wait_minutes",
                  "name": "等待分钟",
                  "type": "number"
                }
              ]
            },
            {
              "id": "triage_record",
              "name": "分诊记录",
              "fields": [
                {
                  "id": "appointment_ref",
                  "name": "关联预约",
                  "type": "ref"
                },
                {
                  "id": "temperature",
                  "name": "体温",
                  "type": "number"
                },
                {
                  "id": "weight_kg",
                  "name": "体重公斤",
                  "type": "number"
                },
                {
                  "id": "symptom_notes",
                  "name": "症状记录",
                  "type": "string"
                },
                {
                  "id": "ai_triage_suggestion",
                  "name": "AI分诊建议",
                  "type": "string"
                },
                {
                  "id": "risk_level",
                  "name": "风险等级",
                  "type": "enum",
                  "options": [
                    {
                      "id": "low",
                      "label": "低风险",
                      "tone": "success"
                    },
                    {
                      "id": "medium",
                      "label": "中风险",
                      "tone": "warning"
                    },
                    {
                      "id": "high",
                      "label": "高风险",
                      "tone": "danger"
                    }
                  ]
                }
              ]
            },
            {
              "id": "medical_record",
              "name": "门诊病例",
              "fields": [
                {
                  "id": "appointment_ref",
                  "name": "关联预约",
                  "type": "ref"
                },
                {
                  "id": "veterinarian_ref",
                  "name": "接诊兽医",
                  "type": "ref"
                },
                {
                  "id": "transcript_text",
                  "name": "问诊转写文本",
                  "type": "string"
                },
                {
                  "id": "soap_summary",
                  "name": "SOAP结构化病例",
                  "type": "string"
                },
                {
                  "id": "diagnosis",
                  "name": "诊断结论",
                  "type": "string"
                },
                {
                  "id": "audit_status",
                  "name": "病例审核状态",
                  "type": "enum",
                  "options": [
                    {
                      "id": "draft",
                      "label": "草稿",
                      "tone": "default"
                    },
                    {
                      "id": "submitted",
                      "label": "待审核",
                      "tone": "warning"
                    },
                    {
                      "id": "approved",
                      "label": "已通过",
                      "tone": "success"
                    },
                    {
                      "id": "returned",
                      "label": "已退回",
                      "tone": "danger"
                    }
                  ]
                },
                {
                  "id": "quality_score",
                  "name": "病例质量分",
                  "type": "number",
                  "format": "score"
                }
              ]
            },
            {
              "id": "followup_plan",
              "name": "复诊提醒计划",
              "fields": [
                {
                  "id": "appointment_ref",
                  "name": "来源预约",
                  "type": "ref"
                },
                {
                  "id": "pet_ref",
                  "name": "复诊宠物",
                  "type": "ref"
                },
                {
                  "id": "due_date",
                  "name": "复诊日期",
                  "type": "date"
                },
                {
                  "id": "reminder_content",
                  "name": "提醒内容",
                  "type": "string"
                },
                {
                  "id": "reminder_status",
                  "name": "提醒状态",
                  "type": "enum",
                  "options": [
                    {
                      "id": "pending",
                      "label": "待发送",
                      "tone": "warning"
                    },
                    {
                      "id": "sent",
                      "label": "已发送",
                      "tone": "success"
                    },
                    {
                      "id": "failed",
                      "label": "发送失败",
                      "tone": "danger"
                    },
                    {
                      "id": "confirmed",
                      "label": "已确认复诊",
                      "tone": "success"
                    }
                  ]
                }
              ]
            },
            {
              "id": "payment",
              "name": "问诊支付",
              "fields": [
                {
                  "id": "appointment_ref",
                  "name": "关联预约",
                  "type": "ref"
                },
                {
                  "id": "amount",
                  "name": "支付金额",
                  "type": "number",
                  "format": "money"
                },
                {
                  "id": "payment_status",
                  "name": "支付状态",
                  "type": "enum",
                  "options": [
                    {
                      "id": "unpaid",
                      "label": "未支付",
                      "tone": "warning"
                    },
                    {
                      "id": "paid",
                      "label": "已支付",
                      "tone": "success"
                    },
                    {
                      "id": "refunding",
                      "label": "退款中",
                      "tone": "processing"
                    },
                    {
                      "id": "refunded",
                      "label": "已退款",
                      "tone": "default"
                    },
                    {
                      "id": "failed",
                      "label": "支付失败",
                      "tone": "danger"
                    }
                  ]
                },
                {
                  "id": "paid_at",
                  "name": "支付时间",
                  "type": "date"
                },
                {
                  "id": "gateway_trade_no",
                  "name": "支付网关单号",
                  "type": "string"
                }
              ]
            },
            {
              "id": "reminder_log",
              "name": "提醒发送日志",
              "fields": [
                {
                  "id": "followup_plan_ref",
                  "name": "关联复诊计划",
                  "type": "ref"
                },
                {
                  "id": "sent_at",
                  "name": "发送时间",
                  "type": "date"
                },
                {
                  "id": "channel",
                  "name": "发送渠道",
                  "type": "enum",
                  "options": [
                    {
                      "id": "sms",
                      "label": "短信",
                      "tone": "default"
                    },
                    {
                      "id": "wechat",
                      "label": "微信",
                      "tone": "success"
                    },
                    {
                      "id": "phone",
                      "label": "电话",
                      "tone": "processing"
                    }
                  ]
                },
                {
                  "id": "delivery_status",
                  "name": "送达状态",
                  "type": "enum",
                  "options": [
                    {
                      "id": "queued",
                      "label": "排队中",
                      "tone": "processing"
                    },
                    {
                      "id": "delivered",
                      "label": "已送达",
                      "tone": "success"
                    },
                    {
                      "id": "bounced",
                      "label": "退信",
                      "tone": "danger"
                    }
                  ]
                },
                {
                  "id": "retry_count",
                  "name": "重试次数",
                  "type": "number"
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
            "receptionist",
            "triage_nurse",
            "veterinarian",
            "finance_clerk",
            "clinic_manager",
            "ops_staff"
          ],
          "permissions": [
            "owner:read",
            "pet:read",
            "appointment:create",
            "appointment:read",
            "appointment:update",
            "appointment:cancel",
            "triage:read",
            "triage:update",
            "record:read",
            "record:write",
            "record:audit",
            "followup:read",
            "followup:create",
            "followup:update",
            "payment:read",
            "payment:confirm",
            "payment:refund",
            "reminder:retry",
            "dashboard:view",
            "ai:run"
          ],
          "menus": [
            {
              "id": "front_desk_menu",
              "label": "前台预约台",
              "roleRefs": [
                "receptionist"
              ],
              "permissionRefs": [
                "owner:read",
                "pet:read",
                "appointment:create",
                "appointment:read",
                "appointment:update",
                "appointment:cancel",
                "payment:read"
              ]
            },
            {
              "id": "triage_menu",
              "label": "护士分诊台",
              "roleRefs": [
                "triage_nurse"
              ],
              "permissionRefs": [
                "appointment:read",
                "triage:read",
                "triage:update",
                "ai:run"
              ]
            },
            {
              "id": "doctor_menu",
              "label": "兽医问诊台",
              "roleRefs": [
                "veterinarian"
              ],
              "permissionRefs": [
                "appointment:read",
                "triage:read",
                "record:read",
                "record:write",
                "followup:read",
                "followup:create",
                "followup:update",
                "ai:run"
              ]
            },
            {
              "id": "finance_menu",
              "label": "财务支付台",
              "roleRefs": [
                "finance_clerk"
              ],
              "permissionRefs": [
                "payment:read",
                "payment:confirm",
                "payment:refund"
              ]
            },
            {
              "id": "manager_menu",
              "label": "院长质控台",
              "roleRefs": [
                "clinic_manager"
              ],
              "permissionRefs": [
                "record:read",
                "record:audit",
                "dashboard:view",
                "appointment:read",
                "followup:read",
                "payment:read"
              ]
            },
            {
              "id": "ops_menu",
              "label": "运营提醒台",
              "roleRefs": [
                "ops_staff"
              ],
              "permissionRefs": [
                "followup:read",
                "followup:update",
                "reminder:retry",
                "dashboard:view"
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
          "id": "appointment_lifecycle",
          "name": "预约问诊生命周期",
          "nodes": [
            {
              "id": "appt_submit",
              "name": "提交预约",
              "assigneeRole": "receptionist",
              "phase": "预约"
            },
            {
              "id": "appt_confirm",
              "name": "确认档期与宠物信息",
              "assigneeRole": "receptionist",
              "phase": "预约"
            },
            {
              "id": "appt_cancelled",
              "name": "取消预约",
              "assigneeRole": "receptionist",
              "phase": "预约"
            },
            {
              "id": "triage_assess",
              "name": "护士分诊评估",
              "assigneeRole": "triage_nurse",
              "phase": "分诊"
            },
            {
              "id": "vet_consult",
              "name": "兽医问诊",
              "assigneeRole": "veterinarian",
              "phase": "问诊"
            },
            {
              "id": "emergency_transfer",
              "name": "急诊转处置",
              "assigneeRole": "veterinarian",
              "phase": "问诊"
            },
            {
              "id": "record_complete",
              "name": "完成病例",
              "assigneeRole": "veterinarian",
              "phase": "问诊"
            },
            {
              "id": "followup_schedule",
              "name": "制定复诊提醒",
              "assigneeRole": "veterinarian",
              "phase": "复诊"
            },
            {
              "id": "case_closed",
              "name": "问诊归档",
              "assigneeRole": "receptionist",
              "phase": "复诊"
            }
          ],
          "transitions": [
            {
              "from": "appt_submit",
              "to": "appt_confirm",
              "condition": "资料完整"
            },
            {
              "from": "appt_confirm",
              "to": "appt_cancelled",
              "condition": "主人取消或档期不可用"
            },
            {
              "from": "appt_confirm",
              "to": "triage_assess",
              "condition": "到院或线上签到"
            },
            {
              "from": "triage_assess",
              "to": "appt_confirm",
              "condition": "宠物信息缺失需补充"
            },
            {
              "from": "triage_assess",
              "to": "vet_consult",
              "condition": "常规或优先问诊"
            },
            {
              "from": "triage_assess",
              "to": "emergency_transfer",
              "condition": "急诊等级"
            },
            {
              "from": "emergency_transfer",
              "to": "vet_consult",
              "condition": "生命体征稳定后补问诊"
            },
            {
              "from": "vet_consult",
              "to": "record_complete",
              "condition": "问诊结束"
            },
            {
              "from": "record_complete",
              "to": "vet_consult",
              "condition": "病例信息不完整"
            },
            {
              "from": "record_complete",
              "to": "followup_schedule",
              "condition": "需要复诊"
            },
            {
              "from": "record_complete",
              "to": "case_closed",
              "condition": "无需复诊"
            },
            {
              "from": "followup_schedule",
              "to": "case_closed",
              "condition": "提醒计划已生成"
            }
          ],
          "chains": [
            {
              "id": "consult_payment_chain",
              "name": "问诊费支付入账链",
              "kind": "money",
              "nodes": [
                {
                  "id": "pay_order_create",
                  "name": "生成问诊费账单",
                  "assigneeRole": "receptionist",
                  "phase": "计费"
                },
                {
                  "id": "pay_owner_pay",
                  "name": "主人支付",
                  "assigneeRole": "receptionist",
                  "phase": "支付"
                },
                {
                  "id": "pay_callback_verify",
                  "name": "服务端核验回调",
                  "assigneeRole": "finance_clerk",
                  "phase": "支付"
                },
                {
                  "id": "pay_failed",
                  "name": "支付失败处理",
                  "assigneeRole": "finance_clerk",
                  "phase": "支付"
                },
                {
                  "id": "pay_ledger_post",
                  "name": "入账留痕",
                  "assigneeRole": "finance_clerk",
                  "phase": "入账"
                },
                {
                  "id": "pay_refund_review",
                  "name": "退款复核",
                  "assigneeRole": "clinic_manager",
                  "phase": "入账"
                }
              ],
              "transitions": [
                {
                  "from": "pay_order_create",
                  "to": "pay_owner_pay",
                  "condition": "账单金额确认"
                },
                {
                  "from": "pay_owner_pay",
                  "to": "pay_callback_verify",
                  "condition": "收到支付网关通知"
                },
                {
                  "from": "pay_callback_verify",
                  "to": "pay_ledger_post",
                  "condition": "签名与金额一致"
                },
                {
                  "from": "pay_callback_verify",
                  "to": "pay_failed",
                  "condition": "签名错误或金额不一致"
                },
                {
                  "from": "pay_failed",
                  "to": "pay_owner_pay",
                  "condition": "允许重新支付"
                },
                {
                  "from": "pay_ledger_post",
                  "to": "pay_refund_review",
                  "condition": "预约取消且符合退款规则"
                },
                {
                  "from": "pay_refund_review",
                  "to": "pay_ledger_post",
                  "condition": "退款完成后补记负向流水"
                }
              ]
            },
            {
              "id": "record_governance_chain",
              "name": "病例质控审核链",
              "kind": "governance",
              "nodes": [
                {
                  "id": "record_submit_audit",
                  "name": "提交病例审核",
                  "assigneeRole": "veterinarian",
                  "phase": "提交"
                },
                {
                  "id": "record_quality_review",
                  "name": "院长质控审核",
                  "assigneeRole": "clinic_manager",
                  "phase": "审核"
                },
                {
                  "id": "record_return_fix",
                  "name": "退回修订病例",
                  "assigneeRole": "veterinarian",
                  "phase": "审核"
                },
                {
                  "id": "record_approved_archive",
                  "name": "病例审核归档",
                  "assigneeRole": "clinic_manager",
                  "phase": "归档"
                }
              ],
              "transitions": [
                {
                  "from": "record_submit_audit",
                  "to": "record_quality_review",
                  "condition": "病例质量分达到提交线"
                },
                {
                  "from": "record_quality_review",
                  "to": "record_approved_archive",
                  "condition": "审核通过"
                },
                {
                  "from": "record_quality_review",
                  "to": "record_return_fix",
                  "condition": "诊断或用药记录不完整"
                },
                {
                  "from": "record_return_fix",
                  "to": "record_submit_audit",
                  "condition": "兽医修订后重新提交"
                }
              ]
            },
            {
              "id": "reminder_recovery_chain",
              "name": "复诊提醒失败恢复链",
              "kind": "recovery",
              "nodes": [
                {
                  "id": "reminder_detect_failure",
                  "name": "检测提醒失败",
                  "assigneeRole": "ops_staff",
                  "phase": "检测"
                },
                {
                  "id": "reminder_auto_retry",
                  "name": "自动切换渠道重试",
                  "assigneeRole": "ops_staff",
                  "phase": "重试"
                },
                {
                  "id": "reminder_manual_call",
                  "name": "人工电话确认",
                  "assigneeRole": "receptionist",
                  "phase": "重试"
                },
                {
                  "id": "reminder_closed",
                  "name": "关闭提醒工单",
                  "assigneeRole": "ops_staff",
                  "phase": "闭环"
                }
              ],
              "transitions": [
                {
                  "from": "reminder_detect_failure",
                  "to": "reminder_auto_retry",
                  "condition": "重试次数小于3次"
                },
                {
                  "from": "reminder_detect_failure",
                  "to": "reminder_manual_call",
                  "condition": "连续退信或电话优先客户"
                },
                {
                  "from": "reminder_auto_retry",
                  "to": "reminder_closed",
                  "condition": "送达成功"
                },
                {
                  "from": "reminder_auto_retry",
                  "to": "reminder_manual_call",
                  "condition": "重试后仍失败"
                },
                {
                  "from": "reminder_manual_call",
                  "to": "reminder_detect_failure",
                  "condition": "号码错误需回到检测更新资料"
                },
                {
                  "from": "reminder_manual_call",
                  "to": "reminder_closed",
                  "condition": "主人已确认复诊"
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
              "id": "appointment_kanban",
              "name": "预约流转看板",
              "kind": "kanban",
              "statusField": "appointment.status",
              "fieldBindings": [
                "appointment.owner_ref",
                "appointment.pet_ref",
                "appointment.scheduled_at",
                "appointment.reason",
                "appointment.status",
                "appointment.triage_level",
                "appointment.consult_fee"
              ],
              "actionPermissions": [
                "appointment:create",
                "appointment:read",
                "appointment:update",
                "appointment:cancel"
              ]
            },
            {
              "id": "schedule_calendar",
              "name": "预约排班日历",
              "kind": "calendar",
              "dateField": "appointment.scheduled_at",
              "colorBy": "appointment.triage_level",
              "fieldBindings": [
                "appointment.scheduled_at",
                "appointment.status",
                "appointment.triage_level",
                "pet.pet_name",
                "pet.species",
                "pet_owner.name",
                "pet_owner.phone"
              ],
              "actionPermissions": [
                "appointment:read",
                "appointment:update",
                "owner:read",
                "pet:read"
              ]
            },
            {
              "id": "triage_workbench",
              "name": "护士分诊工作台",
              "kind": "workbench",
              "fieldBindings": [
                "triage_record.appointment_ref",
                "triage_record.temperature",
                "triage_record.weight_kg",
                "triage_record.symptom_notes",
                "triage_record.ai_triage_suggestion",
                "triage_record.risk_level",
                "appointment.reason",
                "appointment.triage_level"
              ],
              "actionPermissions": [
                "triage:read",
                "triage:update",
                "appointment:read",
                "ai:run"
              ]
            },
            {
              "id": "doctor_consult_workbench",
              "name": "兽医问诊工作台",
              "kind": "workbench",
              "fieldBindings": [
                "medical_record.appointment_ref",
                "medical_record.transcript_text",
                "medical_record.soap_summary",
                "medical_record.diagnosis",
                "medical_record.audit_status",
                "medical_record.quality_score",
                "followup_plan.due_date",
                "followup_plan.reminder_content"
              ],
              "actionPermissions": [
                "record:read",
                "record:write",
                "followup:read",
                "followup:create",
                "followup:update",
                "ai:run"
              ]
            },
            {
              "id": "followup_ops_workbench",
              "name": "复诊提醒运营台",
              "kind": "workbench",
              "fieldBindings": [
                "followup_plan.appointment_ref",
                "followup_plan.pet_ref",
                "followup_plan.due_date",
                "followup_plan.reminder_content",
                "followup_plan.reminder_status",
                "reminder_log.channel",
                "reminder_log.delivery_status",
                "reminder_log.retry_count"
              ],
              "actionPermissions": [
                "followup:read",
                "followup:update",
                "reminder:retry"
              ]
            },
            {
              "id": "finance_workbench",
              "name": "问诊收费台",
              "kind": "dashboard",
              "fieldBindings": [
                "payment.appointment_ref",
                "payment.amount",
                "payment.payment_status",
                "payment.paid_at",
                "payment.gateway_trade_no",
                "appointment.consult_fee"
              ],
              "actionPermissions": [
                "payment:read",
                "payment:confirm",
                "payment:refund"
              ],
              "stats": [
                {
                  "id": "paid_amount",
                  "name": "已收问诊费",
                  "entity": "payment",
                  "metric": "sum:payment.amount",
                  "format": "money"
                },
                {
                  "id": "payment_orders",
                  "name": "支付单数",
                  "entity": "payment",
                  "metric": "count",
                  "format": "number"
                },
                {
                  "id": "avg_fee",
                  "name": "平均问诊费",
                  "entity": "appointment",
                  "metric": "avg:appointment.consult_fee",
                  "format": "money"
                }
              ],
              "charts": [
                {
                  "id": "payment_status_share",
                  "name": "支付状态分布",
                  "type": "pie",
                  "dimension": "payment.payment_status",
                  "metric": "count"
                },
                {
                  "id": "fee_by_triage",
                  "name": "分诊等级收入",
                  "type": "bar",
                  "dimension": "appointment.triage_level",
                  "metric": "sum:appointment.consult_fee"
                }
              ]
            },
            {
              "id": "clinic_dashboard",
              "name": "医院运营总览",
              "kind": "dashboard",
              "fieldBindings": [
                "appointment.status",
                "appointment.wait_minutes",
                "triage_record.risk_level",
                "medical_record.audit_status",
                "followup_plan.reminder_status",
                "reminder_log.delivery_status"
              ],
              "actionPermissions": [
                "dashboard:view",
                "appointment:read",
                "record:read",
                "followup:read",
                "payment:read"
              ],
              "stats": [
                {
                  "id": "today_appointments",
                  "name": "预约总量",
                  "entity": "appointment",
                  "metric": "count",
                  "format": "number"
                },
                {
                  "id": "avg_wait",
                  "name": "平均等待分钟",
                  "entity": "appointment",
                  "metric": "avg:appointment.wait_minutes",
                  "format": "number"
                },
                {
                  "id": "followup_pending",
                  "name": "复诊计划数",
                  "entity": "followup_plan",
                  "metric": "count",
                  "format": "number"
                },
                {
                  "id": "record_quality",
                  "name": "平均病例质量分",
                  "entity": "medical_record",
                  "metric": "avg:medical_record.quality_score",
                  "format": "number"
                }
              ],
              "charts": [
                {
                  "id": "appointment_status_bar",
                  "name": "预约状态对比",
                  "type": "bar",
                  "dimension": "appointment.status",
                  "metric": "count"
                },
                {
                  "id": "risk_level_pie",
                  "name": "分诊风险占比",
                  "type": "pie",
                  "dimension": "triage_record.risk_level",
                  "metric": "count"
                }
              ]
            },
            {
              "id": "record_audit_workbench",
              "name": "病例质控审核台",
              "kind": "workbench",
              "fieldBindings": [
                "medical_record.appointment_ref",
                "medical_record.veterinarian_ref",
                "medical_record.soap_summary",
                "medical_record.diagnosis",
                "medical_record.audit_status",
                "medical_record.quality_score"
              ],
              "actionPermissions": [
                "record:read",
                "record:audit"
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
              "id": "ai_triage_suggestion",
              "name": "主诉智能分诊建议",
              "inputFields": [
                "appointment.reason",
                "pet.species",
                "pet.age_years",
                "triage_record.symptom_notes"
              ],
              "outputField": "triage_record.ai_triage_suggestion",
              "roleRefs": [
                "triage_nurse",
                "veterinarian"
              ]
            },
            {
              "id": "ai_dialog_transcription",
              "name": "问诊对话转写",
              "inputFields": [
                "appointment.reason",
                "triage_record.symptom_notes"
              ],
              "outputField": "medical_record.transcript_text",
              "roleRefs": [
                "veterinarian"
              ]
            },
            {
              "id": "ai_soap_summary",
              "name": "生成SOAP结构化病例",
              "inputFields": [
                "medical_record.transcript_text",
                "triage_record.ai_triage_suggestion"
              ],
              "outputField": "medical_record.soap_summary",
              "roleRefs": [
                "veterinarian"
              ]
            },
            {
              "id": "ai_followup_reminder",
              "name": "生成复诊提醒文案",
              "inputFields": [
                "medical_record.soap_summary",
                "medical_record.diagnosis",
                "followup_plan.due_date"
              ],
              "outputField": "followup_plan.reminder_content",
              "roleRefs": [
                "veterinarian",
                "ops_staff"
              ]
            }
          ],
          "pipelines": [
            {
              "id": "consult_record_pipeline",
              "name": "问诊转写到病例生成",
              "steps": [
                "ai_dialog_transcription",
                "ai_soap_summary",
                "ai_followup_reminder"
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
              "pageRef": "appointment_kanban",
              "workflowRef": "appointment_lifecycle"
            },
            {
              "pageRef": "schedule_calendar",
              "workflowRef": "appt_confirm"
            },
            {
              "pageRef": "triage_workbench",
              "workflowRef": "triage_assess"
            },
            {
              "pageRef": "doctor_consult_workbench",
              "workflowRef": "vet_consult"
            },
            {
              "pageRef": "followup_ops_workbench",
              "workflowRef": "reminder_detect_failure"
            },
            {
              "pageRef": "finance_workbench",
              "workflowRef": "pay_callback_verify"
            },
            {
              "pageRef": "clinic_dashboard",
              "workflowRef": "case_closed"
            },
            {
              "pageRef": "record_audit_workbench",
              "workflowRef": "record_quality_review"
            }
          ],
          "roleRefs": [
            "receptionist",
            "triage_nurse",
            "veterinarian",
            "finance_clerk",
            "clinic_manager",
            "ops_staff"
          ],
          "dataModelRefs": [
            "pet_owner",
            "pet",
            "appointment",
            "triage_record",
            "medical_record",
            "followup_plan",
            "payment",
            "reminder_log"
          ],
          "invariants": [
            {
              "id": "triage_before_consult",
              "statement": "除急诊转处置外，兽医问诊必须在护士完成分诊评估之后开始。",
              "systems": [
                "workflow",
                "datamodel"
              ],
              "refs": [
                "triage_assess",
                "vet_consult",
                "emergency_transfer",
                "appointment.triage_level"
              ]
            },
            {
              "id": "payment_callback_source_of_truth",
              "statement": "支付状态只能由服务端核验回调或财务退款复核节点改变，前台页面不得直接标记为已支付。",
              "systems": [
                "datamodel",
                "workflow",
                "rbac",
                "page"
              ],
              "refs": [
                "payment.payment_status",
                "pay_callback_verify",
                "pay_refund_review",
                "payment:confirm",
                "payment:refund"
              ]
            },
            {
              "id": "record_requires_appointment",
              "statement": "每份门诊病例必须关联一个已进入问诊或已完成状态的预约。",
              "systems": [
                "datamodel",
                "workflow"
              ],
              "refs": [
                "medical_record.appointment_ref",
                "appointment.status",
                "vet_consult",
                "record_complete"
              ]
            },
            {
              "id": "followup_requires_diagnosis",
              "statement": "复诊提醒计划必须在病例存在诊断结论后才能生成并发送。",
              "systems": [
                "datamodel",
                "workflow",
                "aigc"
              ],
              "refs": [
                "followup_plan.reminder_content",
                "medical_record.diagnosis",
                "followup_schedule",
                "ai_followup_reminder"
              ]
            },
            {
              "id": "failed_reminder_must_have_log",
              "statement": "任何发送失败的复诊提醒都必须保留提醒发送日志并进入失败恢复链。",
              "systems": [
                "datamodel",
                "workflow",
                "page"
              ],
              "refs": [
                "followup_plan.reminder_status",
                "reminder_log.delivery_status",
                "reminder_detect_failure",
                "reminder:retry"
              ]
            },
            {
              "id": "audit_before_archive",
              "statement": "病例归档前必须经过院长质控审核通过，不得直接从草稿归档。",
              "systems": [
                "datamodel",
                "workflow",
                "rbac"
              ],
              "refs": [
                "medical_record.audit_status",
                "record_quality_review",
                "record_approved_archive",
                "clinic_manager",
                "record:audit"
              ]
            },
            {
              "id": "owner_contact_masked",
              "statement": "宠物主人手机号和微信号在非联系场景必须以脱敏格式展示。",
              "systems": [
                "datamodel",
                "page",
                "rbac"
              ],
              "refs": [
                "pet_owner.phone",
                "pet_owner.wechat_id",
                "owner:read",
                "schedule_calendar"
              ]
            }
          ]
        }
      }
    },
    "topBlockers": [],
    "chatSummary": "闭环结论：**closed，证据 6/6**。当前方案已形成较完整的社区宠物医院预约问诊闭环，覆盖预约、分诊、问诊、收费、复诊提醒与运营质控。\n\n现在这个应用能做：\n- 管理 **8 类核心数据**：宠物主人、宠物档案、预约问诊、分诊记录、门诊病例、复诊提醒计划、支付与提醒日志。\n- 支撑 **9 节点/12 转移** 的就诊流程，从预约到复诊提醒可流转。\n- 提供 **6 类角色权限**：前台、分诊护士、兽医、财务、医院经理、运营人员各司其职。\n- 配套 **8 个医院端页面**：排班日历、分诊台、兽医工作台、收费台、提醒运营台、运营总览、病例质控等。\n- 引入 **4 项 AI 能力**：分诊建议、问诊转写、SOAP 病例生成、复诊提醒文案生成。\n\n关键风险与分歧：\n- 隐私与权限：主人信息、宠物档案、病例、支付记录需防泄露和越权访问。\n- 流程可靠性：错误分诊、重复预约、漏发提醒会影响就诊秩序与复诊率。\n- 第三方通知依赖：短信/微信/电话接口可能误发、中断或被滥用。\n\n建议下一步：\n- 先固化预约、分诊、问诊、复诊提醒的状态校验、审计日志与失败重试机制。\n- 明确提醒触发规则、角色权限边界和第三方通知接入安全要求，再进入原型/开发。"
  },
  "chatSummary": "闭环结论：**closed，证据 6/6**。当前方案已形成较完整的社区宠物医院预约问诊闭环，覆盖预约、分诊、问诊、收费、复诊提醒与运营质控。\n\n现在这个应用能做：\n- 管理 **8 类核心数据**：宠物主人、宠物档案、预约问诊、分诊记录、门诊病例、复诊提醒计划、支付与提醒日志。\n- 支撑 **9 节点/12 转移** 的就诊流程，从预约到复诊提醒可流转。\n- 提供 **6 类角色权限**：前台、分诊护士、兽医、财务、医院经理、运营人员各司其职。\n- 配套 **8 个医院端页面**：排班日历、分诊台、兽医工作台、收费台、提醒运营台、运营总览、病例质控等。\n- 引入 **4 项 AI 能力**：分诊建议、问诊转写、SOAP 病例生成、复诊提醒文案生成。\n\n关键风险与分歧：\n- 隐私与权限：主人信息、宠物档案、病例、支付记录需防泄露和越权访问。\n- 流程可靠性：错误分诊、重复预约、漏发提醒会影响就诊秩序与复诊率。\n- 第三方通知依赖：短信/微信/电话接口可能误发、中断或被滥用。\n\n建议下一步：\n- 先固化预约、分诊、问诊、复诊提醒的状态校验、审计日志与失败重试机制。\n- 明确提醒触发规则、角色权限边界和第三方通知接入安全要求，再进入原型/开发。"
};
