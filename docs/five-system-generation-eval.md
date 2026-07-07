# 五系统模型多域生成质量评测（Five-System Generation Eval）

- 运行时间：2026-07-07 09:42 UTC
- 生成模型：`gpt-5.5`（真实 LLM，串行逐域，路由限流约束）
- 管线：`generate_five_system_model(intent)` → `validate_five_system_model(model)`（结构闭包 gate，任何悬挂交叉引用即 fail）
- 领域适配为启发式抽查信号（关键词命中 + 原始命名列表），供人工复核；不做打分粉饰。

## 汇总

| 领域 | 生成 | Gate | 内容质量 | LLM评审(覆盖/常识/命名) | 耗时(s) | 实体 | 字段 | 角色 | 权限 | 流程节点 | 转移 | 页面 | AIGC能力 | 交叉引用(悬挂/总数) | 实体域命中 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 连锁健身房 | ✅ | ✅ PASS | ✅ 0 fail / 0 warn | 4/4/4 (均4.0) | 54.8 | 8 | 51 | 5 | 18 | 6 | 7 | 6 | 3 | 0/178 | 8/8 |
| 跨境物流报关 | ✅ | ✅ PASS | ✅ 0 fail / 0 warn | 5/4/4 (均4.33) | 92.9 | 8 | 54 | 6 | 19 | 10 | 14 | 5 | 3 | 0/172 | 6/8 |
| 医院药房库存 | ✅ | ✅ PASS | ✅ 0 fail / 0 warn | 4/4/5 (均4.33) | 96.4 | 7 | 51 | 5 | 20 | 10 | 13 | 8 | 3 | 0/211 | 6/7 |
| 餐饮加盟督导 | ✅ | ✅ PASS | ✅ 0 fail / 0 warn | ⚠️ 评审失败 | 145.9 | 9 | 62 | 5 | 13 | 9 | 13 | 6 | 3 | 0/165 | 9/9 |
| 物业报修工单 | ✅ | ✅ PASS | ✅ 0 fail / 0 warn | 5/4/5 (均4.67) | 50.9 | 7 | 47 | 6 | 16 | 9 | 10 | 6 | 3 | 0/168 | 7/7 |

## 连锁健身房

- 意图：做一个连锁健身房管理系统，包含私教排期、会员卡核销和器材保养
- 生成耗时：54.8s
- Gate：**PASS**（0 悬挂引用）
- 交叉引用完整性：共 178 条被检引用，悬挂 0 条（解析率 100.0%）
- 规模：8 实体 / 51 字段 / 5 角色 / 18 权限 / 5 菜单 / 6 流程节点 / 7 转移 / 6 页面 / 3 AIGC 能力 / 6 装配绑定
- 领域适配抽查：
  - 实体命中 8/8：member 会员、membership_card 会员卡、personal_trainer 私教、training_session 私教课程排期、card_redemption 会员卡核销、equipment 健身器材、maintenance_request 器材保养申请、maintenance_task 保养工单
  - 角色命中 3/5：front_desk、personal_trainer、gym_manager、maintenance_technician、finance_auditor
  - 流程节点命中 5/6：submit_maintenance_request 提交器材保养申请、manager_review 店长审核保养申请、technician_service 维修技师执行保养、manager_acceptance 店长验收保养结果、closed 保养完成归档、rejected 申请驳回
  - 页面命中 6/6：member_card_page 会员与会员卡管理、private_training_schedule_page 私教排期管理、card_redemption_page 会员卡核销台、equipment_inventory_page 器材台账、maintenance_request_page 器材保养申请与审批、operations_report_page 门店运营报表
  - AIGC 能力命中 3/3：smart_private_training_scheduler AI私教智能排期、equipment_fault_diagnosis AI器材故障诊断与保养建议、member_retention_advisor AI会员续卡挽留建议
  - 泛化命名嫌疑：无
