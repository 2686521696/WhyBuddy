# Backend Python 104: Blueprint prompt package runtime takeover

## Execution status
- Status: pending
- Goal: implement a Python-owned prompt package build/validation slice for Blueprint, or formally retain Node prompt packaging.
- Required gate: `blueprintPromptPackageRuntimeTakeover104Gates`

## Context
103 marked `promptPackage` as `node-retained`. This task should target validation, normalization, or package metadata generation, not the full prompt stack.

## Allowed files
- `tws-ai-slide-rule-python/services/blueprint_prompt_package_runtime_takeover.py`
- `tws-ai-slide-rule-python/tests/test_blueprint_prompt_package_runtime_takeover_104.py`
- `server/routes/blueprint/prompt-package-runtime-takeover-python.ts`
- `server/routes/blueprint/prompt-package/*`
- `server/routes/__tests__/blueprint.prompt-package-runtime-takeover-104.test.ts`
- This task file

## Do not
- Do not rewrite prompt package generation end to end.
- Do not change user-visible prompt content unless a test locks the contract.
- Do not count schema-only validation as production takeover unless runtime consumption is tested.

## Acceptance criteria
- Python service validates or builds a minimal prompt package envelope.
- Node test verifies bridge consumption and retained fallback.
- Envelope includes ownership, takeover flag, and denominator accounting.
- Review confirms prompt-package status is not overstated.
