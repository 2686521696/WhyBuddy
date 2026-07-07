# 五系统模型多域生成质量评测（Five-System Generation Eval）

- 运行时间：2026-07-07 09:55 UTC
- 生成模型：`gpt-5.5`（真实 LLM，串行逐域，路由限流约束）
- 管线：`generate_five_system_model(intent)` → `validate_five_system_model(model)`（结构闭包 gate，任何悬挂交叉引用即 fail）
- 领域适配为启发式抽查信号（关键词命中 + 原始命名列表），供人工复核；不做打分粉饰。

## 汇总

| 领域 | 生成 | Gate | 内容质量 | LLM评审(覆盖/常识/命名) | 耗时(s) | 实体 | 字段 | 角色 | 权限 | 流程节点 | 转移 | 页面 | AIGC能力 | 交叉引用(悬挂/总数) | 实体域命中 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 连锁健身房 | ✅ | ✅ PASS | ✅ 0 fail / 0 warn | 4/4/5 (均4.33) | 76.1 | 7 | 37 | 5 | 15 | 8 | 10 | 4 | 3 | 0/139 | 7/7 |
| 跨境物流报关 | ✅ | ✅ PASS | ✅ 0 fail / 0 warn | 5/4/4 (均4.33) | 56.8 | 5 | 41 | 6 | 20 | 8 | 13 | 6 | 3 | 0/180 | 5/5 |
| 医院药房库存 | ✅ | ✅ PASS | ✅ 0 fail / 0 warn | 5/4/5 (均4.67) | 96.8 | 8 | 62 | 5 | 18 | 8 | 9 | 9 | 3 | 0/187 | 7/8 |
| 餐饮加盟督导 | ✅ | ✅ PASS | ✅ 0 fail / 0 warn | 4/4/5 (均4.33) | 96.1 | 8 | 53 | 6 | 16 | 8 | 12 | 8 | 3 | 0/183 | 8/8 |
| 物业报修工单 | ✅ | ✅ PASS | ✅ 0 fail / 0 warn | 5/4/4 (均4.33) | 87.3 | 7 | 49 | 5 | 16 | 9 | 11 | 6 | 3 | 0/171 | 7/7 |

## 连锁健身房

- 意图：做一个连锁健身房管理系统，包含私教排期、会员卡核销和器材保养
- 生成耗时：76.1s
- Gate：**PASS**（0 悬挂引用）
- 交叉引用完整性：共 139 条被检引用，悬挂 0 条（解析率 100.0%）
- 规模：7 实体 / 37 字段 / 5 角色 / 15 权限 / 5 菜单 / 8 流程节点 / 10 转移 / 4 页面 / 3 AIGC 能力 / 4 装配绑定
- 领域适配抽查：
  - 实体命中 7/7：member 会员、membership_card 会员卡、card_redemption 会员卡核销记录、personal_trainer 私教、training_session 私教课程排期、equipment 健身器材、maintenance_work_order 器材保养工单
  - 角色命中 3/5：front_desk、personal_trainer、gym_manager、maintenance_staff、finance_auditor
  - 流程节点命中 3/8：report_issue 提交器材保养申请、manager_triage 店长评估工单、routine_maintenance 常规保养安排、major_repair_approval 重大维修审批、repair_execution 执行保养维修、manager_acceptance 店长验收、closed 工单关闭、rejected 申请驳回
  - 页面命中 4/4：member_card_redemption_page 会员卡核销台、trainer_schedule_page 私教排期看板、equipment_maintenance_page 器材保养工单、manager_operations_dashboard 门店运营仪表盘
  - AIGC 能力命中 3/3：ai_trainer_schedule_optimizer AI私教排期优化、ai_maintenance_diagnosis AI器材故障诊断、ai_member_retention_advisor AI会员续卡建议
  - 泛化命名嫌疑：无
- 内容质量（确定性启发式，零 LLM）：
  - 流程形状：3 个分支节点 · 有回退边
  - 可达性/权限：不可达页面 0 · 空页面 0 · 满权角色 0 · 孤儿权限 0 · 无用角色 0 · 孤儿实体 0
  - 结论：✅ 无 finding