- 内容质量（确定性启发式，零 LLM）：
  - 流程形状：2 个分支节点 · 有回退边
  - 可达性/权限：不可达页面 0 · 空页面 0 · 满权角色 0 · 孤儿权限 0 · 无用角色 0 · 孤儿实体 0
  - 结论：✅ 无 finding
- LLM 评审（1-5 量表 · temperature 0 · 同模型自评有自恋偏差，用于回归比对而非绝对分）：
  - 需求覆盖度：**4/5**
    - 明确覆盖了“私教排期”，包含实体“training_session”、页面“private_training_schedule_page”和能力“smart_private_training_scheduler”。
    - 明确覆盖了“会员卡核销”，包含实体“card_redemption”、权限“card:redeem”和页面“card_redemption_page”。
    - 明确覆盖了“器材保养”，包含“maintenance_request”“maintenance_task”和完整的保养审批/执行/验收流程。
    - ❗漏建模：“连锁健身房”缺少门店/分店实体、跨门店数据隔离、门店维度排期/器材/会员卡归属等能力
  - 行业常识：**4/5**
    - 角色划分“front_desk”“personal_trainer”“gym_manager”“maintenance_technician”“finance_auditor”基本符合健身房运营分工。
    - 保养流程“提交申请->店长审核->技师执行->店长验收->归档”符合器材维护管理习惯。
    - “submit_maintenance_request”只标注由“personal_trainer”提交偏窄，实际前台、巡检人员、店长也可能提交；“reported_by(string)”和“technician_id(string)”也缺少人员引用建模。
  - 命名质量：**4/5**
    - 实体命名如“membership_card”“personal_trainer”“training_session”“maintenance_task”清晰且领域相关。
    - 页面命名如“card_redemption_page”“equipment_inventory_page”能直接表达业务用途。
    - 权限命名前缀存在轻微不一致，如实体是“membership_card”但权限使用“card:redeem”，实体是“training_session”但权限使用“schedule:create”。

## 跨境物流报关

- 意图：构建跨境物流报关平台，覆盖运单管理、报关单申报、关税核算与清关状态跟踪
- 生成耗时：92.9s
- Gate：**PASS**（0 悬挂引用）
- 交叉引用完整性：共 172 条被检引用，悬挂 0 条（解析率 100.0%）
- 规模：8 实体 / 54 字段 / 6 角色 / 19 权限 / 6 菜单 / 10 流程节点 / 14 转移 / 5 页面 / 3 AIGC 能力 / 5 装配绑定
- 领域适配抽查：
  - 实体命中 6/8：importer Importer、carrier Carrier、waybill Cross Border Waybill、shipment_item Shipment Item、customs_declaration Customs Declaration、tariff_assessment Tariff Assessment、clearance_event Clearance Event、customs_document Customs Document
  - 角色命中 4/6：logistics_operator、customs_declarant、tariff_accountant、compliance_reviewer、clearance_manager、customer_service
  - 流程节点命中 9/10：draft_waybill Draft Waybill、prepare_declaration Prepare Customs Declaration、compliance_review Compliance Review、declaration_rejected Declaration Rejected、tariff_calculation Tariff Calculation、tariff_approval Tariff Approval、customs_submission Submit to Customs、clearance_monitor Clearance Status Monitoring、inspection_followup Customs Inspection Follow-up、clearance_completed Clearance Completed
  - 页面命中 4/5：page_waybill_management Waybill Management、page_declaration_preparation Customs Declaration Preparation、page_compliance_review Compliance Review Console、page_tariff_assessment Tariff Assessment、page_clearance_tracking Clearance Status Tracking
  - AIGC 能力命中 3/3：generate_goods_declaration_summary Generate Goods Declaration Summary、explain_tariff_assessment Explain Tariff Assessment、compose_clearance_customer_update Compose Clearance Customer Update
  - ⚠️ 泛化命名嫌疑（1）：shipment_item Shipment Item
- 内容质量（确定性启发式，零 LLM）：
  - 流程形状：5 个分支节点 · 有回退边
  - 可达性/权限：不可达页面 0 · 空页面 0 · 满权角色 0 · 孤儿权限 0 · 无用角色 0 · 孤儿实体 0
  - 结论：✅ 无 finding
