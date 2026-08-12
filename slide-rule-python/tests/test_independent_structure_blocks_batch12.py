from services import schema_legal as legal


TYPES = {
    "RoundRobinHostDistributionComposer": "weighted-priority-fixed-host-group-routing",
    "AssetStackPrimaryOrganizer": "asset-stack-primary-order-unstack",
    "ConversationCapacityPolicyComposer": "agent-fair-share-inbox-capacity-exclusion",
    "NotificationPolicyRouteTree": "notification-matcher-receiver-inheritance-route-tree",
}


def test_batch12_is_source_backed_real_and_unique():
    blocks = {block["type"]: block for block in legal.EXPERIENCE_BLOCKS}
    families = [block["structureFamily"] for block in legal.EXPERIENCE_BLOCKS if block.get("structureFamily")]
    assert len(families) == len(set(families))
    for block_type, family in TYPES.items():
        block = blocks[block_type]
        assert block["structureFamily"] == family
        assert block["structureDelta"]
        assert block["rendererStatus"] == "real" and block["generationEnabled"]
        assert block["allowedRegions"] == ["main"]
        assert block["source"]["repo"] and block["source"]["path"]
        assert block["rendererKey"] not in {"data-table", "pro-table", "entity-table"}


def test_batch12_catalog_keeps_its_338_baseline():
    assert legal.EXPERIENCE_BLOCK_CATALOG_VERSION >= 338
    assert len(legal.EXPERIENCE_BLOCKS) >= 338
    assert len({block["type"] for block in legal.EXPERIENCE_BLOCKS}) == len(legal.EXPERIENCE_BLOCKS)
    assert len([block for block in legal.EXPERIENCE_BLOCKS if block.get("structureFamily")]) >= 70