- LLM 评审（1-5 量表 · temperature 0 · 同模型自评有自恋偏差，用于回归比对而非绝对分）：
  - 需求覆盖度：**4/5**
    - 已覆盖核心三项："training_session/私教课程排期"、"card_redemption/会员卡核销记录"、"maintenance_work_order/器材保养工单"。
    - 页面与权限中有对应操作："card:redeem"、"session:schedule"、"maintenance:perform"。
    - 连锁健身房只以"branch_name"字符串体现，缺少门店/分店主数据与跨店管理能力。
    - ❗漏建模：连锁门店/分店管理实体及按门店维度的排期、核销、器材保养管理
  - 行业常识：**4/5**
    - 角色划分基本符合健身房运营："front_desk"负责核销/报修，"personal_trainer"负责课程，"gym_manager"审批验收，"maintenance_staff"执行保养。
    - 器材保养流程从"report_issue"到"manager_acceptance"再到"closed"，符合门店维修工单闭环。
    - "finance_auditor"角色存在但缺少对应财务审计流程或权限，显得未落地。
  - 命名质量：**5/5**
    - 实体命名具体且贴合领域，如"membership_card"、"card_redemption"、"training_session"、"maintenance_work_order"。
    - 页面命名清晰，如"member_card_redemption_page"、"trainer_schedule_page"、"equipment_maintenance_page"。
    - 权限命名风格一致，采用"card:redeem"、"session:schedule"、"maintenance:approve"等领域动作。

## 跨境物流报关

- 意图：构建跨境物流报关平台，覆盖运单管理、报关单申报、关税核算与清关状态跟踪
- 生成耗时：56.8s
- Gate：**PASS**（0 悬挂引用）
- 交叉引用完整性：共 180 条被检引用，悬挂 0 条（解析率 100.0%）
- 规模：5 实体 / 41 字段 / 6 角色 / 20 权限 / 6 菜单 / 8 流程节点 / 13 转移 / 6 页面 / 3 AIGC 能力 / 6 装配绑定
- 领域适配抽查：
  - 实体命中 5/5：shipment 跨境货运批次、waybill 运单、customs_declaration 报关单、duty_calculation 关税核算、clearance_status 清关状态跟踪
  - 角色命中 3/6：logistics_operator、customs_broker、duty_accountant、compliance_manager、warehouse_agent、customer_service
  - 流程节点命中 6/8：draft_waybill 创建并校验运单、prepare_declaration 制作报关单、compliance_review 报关合规审核、calculate_duties 核算关税税费、submit_to_customs 向海关申报、inspection_coordination 海关查验协同、customer_status_update 客户清关状态通知、rejected_or_returned 退回或拒绝处理
  - 页面命中 5/6：page_shipment_waybill 运单管理、page_customs_declaration 报关单申报、page_compliance_review 合规审核工作台、page_duty_calculation 关税核算、page_clearance_tracking 清关状态跟踪、page_customer_notification 客户清关通知
  - AIGC 能力命中 3/3：ai_hs_code_risk_assistant HS编码与申报风险提示、ai_duty_estimation_summary 关税核算摘要生成、ai_clearance_exception_explainer 清关异常原因说明生成
  - 泛化命名嫌疑：无
- 内容质量（确定性启发式，零 LLM）：
  - 流程形状：4 个分支节点 · 有回退边
  - 可达性/权限：不可达页面 0 · 空页面 0 · 满权角色 0 · 孤儿权限 0 · 无用角色 0 · 孤儿实体 0
  - 结论：✅ 无 finding
