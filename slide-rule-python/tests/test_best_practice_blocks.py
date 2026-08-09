from services import schema_legal as legal


def _block(block_type: str):
    return next(block for block in legal.EXPERIENCE_BLOCKS if block["type"] == block_type)


def test_best_practice_blocks_are_real_generated_blocks_with_sources():
    expected = {
        "AttachmentPanel": "Qsnh/meedu",
        "CommentThread": "Qsnh/meedu",
        "RecordPicker": "nocobase/nocobase",
        "KanbanBoard": "d3george/slash-admin",
        "ScheduleCalendar": "d3george/slash-admin",
        "NotificationInbox": "ant-design/ant-design-pro",
        "TreeNavigator": "nocobase/nocobase",
        "ApprovalQueue": "nocobase/nocobase",
        "AuditTrail": "nocobase/nocobase",
        "DataImportWizard": "nocobase/nocobase",
        "AsyncTaskMonitor": "nocobase/nocobase",
        "PermissionMatrix": "nocobase/nocobase",
        "DataExportPanel": "nocobase/nocobase",
        "BulkEditPanel": "nocobase/nocobase",
        "MemberAssignment": "nocobase/nocobase",
        "ContextBreadcrumb": "ant-design/pro-components",
        "LiveRefreshControl": "ant-design/pro-components",
        "ActiveFilterSummary": "ant-design/pro-components",
        "AnalyticsDateScope": "ant-design/ant-design-pro",
        "HeaderEntitySummary": "ant-design/ant-design-pro",
        "HeaderProgressSummary": "ant-design/pro-blocks",
        "WorkspaceTabs": "d3george/slash-admin",
        "SavedViewTabs": "marmelab/react-admin",
        "AdvancedFilterBuilder": "nocobase/nocobase",
        "FacetedFilterPanel": "marmelab/react-admin",
        "WizardNavigationBar": "ant-design/pro-components",
        "ApprovalDecisionBar": "nocobase/nocobase",
        "CheckoutSummaryBar": "Qsnh/meedu",
        "RecordLifecycleBar": "refinedev/refine",
        "WaterfallChart": "apache/superset",
        "FunnelChart": "apache/superset",
        "DistributionHistogram": "apache/superset",
        "HeatmapMatrix": "apache/superset",
        "TreemapBreakdown": "apache/superset",
        "GaugeProgress": "apache/superset",
        "AlertTriagePanel": "grafana/grafana",
        "AlertSilenceForm": "grafana/grafana",
        "AlertRoutingPolicy": "grafana/grafana",
        "DeletedRecordsRecovery": "marmelab/react-admin",
        "RevisionHistoryPanel": "marmelab/react-admin",
        "RecordComparePanel": "grafana/grafana",
        "GanttSchedule": "apache/superset",
        "SankeyFlow": "apache/superset",
        "BoxPlotDistribution": "apache/superset",
        "RadarComparison": "apache/superset",
        "AlertRuleEditor": "grafana/grafana",
        "MuteTimingSchedule": "grafana/grafana",
        "ContactPointManager": "grafana/grafana",
        "ReferenceManyManager": "marmelab/react-admin",
        "GlobalSearchPalette": "marmelab/react-admin",
        "LiveChangeReview": "marmelab/react-admin",
    }
    for block_type, repo in expected.items():
        block = _block(block_type)
        assert block["rendererStatus"] == "real"
        assert block["generationEnabled"] is True
        assert block["source"]["repo"] == repo
        assert block["allowedRegions"]
        assert "required" in block["bindingSchema"]


def test_new_blocks_reuse_existing_contract_vocabulary():
    legal_events = set(legal.EXPERIENCE_BLOCK_EVENT_TYPES)
    legal_regions = set(legal.EXPERIENCE_BLOCK_ALLOWED_REGIONS)
    for block_type in (
        "AttachmentPanel",
        "CommentThread",
        "RecordPicker",
        "KanbanBoard",
        "ScheduleCalendar",
        "NotificationInbox",
        "TreeNavigator",
        "ApprovalQueue",
        "AuditTrail",
        "DataImportWizard",
        "AsyncTaskMonitor",
        "PermissionMatrix",
        "DataExportPanel",
        "BulkEditPanel",
        "MemberAssignment",
        "ContextBreadcrumb",
        "LiveRefreshControl",
        "ActiveFilterSummary",
        "AnalyticsDateScope",
        "HeaderEntitySummary",
        "HeaderProgressSummary",
        "WorkspaceTabs",
        "SavedViewTabs",
        "AdvancedFilterBuilder",
        "FacetedFilterPanel",
        "WizardNavigationBar",
        "ApprovalDecisionBar",
        "CheckoutSummaryBar",
        "RecordLifecycleBar",
        "WaterfallChart",
        "FunnelChart",
        "DistributionHistogram",
        "HeatmapMatrix",
        "TreemapBreakdown",
        "GaugeProgress",
        "AlertTriagePanel",
        "AlertSilenceForm",
        "AlertRoutingPolicy",
        "DeletedRecordsRecovery",
        "RevisionHistoryPanel",
        "RecordComparePanel",
        "GanttSchedule",
        "SankeyFlow",
        "BoxPlotDistribution",
        "RadarComparison",
        "AlertRuleEditor",
        "MuteTimingSchedule",
        "ContactPointManager",
        "ReferenceManyManager",
        "GlobalSearchPalette",
        "LiveChangeReview",
    ):
        block = _block(block_type)
        assert set(block["events"]) <= legal_events
        assert set(block["allowedRegions"]) <= legal_regions
        assert block["family"] in {"data", "filter", "action"}


