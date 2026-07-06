# 五系统模型多域生成质量评测（Five-System Generation Eval）

- 运行时间：2026-07-06 11:28 UTC
- 生成模型：`gpt-5.5`（真实 LLM，串行逐域，路由限流约束）
- 管线：`generate_five_system_model(intent)` → `validate_five_system_model(model)`（结构闭包 gate，任何悬挂交叉引用即 fail）
- 领域适配为启发式抽查信号（关键词命中 + 原始命名列表），供人工复核；不做打分粉饰。

## 汇总

| 领域 | 生成 | Gate | 耗时(s) | 实体 | 字段 | 角色 | 权限 | 流程节点 | 转移 | 页面 | AIGC能力 | 交叉引用(悬挂/总数) | 实体域命中 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 连锁健身房 | ✅ | ✅ PASS | 97.7 | 7 | 42 | 6 | 19 | 6 | 7 | 5 | 3 | 0/169 | 7/7 |
| 跨境物流报关 | ✅ | ✅ PASS | 98.1 | 5 | 45 | 6 | 19 | 7 | 8 | 6 | 4 | 0/151 | 5/5 |
| 医院药房库存 | ✅ | ✅ PASS | 534.9 | 7 | 48 | 6 | 16 | 9 | 11 | 7 | 4 | 0/181 | 7/7 |
| 餐饮加盟督导 | ✅ | ✅ PASS | 222.1 | 7 | 55 | 4 | 19 | 7 | 7 | 5 | 3 | 0/161 | 7/7 |
| 物业报修工单 | ✅ | ✅ PASS | 215.4 | 6 | 45 | 5 | 18 | 6 | 6 | 6 | 2 | 0/159 | 6/6 |

## 连锁健身房

- 意图：做一个连锁健身房管理系统，包含私教排期、会员卡核销和器材保养
- 生成耗时：97.7s
- Gate：**PASS**（0 悬挂引用）
- 交叉引用完整性：共 169 条被检引用，悬挂 0 条（解析率 100.0%）
- 规模：7 实体 / 42 字段 / 6 角色 / 19 权限 / 6 菜单 / 6 流程节点 / 7 转移 / 5 页面 / 3 AIGC 能力 / 5 装配绑定
- 领域适配抽查：
  - 实体命中 7/7：member 会员、membership_card 会员卡、trainer 私教、personal_training_session 私教课程排期、card_writeoff 会员卡核销记录、equipment 健身器材、maintenance_order 器材保养工单
  - 角色命中 4/6：branch_manager、personal_trainer、front_desk、maintenance_staff、member_service、finance_auditor
  - 流程节点命中 5/6：schedule_request 会员私教预约登记、trainer_confirm 私教确认排期、front_desk_checkin 前台到店签到、card_writeoff_audit 会员卡核销审核、equipment_inspection 课后器材巡检与保养、manager_close 店长复核关闭
  - 页面命中 5/5：page_member_card_profile 会员卡档案页、page_personal_training_schedule 私教排期页、page_card_writeoff 会员卡核销页、page_equipment_maintenance 器材保养工单页、page_branch_manager_dashboard 连锁门店运营看板
  - AIGC 能力命中 3/3：ai_schedule_optimizer 私教排期智能推荐、ai_member_retention_advisor 会员续费与留存建议、ai_equipment_maintenance_diagnosis 器材保养诊断助手
  - 泛化命名嫌疑：无（首版启发式曾因 "main"⊂"maintenance" 子串误报 4 条，已修正为整词匹配）

## 跨境物流报关