- LLM 评审（1-5 量表 · temperature 0 · 同模型自评有自恋偏差，用于回归比对而非绝对分）：
  - 需求覆盖度：**5/5**
    - 显式覆盖“运单管理”，包括实体“waybill”“shipment_item”和页面“page_waybill_management”。
    - 显式覆盖“报关单申报”，包括“customs_declaration”、权限“declaration:submit”和流程“customs_submission:Submit to Customs”。
    - 显式覆盖“关税核算与清关状态跟踪”，包括“tariff_assessment”“clearance_event”和页面“page_clearance_tracking”。
  - 行业常识：**4/5**
    - 流程从“draft_waybill”到“prepare_declaration”“compliance_review”“customs_submission”“clearance_monitor”基本符合跨境报关作业链路。
    - 角色划分“customs_declarant”“tariff_accountant”“compliance_reviewer”“clearance_manager”贴近报关、关务和清关协作实际。
    - “tariff_calculation”放在“customs_submission”之前可用于预核算，但实际税费常依赖海关受理/审价结果，缺少海关回执与税单确认环节。
  - 命名质量：**4/5**
    - 核心命名如“customs_declaration”“tariff_assessment”“clearance_event”“shipment_item”领域指向明确且一致。
    - 页面命名“Customs Declaration Preparation”“Compliance Review Console”“Clearance Status Tracking”清晰表达业务用途。
    - 权限“customer:update”较突兀，模型中没有对应“customer”实体，和“compose_clearance_customer_update”存在命名边界不清。

## 医院药房库存

- 意图：开发医院药房库存管理系统，支持药品入库出库、批号效期预警和处方调剂发药
- 生成耗时：96.4s
- Gate：**PASS**（0 悬挂引用）
- 交叉引用完整性：共 211 条被检引用，悬挂 0 条（解析率 100.0%）
- 规模：7 实体 / 51 字段 / 5 角色 / 20 权限 / 6 菜单 / 10 流程节点 / 13 转移 / 8 页面 / 3 AIGC 能力 / 8 装配绑定
- 领域适配抽查：
  - 实体命中 6/7：drug 药品目录、supplier 供应商、drug_batch 药品批号库存、inventory_transaction 出入库流水、prescription 处方、prescription_item 处方明细、dispensing_record 调剂发药记录
  - 角色命中 2/5：inventory_clerk、pharmacist、pharmacy_manager、quality_controller、prescribing_doctor
  - 流程节点命中 9/10：prescription_submitted 处方提交、pharmacist_review 药师审方、inventory_check 库存与批号效期核验、manager_controlled_approval 特殊管制或库存异常审批、prepare_dispensing 调剂配药、issue_medicine 确认发药并扣减库存、quality_expiry_review 效期质量复核、returned_for_correction 退回修改、dispensing_rejected 拒绝发药、dispensing_completed 发药完成
  - 页面命中 7/8：drug_catalog_page 药品目录管理、supplier_qualification_page 供应商资质管理、stock_receiving_page 药品入库登记、stock_out_adjustment_page 出库与库存调整审批、expiry_warning_page 批号效期预警、prescription_entry_page 处方录入、dispensing_workbench_page 处方调剂发药工作台、controlled_dispensing_approval_page 管制药品发药审批
  - AIGC 能力命中 3/3：expiry_risk_summary 批号效期风险摘要生成、dispensing_review_assistant 处方审方与发药提示、reorder_and_stockout_notice 补货与缺货说明生成
  - ⚠️ 泛化命名嫌疑（2）：prescription_item 处方明细、dispensing_record 调剂发药记录
- 内容质量（确定性启发式，零 LLM）：
  - 流程形状：4 个分支节点 · 有回退边
  - 可达性/权限：不可达页面 0 · 空页面 0 · 满权角色 0 · 孤儿权限 0 · 无用角色 0 · 孤儿实体 0
  - 结论：✅ 无 finding
