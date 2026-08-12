from services import schema_legal as legal


TYPES = {
    "FileShareAccessComposer": ("nextcloud/server", "file-share-recipient-link-permission-composer"),
    "IdentitySessionRevocationConsole": ("keycloak/keycloak", "identity-client-session-device-revocation"),
    "ColumnLineageImpactExplorer": ("datahub-project/datahub", "column-lineage-path-impact-highlighter"),
    "WorkflowCredentialBindingPanel": ("n8n-io/n8n", "workflow-node-credential-select-test-bind"),
    "MergeApprovalRuleMatrix": ("gitlab-org/gitlab", "merge-rule-approver-quorum-matrix"),
    "DocumentMailRuleComposer": ("paperless-ngx/paperless-ngx", "mail-match-document-metadata-action-rule"),
}


def test_batch9_families_are_globally_unique_and_real():
    structured = [block for block in legal.EXPERIENCE_BLOCKS if block.get("structureFamily")]
    assert len({block["structureFamily"] for block in structured}) == len(structured)
    blocks = {block["type"]: block for block in legal.EXPERIENCE_BLOCKS}
    selected = [blocks[block_type] for block_type in TYPES]
    assert len({block["rendererKey"] for block in selected}) == 6
    assert all(block["rendererStatus"] == "real" and block["generationEnabled"] and block["structureDelta"] for block in selected)


def test_batch9_sources_and_contracts_are_verified():
    blocks = {block["type"]: block for block in legal.EXPERIENCE_BLOCKS}
    for block_type, (repo, family) in TYPES.items():
        block = blocks[block_type]
        assert block["source"]["repo"] == repo and block["source"]["path"]
        assert block["structureFamily"] == family
        assert set(block["events"]) <= set(legal.EXPERIENCE_BLOCK_EVENT_TYPES)
        assert set(block["allowedRegions"]) <= set(legal.EXPERIENCE_BLOCK_ALLOWED_REGIONS)
        assert block["rendererKey"] not in {"data-table", "pro-table", "entity-table"}


def test_batch9_catalog_keeps_the_322_independent_baseline():
    assert legal.EXPERIENCE_BLOCK_CATALOG_VERSION >= 322
    assert len(legal.EXPERIENCE_BLOCKS) >= 322
    assert len({block["type"] for block in legal.EXPERIENCE_BLOCKS}) == len(legal.EXPERIENCE_BLOCKS)
    assert len([block for block in legal.EXPERIENCE_BLOCKS if block.get("structureFamily")]) >= 54
