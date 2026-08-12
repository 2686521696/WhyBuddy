from services import schema_legal as legal

TYPES={"CriticalPathDependencyScheduler":"dependency-propagated-critical-path-timebars","MitreTechniqueCoverageNavigator":"mitre-tactic-technique-coverage-mitigation-columns","BookingAvailabilityTroubleshooter":"booking-date-calendar-schedule-block-reason-diagnostic","NetworkPortPatchPanelComposer":"physical-port-endpoint-vlan-unique-patch"}

def test_batch13_is_source_backed_real_unique_and_non_table():
    blocks={b["type"]:b for b in legal.EXPERIENCE_BLOCKS}
    families=[b["structureFamily"] for b in legal.EXPERIENCE_BLOCKS if b.get("structureFamily")]
    assert len(families)==len(set(families))
    for block_type,family in TYPES.items():
        block=blocks[block_type]
        assert block["structureFamily"]==family and block["structureDelta"]
        assert block["rendererStatus"]=="real" and block["generationEnabled"]
        assert block["allowedRegions"]==["main"] and block["source"]["path"]
        assert block["rendererKey"] not in {"data-table","pro-table","entity-table"}

def test_batch13_catalog_holds_342():
    assert legal.EXPERIENCE_BLOCK_CATALOG_VERSION==342
    assert len(legal.EXPERIENCE_BLOCKS)==342
    assert len({b["type"] for b in legal.EXPERIENCE_BLOCKS})==342
    assert len([b for b in legal.EXPERIENCE_BLOCKS if b.get("structureFamily")])==74