- LLM 评审（1-5 量表 · temperature 0 · 同模型自评有自恋偏差，用于回归比对而非绝对分）：
  - 需求覆盖度：**5/5**
    - 显式要求的“运单管理”由实体“waybill”和页面“page_shipment_waybill”覆盖
    - 显式要求的“报关单申报”由“customs_declaration”、权限“declaration:submit”和流程“submit_to_customs”覆盖
    - 显式要求的“关税核算”与“清关状态跟踪”分别由“duty_calculation”和“clearance_status”覆盖
  - 行业常识：**4/5**
    - 流程从“draft_waybill”到“prepare_declaration”“compliance_review”“calculate_duties”“submit_to_customs”基本符合跨境报关作业链路
    - 角色“customs_broker”“duty_accountant”“warehouse_agent”“customer_service”分工合理，贴近物流报关协同场景
    - 实体中“customs_declaration”直接放置“hs_code”偏粗，真实报关通常需要商品明细行、发票、箱单等资料结构
  - 命名质量：**4/5**
    - 核心命名如“waybill”“customs_declaration”“duty_calculation”“clearance_status”清晰且领域相关
    - 页面名“page_customs_declaration”“page_duty_calculation”“page_clearance_tracking”与业务能力对应一致
    - 存在少量未建模或略突兀的权限名，如“party:view”“inspection:update”，对应实体不明确

## 医院药房库存

- 意图：开发医院药房库存管理系统，支持药品入库出库、批号效期预警和处方调剂发药
- 生成耗时：96.8s
- Gate：**PASS**（0 悬挂引用）
- 交叉引用完整性：共 187 条被检引用，悬挂 0 条（解析率 100.0%）
- 规模：8 实体 / 62 字段 / 5 角色 / 18 权限 / 5 菜单 / 8 流程节点 / 9 转移 / 9 页面 / 3 AIGC 能力 / 9 装配绑定
- 领域适配抽查：
  - 实体命中 7/8：drug 药品档案、supplier 供应商、inventory_batch 库存批次、inbound_order 药品入库单、outbound_order 药品出库单、prescription 处方、dispensing_record 调剂发药记录、expiry_alert 批号效期预警
  - 角色命中 2/5：inventory_clerk、pharmacist、pharmacy_manager、quality_controller、finance_auditor
  - 流程节点命中 7/8：prescription_received 接收处方、pharmacist_review 药师审方、doctor_return_required 退回医生修改、stock_and_batch_check 库存批号效期核验、manager_exception_approval 特殊药品或近效期发药审批、dispense_and_counsel 调剂发药并用药交代、dispensing_completed 发药完成、dispensing_rejected 处方拒绝发药
  - 页面命中 8/9：drug_catalog_page 药品档案维护、supplier_qualification_page 供应商资质管理、inventory_batch_page 库存批次台账、inbound_receiving_page 药品入库验收、outbound_issue_page 药品出库管理、prescription_review_page 处方审方工作台、dispensing_counter_page 调剂发药窗口、expiry_alert_page 批号效期预警中心、inventory_report_page 库存报表与审计查询
  - AIGC 能力命中 3/3：expiry_action_advisor 近效期批次处理建议生成、prescription_review_assistant 处方合理用药审查辅助、patient_counseling_generator 患者用药交代生成
  - ⚠️ 泛化命名嫌疑（1）：dispensing_record 调剂发药记录
- 内容质量（确定性启发式，零 LLM）：
  - 流程形状：3 个分支节点 · 有回退边
  - 可达性/权限：不可达页面 0 · 空页面 0 · 满权角色 0 · 孤儿权限 0 · 无用角色 0 · 孤儿实体 0
  - 结论：✅ 无 finding
- LLM 评审（1-5 量表 · temperature 0 · 同模型自评有自恋偏差，用于回归比对而非绝对分）：
  - 需求覆盖度：**5/5**
    - 显式覆盖“药品入库出库”，包含实体“inbound_order”“outbound_order”和页面“inbound_receiving_page”“outbound_issue_page”。
    - 显式覆盖“批号效期预警”，包含实体“inventory_batch”“expiry_alert”和页面“expiry_alert_page”。
    - 显式覆盖“处方调剂发药”，包含“prescription”“dispensing_record”以及流程“pharmacist_review”“dispense_and_counsel”。
  - 行业常识：**4/5**
    - 流程包含“接收处方、药师审方、库存批号效期核验、调剂发药并用药交代”，符合医院药房实际业务主线。
    - “stock_and_batch_check:库存批号效期核验@inventory_clerk”在处方发药流程中略显不自然，实际通常由药师或系统按先进先出/近效期优先规则完成批次选择。
    - 实体有“供应商资质”“库存批次”“调剂发药记录”，但入库/出库单未体现明细行、库位、实收数量等医院库存常见结构。
  - 命名质量：**5/5**
    - 实体命名如“drug”“inventory_batch”“dispensing_record”“expiry_alert”清晰且贴合医院药房领域。
    - 页面命名如“prescription_review_page”“dispensing_counter_page”“expiry_alert_page”与业务场景一致。
    - 权限命名采用“resource:action”格式，如“inbound:create”“dispensing:confirm”“alert:handle”，整体一致性较好。