- LLM 评审（1-5 量表 · temperature 0 · 同模型自评有自恋偏差，用于回归比对而非绝对分）：
  - 需求覆盖度：**4/5**
    - 已覆盖核心能力："stock_receiving_page"支持入库，"stock_out_adjustment_page"和"inventory_transaction"支持出库/调整，"expiry_warning_page"支持批号效期预警，"dispensing_workbench_page"支持处方调剂发药。
    - "workflow"包含从"prescription_submitted"到"issue_medicine"的审方、库存核验、配药、发药闭环。
    - "drug_batch"字段中只明确看到"production_date"，未明确列出效期预警关键字段如失效日期/有效期至/预警阈值。
    - ❗漏建模：批号效期预警所需的失效日期或有效期字段未在"drug_batch"中明确体现
  - 行业常识：**4/5**
    - 实体划分符合医院药房场景，包含"药品目录"、"药品批号库存"、"出入库流水"、"处方"、"调剂发药记录"。
    - 角色设置较合理，"pharmacist"负责审方和发药，"quality_controller"负责效期质量复核，"pharmacy_manager"负责管制药品审批。
    - "inventory_check->manager_controlled_approval[管制药品或库存低于安全线]"略不符合常规，库存低于安全线通常触发补货预警，不一定需要经理审批才能发药。
  - 命名质量：**5/5**
    - 命名整体领域化且清晰，如"drug_batch"、"inventory_transaction"、"dispensing_record"、"expiry_warning_page"。
    - 权限命名基本按资源和动作组织，如"batch:receive"、"prescription:review"、"dispensing:issue"，可读性好。
    - 页面和工作流节点名称贴合业务语义，如"处方调剂发药工作台"、"库存与批号效期核验"、"确认发药并扣减库存"。

## 餐饮加盟督导

- 意图：搭建餐饮连锁加盟督导系统，包含巡店检查、整改跟踪和门店评分排名
- 生成耗时：145.9s
- Gate：**PASS**（0 悬挂引用）
- 交叉引用完整性：共 165 条被检引用，悬挂 0 条（解析率 100.0%）
- 规模：9 实体 / 62 字段 / 5 角色 / 13 权限 / 8 菜单 / 9 流程节点 / 13 转移 / 6 页面 / 3 AIGC 能力 / 6 装配绑定
- 领域适配抽查：
  - 实体命中 9/9：franchisee 加盟商、store 加盟门店、inspection_plan 巡店计划、checklist_item 巡检检查项、store_inspection 巡店检查记录、inspection_finding 巡检问题、corrective_action 整改任务、store_score 门店评分、ranking_snapshot 门店排名快照
  - 角色命中 3/5：operations_director、regional_supervisor、store_manager、franchisee_owner、quality_admin
  - 流程节点命中 9/9：plan_scheduled 制定巡店计划、onsite_inspection 现场巡店检查、inspection_submitted 提交巡检结果、rectification_required 门店整改、supervisor_verification 督导复核整改、quality_score_calculation 质量评分核算、director_ranking_review 运营总监审核排名、ranking_published 发布门店评分排名、inspection_rejected 巡检退回重填
  - 页面命中 6/6：store_directory_page 加盟门店档案、inspection_plan_page 巡店计划排程、mobile_inspection_page 现场巡店检查、corrective_tracking_page 整改跟踪与复核、score_ranking_page 门店评分排名、score_admin_page 评分核算与排名发布
  - AIGC 能力命中 3/3：generate_inspection_summary 生成巡检摘要、recommend_corrective_measure 生成整改建议、generate_score_commentary 生成评分点评
  - ⚠️ 泛化命名嫌疑（1）：checklist_item 巡检检查项
- 内容质量（确定性启发式，零 LLM）：
  - 流程形状：4 个分支节点 · 有回退边
  - 可达性/权限：不可达页面 0 · 空页面 0 · 满权角色 0 · 孤儿权限 0 · 无用角色 0 · 孤儿实体 0
  - 结论：✅ 无 finding
