# SlideRule Skill Package

This directory stores the packaged Agent Skill artifact and a partial script mirror.

## Layout

- `sliderule.zip` - The canonical, complete, ready-to-import Skill package. It contains `SKILL.md`, `docs/`, `examples/`, and `scripts/`. Install this artifact.
- `sliderule/` - A partial unpacked mirror containing only validation and fallback `scripts/`. It is not the complete skill and is not ready to install. The zip is canonical.

## Install

The package follows the standard Agent Skills ecosystem format used by `anthropics/skills`. This repo does not expose a repository-root `SKILL.md`, so install from the zip. From the repo root:

```bash
unzip skills/sliderule.zip
```

Or from a clean directory containing the archive:

```bash
unzip sliderule.zip
```

Then drop the resulting `sliderule/` folder into your agent host's skills directory (Trae: Skills · Claude: skill).

Use case: one sentence in -> a reviewable, deliverable spec package out, with every gate actually run by scripts.

## Image Generation Configuration

For module UI previews, provide an image endpoint key:

```bash
export IMAGE_API_KEY=sk-...           # or fill image_config.json -> api_key
# default: gpt-image-2 · 2K · 16:9 · 600s timeout (all configurable)

# Generate or regenerate images yourself at any time, one per module.
# Run these from inside the extracted skill folder:
cd sliderule
python scripts/finalize_previews.py           # module images from spec_tree
python scripts/batch_images.py prompts.txt    # batch generation against your endpoint

# Audit any image run in one command, catching fake, fallback, or duplicated images:
python scripts/check_previews_real.py
```

All image settings live in a single file: **`image_config.json`** at the project root.

```jsonc
{
  "enabled": true,
  "mode": "http", // "http" | "dry_run" | "mcp" | "command"
  "model": "gpt-image-2", // ← change model here
  "api_key": "", // ← put your key here (or use env var below)
  "timeout": 600, // seconds per image request
  "out_dir": "previews",
  "http": {
    "url": "", // ← put your endpoint URL here
    "method": "POST",
    "headers": {
      "Content-Type": "application/json",
      "Authorization": "Bearer ${IMAGE_API_KEY}", // resolves from env
    },
    "body_template": {
      "model": "${MODEL}", // auto-filled from top-level "model"
      "prompt": "${PROMPT}", // auto-filled per module
      "response_format": "b64_json",
      "image_size": "2K", // "512" | "1K" | "2K" | "4K"
      "aspect_ratio": "16:9",
      "n": 1,
    },
  },
}
```

**Three things to configure:**

| What             | Where                                                                  | Example                                                                     |
| :--------------- | :--------------------------------------------------------------------- | :-------------------------------------------------------------------------- |
| **API Key**      | Env var `IMAGE_API_KEY` (recommended) OR `image_config.json → api_key` | `export IMAGE_API_KEY=sk-abc123...`                                         |
| **Endpoint URL** | `image_config.json → http.url`                                         | `https://api.openai.com/v1/images/generations`                              |
| **Model**        | `image_config.json → model`                                            | `gpt-image-2` / `gemini-2.5-flash-image` / `gemini-3.1-flash-image-preview` |

> Priority: environment variable `IMAGE_API_KEY` > config file `api_key`. If both are empty, image generation is skipped and the gate records "no key".

## Output Package Structure

```text
<project-name>/
├─ spec_tree.json            ← structure source; docs / matrix / images all derive from it
├─ clarified_brief.json      goal · constraints · numbered success criteria
├─ route_options.json · selected_route.json · decision_mode.json
├─ traceability_matrix.json  traceability matrix: requirement ↔ design ↔ task ↔ evidence ↔ test case
├─ docs/
│  ├─ requirements.md · design.md · tasks.md
│  ├─ interface_contracts.md · test_cases.md · open_items.md
│  └─ prompt_pack.md · effect_preview.md · architecture.mmd
├─ checks_ledger.json        every gate's real script + exit code + output (not hand-waved)
├─ companion_log.json        companion trace: what the critic flagged · which real sources were cited
├─ handoff_manifest.json     delivery manifest: every artifact carries source + confidence labels
├─ previews/                 per-module UI mockups ("preview · unverified") + provenance.json
└─ scripts/                  deterministic scripts — the floor itself
   ├─ gate.py                     ledger wrapper: run any check and record the result
   ├─ validate_spec_tree.py       SPEC tree validation: structure · coverage · EARS · evidence sources
   ├─ check_content_quality.py    document validation: required sections · length · EARS acceptance
   ├─ check_companion.py          companion trace must be real
   ├─ finalize_previews.py        image gate: generate real module images, judged by real success count
   ├─ check_previews_real.py      audit: catch fake / fallback / duplicate images
   ├─ batch_images.py             standalone batch image generation
   └─ fallback_tree.py            naturally valid minimal tree when the LLM is unavailable
```

## How to Know It Is Not Faking It

- **`checks_ledger.json`** — what ran, exit code, and output. Written automatically by scripts.
- **`companion_log.json`** — what the critic flagged and which real sources the grounding cited.
- **Provenance labels** — `previews/*.png` are marked "preview · unverified"; `interface_contracts.md` is marked "draft · unverified".
- **`check_previews_real.py`** — one command tells you whether images are real generations or placeholders.