## 餐饮加盟督导

- 意图：搭建餐饮连锁加盟督导系统，包含巡店检查、整改跟踪和门店评分排名
- 生成耗时：96.1s
- Gate：**PASS**（0 悬挂引用）
- 交叉引用完整性：共 183 条被检引用，悬挂 0 条（解析率 100.0%）
- 规模：8 实体 / 53 字段 / 6 角色 / 16 权限 / 6 菜单 / 8 流程节点 / 12 转移 / 8 页面 / 3 AIGC 能力 / 8 装配绑定
- 领域适配抽查：
  - 实体命中 8/8：franchisee 加盟商、store 加盟门店、checklist_item 巡店检查项、inspection 巡店检查、inspection_finding 检查问题、corrective_action 整改任务、store_score 门店评分、ranking_snapshot 门店排名快照
  - 角色命中 3/6：franchisee_manager、store_manager、field_supervisor、regional_manager、quality_admin、ops_director
  - 流程节点命中 8/8：draft_inspection 督导创建巡店检查、store_acknowledge 门店确认问题、regional_review 区域经理复核巡店结果、corrective_plan 门店提交整改计划、supervisor_verify 督导复核整改、score_calculation 质量管理员计算评分、ranking_publish 运营总监发布排名、inspection_rejected 巡店结果退回
  - 页面命中 8/8：store_directory_page 加盟门店档案、checklist_admin_page 巡店检查标准配置、inspection_form_page 现场巡店检查单、regional_review_page 巡店结果区域复核、corrective_tracking_page 整改跟踪台账、score_calculation_page 门店评分计算、ranking_dashboard_page 门店评分排名榜、ai_assistant_page AI巡店与整改助手
  - AIGC 能力命中 3/3：inspection_summary_generator 巡店问题摘要生成、corrective_recommendation_generator 整改建议生成、ranking_insight_generator 门店排名洞察生成
  - ⚠️ 泛化命名嫌疑（1）：checklist_item 巡店检查项
- 内容质量（确定性启发式，零 LLM）：
  - 流程形状：4 个分支节点 · 有回退边
  - 可达性/权限：不可达页面 0 · 空页面 0 · 满权角色 0 · 孤儿权限 0 · 无用角色 0 · 孤儿实体 0
  - 结论：✅ 无 finding
- LLM 评审（1-5 量表 · temperature 0 · 同模型自评有自恋偏差，用于回归比对而非绝对分）：
  - 需求覆盖度：**4/5**
    - 已覆盖核心能力："inspection/巡店检查"、"corrective_action/整改任务"、"store_score/门店评分"和"ranking_dashboard_page/门店评分排名榜"均有建模。
    - "ranking_snapshot"只有"top_store_ref"和"bottom_store_ref"，未明确每家门店的排名明细或名次字段，支撑完整排名榜略弱。
    - ❗漏建模：完整门店排名明细/每店名次记录未明确建模
  - 行业常识：**4/5**
    - 角色划分符合连锁加盟督导场景，如"field_supervisor"、"regional_manager"、"quality_admin"、"ops_director"。
    - 流程包含门店确认、区域复核、整改计划、督导复核、评分发布，整体贴近餐饮连锁巡检闭环。
    - "inspection.supervisor_name(string)"使用姓名字符串而非督导用户引用，不利于权限、绩效和责任追溯。
  - 命名质量：**5/5**
    - 实体命名如"checklist_item"、"inspection_finding"、"corrective_action"、"store_score"具有明确餐饮督导业务语义。
    - 页面命名如"inspection_form_page"、"corrective_tracking_page"、"ranking_dashboard_page"清晰对应业务功能。
    - 权限命名采用"inspections:submit"、"corrective:verify"、"rankings:publish"等一致的资源动作格式。

## 物业报修工单