- 意图：构建跨境物流报关平台，覆盖运单管理、报关单申报、关税核算与清关状态跟踪
- 生成耗时：98.1s
- Gate：**PASS**（0 悬挂引用）
- 交叉引用完整性：共 151 条被检引用，悬挂 0 条（解析率 100.0%）
- 规模：5 实体 / 45 字段 / 6 角色 / 19 权限 / 5 菜单 / 7 流程节点 / 8 转移 / 6 页面 / 4 AIGC 能力 / 6 装配绑定
- 领域适配抽查：
  - 实体命中 5/5：shipment 跨境货运批次、waybill 运单、customs_declaration 报关单、tariff_calculation 关税核算、clearance_status 清关状态跟踪
  - 角色命中 3/6：logistics_operator、customs_specialist、tariff_accountant、compliance_manager、customer_service、platform_admin
  - 流程节点命中 5/7：create_waybill 创建并校验运单、prepare_declaration 准备报关资料、compliance_review 合规复核、tariff_assessment 关税核算、submit_to_customs 提交海关申报、track_clearance 跟踪清关状态、released_close 放行归档
  - 页面命中 6/6：page_shipment_dashboard 跨境货运总览、page_waybill_management 运单管理、page_declaration_submission 报关单申报、page_compliance_review 报关合规复核、page_tariff_calculation 关税核算、page_clearance_tracking 清关状态跟踪
  - AIGC 能力命中 4/4：ai_hs_code_assistant AI HS编码辅助归类、ai_declaration_risk_check AI报关风险预审、ai_tariff_explanation AI关税核算说明生成、ai_clearance_status_summary AI清关状态摘要
  - 泛化命名嫌疑：无

## 医院药房库存

- 意图：开发医院药房库存管理系统，支持药品入库出库、批号效期预警和处方调剂发药
- 生成耗时：534.9s（首次调用遭遇上游 520，触发有界重试后第二次成功——耗时包含失败调用的超时等待，如实计入）
- Gate：**PASS**（0 悬挂引用）
- 交叉引用完整性：共 181 条被检引用，悬挂 0 条（解析率 100.0%）
- 规模：7 实体 / 48 字段 / 6 角色 / 16 权限 / 6 菜单 / 9 流程节点 / 11 转移 / 7 页面 / 4 AIGC 能力 / 7 装配绑定
- 领域适配抽查：
  - 实体命中 7/7：drug 药品目录、stock_batch 库存批次、inbound_order 入库单、outbound_order 出库单、prescription 处方、prescription_item 处方明细、expiry_alert 批号效期预警
  - 角色命中 2/6：pharmacy_clerk、pharmacist、chief_pharmacist、inventory_manager、doctor、auditor
  - 流程节点命中 9/9：inbound_registration 入库登记、inbound_acceptance 入库验收审核、batch_stock_update 批号库存更新、expiry_monitoring 批号效期预警处理、outbound_request 出库申请、outbound_approval 出库审批、prescription_review 处方审方、prescription_dispense 处方调剂发药、audit_archiving 库存与处方记录归档
  - 页面命中 7/7：page_drug_catalog 药品目录管理页、page_batch_inventory 批号库存查询页、page_inbound_order 入库验收单页、page_outbound_order 出库申请审批页、page_prescription_dispense 处方审方调剂发药页、page_expiry_alert 批号效期预警处理页、page_audit_report 库存与处方审计报表页
  - AIGC 能力命中 4/4：expiry_risk_summary 近效期批次风险摘要生成、prescription_review_assistant 处方审方提示生成、stock_replenishment_advice 药品补货建议生成、batch_dispense_selection 先进先出批次发药建议
  - ⚠️ 泛化命名嫌疑（1）：prescription_item 处方明细

## 餐饮加盟督导