- LLM 评审：⚠️ 评审调用失败（fail-closed，不编分数）

## 物业报修工单

- 意图：做一个物业报修工单系统，业主提交报修、物业派单维修、完工验收与回访评价
- 生成耗时：50.9s
- Gate：**PASS**（0 悬挂引用）
- 交叉引用完整性：共 168 条被检引用，悬挂 0 条（解析率 100.0%）
- 规模：7 实体 / 47 字段 / 6 角色 / 16 权限 / 6 菜单 / 9 流程节点 / 10 转移 / 6 页面 / 3 AIGC 能力 / 6 装配绑定
- 领域适配抽查：
  - 实体命中 7/7：owner 业主、property_unit 房屋单元、repair_ticket 报修单、work_order 维修工单、technician 维修人员、inspection 完工验收、feedback 回访评价
  - 角色命中 3/6：owner、dispatcher、technician、inspector、customer_service、property_manager
  - 流程节点命中 9/9：submit_ticket 业主提交报修、triage_ticket 物业受理与分类、reject_ticket 无效报修退回、dispatch_work_order 派单维修人员、perform_repair 现场维修处理、complete_repair 维修完工提交、inspect_completion 完工验收、owner_feedback 业主回访评价、closed 工单关闭归档
  - 页面命中 6/6：owner_ticket_submit_page 业主提交报修页、dispatcher_triage_page 物业受理派单页、technician_repair_page 维修处理页、inspection_page 完工验收页、feedback_page 回访评价页、manager_report_page 物业经理报修看板
  - AIGC 能力命中 3/3：ai_ticket_classifier 报修内容智能分类与优先级建议、ai_repair_plan_generator 维修方案生成助手、ai_feedback_sentiment 回访评价情绪分析
  - 泛化命名嫌疑：无
- 内容质量（确定性启发式，零 LLM）：
  - 流程形状：2 个分支节点 · 有回退边
  - 可达性/权限：不可达页面 0 · 空页面 0 · 满权角色 0 · 孤儿权限 0 · 无用角色 0 · 孤儿实体 0
  - 结论：✅ 无 finding
- LLM 评审（1-5 量表 · temperature 0 · 同模型自评有自恋偏差，用于回归比对而非绝对分）：
  - 需求覆盖度：**5/5**
    - 已覆盖“业主提交报修”，包含“owner_ticket_submit_page”和流程节点“submit_ticket:业主提交报修@owner”。
    - 已覆盖“物业派单维修”，包含“dispatch_work_order:派单维修人员@dispatcher”和“perform_repair:现场维修处理@technician”。
    - 已覆盖“完工验收与回访评价”，包含“inspect_completion:完工验收@inspector”和“owner_feedback:业主回访评价@customer_service”。
  - 行业常识：**4/5**
    - 实体“repair_ticket”“work_order”“inspection”“feedback”的拆分符合物业报修从报修单到维修工单再到验收回访的常见流程。
    - 流程支持“inspect_completion->perform_repair[验收不通过需返修]”，符合维修返工闭环。
    - “owner_feedback:业主回访评价@customer_service”略显角色表达不清，若是业主评价应允许业主提交，若是客服回访应命名为客服回访记录。
  - 命名质量：**5/5**
    - 实体命名如“property_unit”“repair_ticket”“work_order”“technician”均具有物业报修领域含义。
    - 权限命名如“ticket:triage”“work_order:assign”“inspection:approve”粒度清晰且一致。
    - 页面命名如“dispatcher_triage_page”“technician_repair_page”“manager_report_page”与角色和业务场景匹配。

## 结论（诚实版）

- 生成成功 5/5，Gate 通过 5/5。
- 内容质量回归门：hard-fail 0 条 / warn 0 条（fail = 用户一上手就撞墙，如页面全员不可达；warn = 深度短板，盯趋势）。
- 关键词命中是抽查下限而非上限：中文实体名可能用同义词（如“课程”对“排期”），请结合原始命名列表人工复核。