- 意图：做一个物业报修工单系统，业主提交报修、物业派单维修、完工验收与回访评价
- 生成耗时：87.3s
- Gate：**PASS**（0 悬挂引用）
- 交叉引用完整性：共 171 条被检引用，悬挂 0 条（解析率 100.0%）
- 规模：7 实体 / 49 字段 / 5 角色 / 16 权限 / 5 菜单 / 9 流程节点 / 11 转移 / 6 页面 / 3 AIGC 能力 / 6 装配绑定
- 领域适配抽查：
  - 实体命中 7/7：owner 业主、property_unit 房屋单元、maintenance_staff 维修人员、repair_ticket 报修工单、repair_assignment 派工维修、inspection 完工验收、callback_review 回访评价
  - 角色命中 4/5：owner、property_dispatcher、maintenance_worker、property_inspector、customer_service_manager
  - 流程节点命中 9/9：submit_ticket 业主提交报修、dispatcher_triage 物业受理与分类、ticket_rejected 报修不受理、assign_worker 派单给维修人员、repair_in_progress 上门维修处理、completion_inspection 物业完工验收、owner_acceptance 业主确认维修结果、callback_review 客服回访评价、closed 工单关闭归档
  - 页面命中 6/6：owner_ticket_submit_page 业主报修提交页、dispatcher_workbench_page 物业派单工作台、worker_mobile_repair_page 维修人员移动处理页、completion_inspection_page 完工验收页、owner_acceptance_review_page 业主确认与评价页、service_quality_report_page 回访质量报表页
  - AIGC 能力命中 3/3：repair_ticket_triage 报修内容智能分类与派单建议、repair_plan_generator 维修方案生成、review_sentiment_analyzer 回访评价情绪分析
  - 泛化命名嫌疑：无
- 内容质量（确定性启发式，零 LLM）：
  - 流程形状：3 个分支节点 · 有回退边
  - 可达性/权限：不可达页面 0 · 空页面 0 · 满权角色 0 · 孤儿权限 0 · 无用角色 0 · 孤儿实体 0
  - 结论：✅ 无 finding
- LLM 评审（1-5 量表 · temperature 0 · 同模型自评有自恋偏差，用于回归比对而非绝对分）：
  - 需求覆盖度：**5/5**
    - 明确覆盖“业主提交报修”，如流程节点“submit_ticket:业主提交报修@owner”和页面“owner_ticket_submit_page”。
    - 明确覆盖“物业派单维修”，如“dispatcher_triage”“assign_worker”“repair_in_progress”以及实体“repair_assignment”。
    - 明确覆盖“完工验收与回访评价”，如“completion_inspection”“owner_acceptance”“callback_review”和实体“inspection”“callback_review”。
  - 行业常识：**4/5**
    - 主流程从报修、受理分类、派单、维修、验收、业主确认到回访关闭，符合物业报修工单的常见业务闭环。
    - “completion_inspection->repair_in_progress[验收不通过需返工]”和“owner_acceptance->assign_worker[业主不满意需重新派修]”体现了返工场景，符合实际运营。
    - “callback_review:客服回访评价@customer_service_manager”由“customer_service_manager”执行略显不自然，实际更常见是客服专员或回访专员；“inspection.inspector_name(string)”也应更像人员引用。
  - 命名质量：**4/5**
    - 实体命名如“repair_ticket”“repair_assignment”“completion_inspection”“callback_review”具备明确物业报修语义，不是模板化占位名。
    - 页面命名如“dispatcher_workbench_page”“worker_mobile_repair_page”“service_quality_report_page”与角色和场景匹配，整体一致。
    - 少量命名可更精确，例如“customer_service_manager”偏管理岗，“owner_acceptance_review_page”同时包含确认与评价，和流程中的“callback_review”边界略混。

## 结论（诚实版）

- 生成成功 5/5，Gate 通过 5/5。
- 内容质量回归门：hard-fail 0 条 / warn 0 条（fail = 用户一上手就撞墙，如页面全员不可达；warn = 深度短板，盯趋势）。
- 关键词命中是抽查下限而非上限：中文实体名可能用同义词（如“课程”对“排期”），请结合原始命名列表人工复核。