def test_region_expansion_batch_stays_out_of_main():
    new_types = (
        "ContextBreadcrumb", "LiveRefreshControl", "ActiveFilterSummary", "AnalyticsDateScope",
        "HeaderEntitySummary", "HeaderProgressSummary",
        "WorkspaceTabs", "SavedViewTabs", "AdvancedFilterBuilder", "FacetedFilterPanel",
        "WizardNavigationBar", "ApprovalDecisionBar", "CheckoutSummaryBar", "RecordLifecycleBar",
    )
    for block_type in new_types:
        block = _block(block_type)
        assert "main" not in block["allowedRegions"]
        assert block["source"]["path"]


def test_analysis_and_review_batch_uses_mature_sources_and_existing_regions():
    new_types = (
        "WaterfallChart", "FunnelChart", "DistributionHistogram", "HeatmapMatrix",
        "TreemapBreakdown", "GaugeProgress", "AlertTriagePanel", "AlertSilenceForm",
        "AlertRoutingPolicy", "DeletedRecordsRecovery", "RevisionHistoryPanel", "RecordComparePanel",
    )
    for block_type in new_types:
        block = _block(block_type)
        assert block["source"]["repo"] in {"apache/superset", "grafana/grafana", "marmelab/react-admin"}
        assert set(block["events"]) <= set(legal.EXPERIENCE_BLOCK_EVENT_TYPES)
        assert set(block["allowedRegions"]) <= set(legal.EXPERIENCE_BLOCK_ALLOWED_REGIONS)


def test_scheduling_alert_configuration_and_relationship_batch_reuses_contracts():
    new_types = (
        "GanttSchedule", "SankeyFlow", "BoxPlotDistribution", "RadarComparison",
        "AlertRuleEditor", "MuteTimingSchedule", "ContactPointManager",
        "ReferenceManyManager", "GlobalSearchPalette", "LiveChangeReview",
    )
    for block_type in new_types:
        block = _block(block_type)
        assert block["rendererStatus"] == "real"
        assert set(block["events"]) <= set(legal.EXPERIENCE_BLOCK_EVENT_TYPES)
        assert set(block["allowedRegions"]) <= set(legal.EXPERIENCE_BLOCK_ALLOWED_REGIONS)


def test_booking_diagnostics_and_connection_batch_reuses_existing_contracts():
    by_repo = {
        "calcom/cal.com": {"AvailabilityPlanner", "BookingSlotPicker", "ScheduleConflictResolver"},
        "getsentry/sentry": {"StackTracePanel", "EventBreadcrumbTimeline", "SuspectCommitPanel"},
        "airbytehq/airbyte-platform": {"ConnectionTimeline", "SchemaChangeReview", "StreamStatusMonitor", "ConnectionMappingPanel"},
    }
    for repo, block_types in by_repo.items():
        for block_type in block_types:
            block = _block(block_type)
            assert block["source"]["repo"] == repo
            assert block["source"]["path"]
            assert block["rendererStatus"] == "real"
            assert set(block["events"]) <= set(legal.EXPERIENCE_BLOCK_EVENT_TYPES)
            assert set(block["allowedRegions"]) <= set(legal.EXPERIENCE_BLOCK_ALLOWED_REGIONS)


def test_sparse_region_batch_only_expands_the_seven_target_regions():
    expected = {
        "IssueCommandHeader": {"header"},
        "ConnectionControlHeader": {"header"},
        "EventUserCountMetrics": {"headerExtra", "metrics"},
        "JobRunMetrics": {"headerExtra", "metrics"},
        "OccurrenceEvidenceSummary": {"headerContent"},
        "ConnectionRouteSummary": {"headerContent"},
        "ResourceDetailTabs": {"tabs"},
        "InspectorModeTabs": {"tabs"},
        "IssueEventFilter": {"filters"},
        "TimelineFilterBar": {"filters"},
        "UnsavedChangesBar": {"footerBar"},
        "RunningJobControlBar": {"footerBar"},
    }
    for block_type, regions in expected.items():
        block = _block(block_type)
        assert set(block["allowedRegions"]) == regions
        assert block["rendererStatus"] == "real"
        assert block["source"]["path"]
        assert set(block["events"]) <= set(legal.EXPERIENCE_BLOCK_EVENT_TYPES)


def test_second_sparse_region_batch_keeps_exact_region_boundaries():
    expected = {
        "BookingCommandHeader": {"header"}, "AlertRuleCommandHeader": {"header"},
        "AlertStateMetrics": {"headerExtra", "metrics"}, "BookingCapacityMetrics": {"headerExtra", "metrics"},
        "BookingContextSummary": {"headerContent"}, "AlertInstanceSummary": {"headerContent"},
        "BookingStatusTabs": {"tabs"}, "ValidatedFormTabs": {"tabs"},
        "AlertMatcherFilter": {"filters"}, "BookingDirectoryFilter": {"filters"},
        "BookingDecisionBar": {"footerBar"}, "DashboardSaveBar": {"footerBar"},
    }
    for block_type, regions in expected.items():
        block = _block(block_type)
        assert set(block["allowedRegions"]) == regions
        assert block["rendererStatus"] == "real"
        assert block["source"]["path"]
        assert set(block["events"]) <= set(legal.EXPERIENCE_BLOCK_EVENT_TYPES)