- 意图：搭建餐饮连锁加盟督导系统，包含巡店检查、整改跟踪和门店评分排名
- 生成耗时：222.1s
- Gate：**PASS**（0 悬挂引用）
- 交叉引用完整性：共 161 条被检引用，悬挂 0 条（解析率 100.0%）
- 规模：7 实体 / 55 字段 / 4 角色 / 19 权限 / 6 菜单 / 7 流程节点 / 7 转移 / 5 页面 / 3 AIGC 能力 / 5 装配绑定
- 领域适配抽查：
  - 实体命中 7/7：store 加盟门店、franchisee 加盟商、inspection 巡店检查、checklist_item 检查项目、inspection_finding 巡检问题、corrective_action 整改任务、store_score 门店评分排名
  - 角色命中 2/4：operations_admin、franchise_supervisor、store_manager、regional_manager
  - 流程节点命中 7/7：plan_inspection 制定巡店计划、conduct_inspection 现场巡店检查、submit_findings 提交问题与评分、store_rectification 门店执行整改、supervisor_verification 督导复核整改、regional_review 区域经理审核评分、publish_ranking 发布门店排名
  - 页面命中 4/5：page_store_profile 加盟门店档案页、page_inspection_form 巡店检查填报页、page_finding_capture 巡检问题记录页、page_corrective_action 整改任务跟踪页、page_score_ranking 门店评分排名页
  - AIGC 能力命中 3/3：generate_inspection_summary 生成巡店检查总结、recommend_corrective_action 推荐整改措施、generate_ranking_comment 生成门店排名点评
  - ⚠️ 泛化命名嫌疑（1）：checklist_item 检查项目

## 物业报修工单

- 意图：做一个物业报修工单系统，业主提交报修、物业派单维修、完工验收与回访评价
- 生成耗时：215.4s
- Gate：**PASS**（0 悬挂引用）
- 交叉引用完整性：共 159 条被检引用，悬挂 0 条（解析率 100.0%）
- 规模：6 实体 / 45 字段 / 5 角色 / 18 权限 / 5 菜单 / 6 流程节点 / 6 转移 / 6 页面 / 2 AIGC 能力 / 6 装配绑定
- 领域适配抽查：
  - 实体命中 6/6：owner 业主、repair_order 报修工单、dispatch_assignment 派单记录、repair_execution 维修执行、acceptance_review 完工验收、visit_feedback 回访评价
  - 角色命中 4/5：owner、property_dispatcher、maintenance_worker、property_manager、customer_service
  - 流程节点命中 6/6：submit_repair 业主提交报修、dispatch_order 物业审核并派单、perform_repair 维修人员上门维修、owner_acceptance 业主完工验收、service_revisit 客服回访评价、manager_close 物业经理关闭工单
  - 页面命中 6/6：owner_submit_repair_page 业主提交报修页、repair_order_detail_page 报修工单详情页、dispatch_assignment_page 物业派单页、worker_repair_execution_page 维修执行页、owner_acceptance_page 业主验收页、customer_revisit_feedback_page 客服回访与评价页
  - AIGC 能力命中 2/2：repair_solution_advisor 故障维修方案推荐、feedback_summary_generator 回访评价摘要生成
  - 泛化命名嫌疑：无（首版启发式曾因 "main"⊂"maintenance" 子串误报 maintenance_worker，已修正为整词匹配）

## 结论（诚实版）

- 生成成功 5/5，Gate 通过 5/5；5 域合计 821 条被检交叉引用（169+151+181+161+159）悬挂 0 条。
- 医院药房库存域首次 LLM 调用遭遇上游 520（真实故障，非隐瞒），由 generate 内置的一次有界重试挽回；其 534.9s 耗时如实包含失败调用。无重试则该域会 fail-closed（0/6），符合“失败由 gate/fail-closed 拦截而非静默”的既定语义。
- 耗时波动大（97.7s ~ 534.9s，中位 215.4s），主要受上游路由排队影响；串行执行是路由限流下的刻意选择。
- 角色名命中率偏低（如 pharmacist、doctor 未含"药/hospital"类关键词）属关键词表覆盖不足，非生成质量问题——原始命名列表显示角色均为领域合理角色，请人工复核确认。
- 关键词命中是抽查下限而非上限：中文实体名可能用同义词（如“课程”对“排期”），请结合原始命名列表人工复核。
