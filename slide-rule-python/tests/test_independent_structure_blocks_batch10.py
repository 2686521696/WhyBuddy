from services import schema_legal as legal


TYPES = {
    "AuthenticationFlowExecutionTree": ("keycloak/keycloak", "authentication-execution-requirement-priority-tree"),
    "DashboardFilterScopeMapper": ("apache/superset", "dashboard-filter-field-chart-scope-tree"),
    "OrderFulfillmentAllocationComposer": ("saleor/saleor", "order-line-warehouse-quantity-fulfillment"),
    "AlertExpressionPipelineBuilder": ("grafana/grafana", "alert-query-expression-condition-dependency-chain"),
    "SyncWaveResourceSequencer": ("argoproj/argo-cd", "sync-phase-wave-health-gated-resource-sequence"),
    "ScaffolderTaskExecutionConsole": ("backstage/backstage", "scaffolder-step-log-output-execution-console"),
}


def test_batch10_families_are_globally_unique_and_real():
    structured = [block for block in legal.EXPERIENCE_BLOCKS if block.get("structureFamily")]
    assert len({block["structureFamily"] for block in structured}) == len(structured)
    blocks = {block["type"]: block for block in legal.EXPERIENCE_BLOCKS}
    selected = [blocks[block_type] for block_type in TYPES]
    assert len({block["rendererKey"] for block in selected}) == 6
    assert all(block["rendererStatus"] == "real" and block["generationEnabled"] and block["structureDelta"] for block in selected)


def test_batch10_sources_and_contracts_are_verified():
    blocks = {block["type"]: block for block in legal.EXPERIENCE_BLOCKS}
    for block_type, (repo, family) in TYPES.items():
        block = blocks[block_type]
        assert block["source"]["repo"] == repo and block["source"]["path"]
        assert block["structureFamily"] == family
        assert set(block["events"]) <= set(legal.EXPERIENCE_BLOCK_EVENT_TYPES)
        assert block["allowedRegions"] == ["main"]
        assert block["rendererKey"] not in {"data-table", "pro-table", "entity-table"}


def test_batch10_catalog_keeps_the_328_independent_baseline():
    assert legal.EXPERIENCE_BLOCK_CATALOG_VERSION >= 328
    assert len(legal.EXPERIENCE_BLOCKS) >= 328
    assert len({block["type"] for block in legal.EXPERIENCE_BLOCKS}) == len(legal.EXPERIENCE_BLOCKS)
    assert len([block for block in legal.EXPERIENCE_BLOCKS if block.get("structureFamily")]) >= 60
