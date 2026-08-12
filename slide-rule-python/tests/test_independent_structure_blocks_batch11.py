from services import schema_legal as legal

TYPES={"DatacenterRackUnitPlanner":"rack-front-rear-unit-lane-placement","DeviceCommandDispatchConsole":"device-capability-command-parameter-receipt","SubscriptionPhaseOverrideComposer":"subscription-plan-phase-price-effective-policy","DocumentPermissionMovePlanner":"document-collection-move-permission-diff","CiStageJobGraphConsole":"ci-stage-column-parallel-manual-job-graph","SerialBatchAllocationScanner":"serial-batch-scan-quantity-closure"}

def test_batch11_is_real_unique_and_main_only():
    blocks={b["type"]:b for b in legal.EXPERIENCE_BLOCKS}
    families=[b["structureFamily"] for b in legal.EXPERIENCE_BLOCKS if b.get("structureFamily")]
    assert len(families)==len(set(families))
    for block_type,family in TYPES.items():
        block=blocks[block_type]
        assert block["structureFamily"]==family and block["structureDelta"]
        assert block["rendererStatus"]=="real" and block["generationEnabled"]
        assert block["allowedRegions"]==["main"] and block["source"]["path"]
        assert block["rendererKey"] not in {"data-table","pro-table","entity-table"}

def test_batch11_catalog_keeps_its_334_baseline():
    assert legal.EXPERIENCE_BLOCK_CATALOG_VERSION >= 334
    assert len(legal.EXPERIENCE_BLOCKS) >= 334
    assert len({b["type"] for b in legal.EXPERIENCE_BLOCKS}) == len(legal.EXPERIENCE_BLOCKS)
    assert len([b for b in legal.EXPERIENCE_BLOCKS if b.get("structureFamily")]) >= 66
