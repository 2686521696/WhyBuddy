# Implementation Plan: MiroFish Visual Alignment

## Overview

渐进式 3-batch 迁移方案，将 MiroFish 极简视觉风格对齐到 AutopilotRoutePage 的 2D cockpit 区域。Batch 1 建立令牌与作用域基础设施（零视觉变化、零 DOM 变化），Batch 2 在 AutopilotRoutePage 中激活 2D cockpit scope，Batch 3 实现组件级 MiroFish 变体。

## Tasks

- [x] 1. Batch 1: Token + Scope Infrastructure
  - [x] 1.1 Create MiroFish token CSS file
    - Create `client/src/styles/mirofish-tokens.css`
    - Define all `--mf-*` custom properties at `:root` level
    - Color tokens: `--mf-color-bg` (#FFFFFF), `--mf-color-fg` (#000000), `--mf-color-accent` (#FF4500), `--mf-color-border` (#E5E5E5)
    - Typography tokens aliased to existing project variables: `--mf-font-title: var(--font-display)`, `--mf-font-mono: var(--font-mono)`, `--mf-font-body: "Noto Sans SC", var(--font-body)`
    - No @font-face declarations, no woff2 files, no deferred font loading
    - Spacing tokens: `--mf-gap-section` (60px), `--mf-gap-element` (16px), `--mf-max-width` (1400px)
    - Border tokens: `--mf-border` (1px solid #E5E5E5), `--mf-radius` (2px), `--mf-shadow` (none)
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

  - [x] 1.2 Create MiroFish layer CSS file
    - Create `client/src/styles/mirofish-layer.css`
    - Wrap all rules in `@layer mirofish { ... }`
    - Every selector MUST include `[data-theme="mirofish"]` — no bare selectors
    - Target named surface classes: `.glass-panel`, `.glass-panel-strong`, `.studio-surface`, `.workspace-panel`
    - Target `data-mf-*` attribute selectors: `[data-mf-surface]`, `[data-mf-card]`, `[data-mf-button="primary"]`
    - NO wildcard selectors like `[class*="rounded-"]` or `[class*="shadow-"]`
    - Apply typography overrides for headings (font-family, weight, letter-spacing)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

  - [x] 1.3 Declare CSS layer order and configure imports
    - Add `@layer base, components, utilities, mirofish;` at the top of `client/src/index.css`
    - In `client/src/main.tsx`, ensure import order: `./index.css` → `./styles/mirofish-tokens.css` → `./styles/mirofish-layer.css`
    - Verify no Tailwind configuration changes are required
    - _Requirements: 2.1, 2.6_

  - [x] 1.4 Implement MirofishThemeContext and Provider
    - Create `client/src/contexts/MirofishThemeContext.tsx`
    - This file defines the React context AND exports the `MirofishThemeProvider` component
    - Import `MirofishThemeContext` from this file in the hook file (avoids circular imports)
    - `MirofishThemeProvider` defaults to `enabled=false`
    - When `enabled=true`: render `<MirofishThemeContext.Provider value={true}>` wrapping a `<div data-theme="mirofish">` around children
    - When `enabled=false` (default): render `<MirofishThemeContext.Provider value={false}>` wrapping children DIRECTLY — NO wrapper `<div>` is added to the DOM. This ensures zero DOM changes in Batch 1 (no visual or structural impact when provider is disabled).
    - _Requirements: 2.2, 10.1, 10.4, 10.6, 10.7_

  - [x] 1.5 Implement useMirofishTheme hook
    - Create `client/src/hooks/useMirofishTheme.ts`
    - Import `MirofishThemeContext` from `@/contexts/MirofishThemeContext` (the context file)
    - Export `useMirofishTheme()` function that calls `useContext(MirofishThemeContext)` and returns boolean
    - No DOM fallback — only Context-based detection
    - No `useMirofishThemeDOM()` export — that function does not exist
    - _Requirements: 10.4, 10.5_

  - [ ]* 1.6 Write property test: CSS token source test (Property 1)
    - **Property 1: Token Namespace Isolation**
    - Parse `mirofish-tokens.css` as text, extract all custom property declarations
    - Verify every property name starts with `--mf-`
    - Use fast-check to generate random subsets of extracted tokens and validate namespace
    - Minimum 100 iterations
    - **Validates: Requirements 1.6**

  - [ ]* 1.7 Write property test: CSS layer source test (Property 2)
    - **Property 2: Theme Layer Selector Scoping**
    - Parse `mirofish-layer.css` as text, extract all CSS rule selectors within `@layer mirofish { ... }`
    - Verify every selector includes `[data-theme="mirofish"]` — no bare selectors
    - Minimum 100 iterations
    - **Validates: Requirements 2.2, 2.5, 10.2**

  - [ ]* 1.8 Write property test: Provider markup test (Property 3)
    - **Property 3: Provider Markup Contract**
    - Render `MirofishThemeProvider` with random boolean `enabled` values via fast-check
    - Verify `data-theme="mirofish"` present when `enabled=true`, absent when `enabled=false`
    - Verify NO wrapper `<div>` is rendered when `enabled=false` — children are rendered directly via Context.Provider only
    - Minimum 100 iterations
    - **Validates: Requirements 2.2, 10.1, 10.6, 10.7**

  - [ ]* 1.9 Write property test: Hook return value test (Property 6)
    - **Property 6: Shared Component Scope Detection**
    - Generate random nesting configurations (with/without `MirofishThemeProvider` ancestor)
    - Verify `useMirofishTheme()` returns correct boolean based on provider presence and `enabled` value
    - Minimum 100 iterations
    - **Validates: Requirements 10.4, 10.5**

- [x] 2. Checkpoint - Batch 1 verification
  - Ensure all tests pass, ask the user if questions arise.
  - Verify: no visual changes in the application (provider defaults to `enabled=false`)
  - Verify: no DOM changes when provider is disabled (no wrapper div added)
  - Verify: CSS files import without errors
  - Verify: layer order declaration does not break existing Tailwind styles

- [x] 3. Batch 2: AutopilotRoutePage 2D Cockpit Scope
  - [x] 3.1 Wrap 2D cockpit content with MirofishThemeProvider
    - In `client/src/pages/autopilot/AutopilotRoutePage.tsx`, wrap ONLY the 2D cockpit content area with `<MirofishThemeProvider enabled>`
    - `Scene3D` MUST remain OUTSIDE the provider — never receives MiroFish styles
    - `HoloDrawer` outer shell (animation, backdrop, layout) MUST remain OUTSIDE the provider
    - Mobile drawer shell MUST remain OUTSIDE the provider
    - Mobile drawer children (the `railElement` rendered inside `HoloDrawer`) SHALL also be wrapped in a separate `MirofishThemeProvider enabled` instance inside the drawer, ensuring mobile right-rail content receives MiroFish styles while the HoloDrawer outer shell (animation, backdrop, layout) remains unaffected
    - The provider wraps only: main content grid, right rail, left content (the 2D cockpit area)
    - _Requirements: 10.1, 10.2, 10.3_

  - [x] 3.2 Add data-mf-* attributes to key containers
    - Add `data-mf-surface` to the main cockpit grid container
    - Add `data-mf-card` to card-like containers within the 2D cockpit area
    - Do NOT do bulk class replacement — only add `data-mf-*` attributes
    - CSS layer handles visual flattening through these attributes automatically
    - Named surface classes (`.glass-panel`, `.studio-surface`) get MiroFish overrides automatically via CSS layer
    - _Requirements: 4.1, 4.2, 4.3, 5.1_

  - [x] 3.3 Implement animation reduction utility
    - Create `useMirofishMotionProps()` utility hook
    - When inside MiroFish scope: return `{ initial: false, animate: false, exit: undefined, transition: { duration: 0 } }`
    - When outside MiroFish scope: return empty object (default framer-motion behavior)
    - First-batch motion targets (apply `useMirofishMotionProps()` to these only):
      - `AutopilotRoutePage.tsx` — any `motion.div` / `AnimatePresence` in the 2D cockpit shell
      - `right-rail/stage-viewport/StageTransitionWrapper.tsx` — stage transition animations
    - Other right-rail sub-panel motion (`BridgeInvocationTimeline`, `CapabilityBridgePanel`, `RoleCrewDots`, `ExpandedConsolePanel`, `ReActPhaseBlock`) is deferred to per-panel migration; do NOT modify unless it causes visible inconsistency within MiroFish scope
    - Retain only: cursor blink, hover color transitions, `translateY(-2px)` button hover
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

  - [ ]* 3.4 Write integration test: AutopilotRoutePage scope boundary
    - Verify full AutopilotRoutePage renders without errors with 2D cockpit wrapped in MirofishThemeProvider
    - Verify Scene3D is NOT inside a `[data-theme="mirofish"]` scope
    - Verify HoloDrawer outer shell is NOT inside a `[data-theme="mirofish"]` scope
    - Verify mobile drawer children ARE inside a separate `MirofishThemeProvider enabled` scope
    - Verify 2D cockpit content IS inside a `[data-theme="mirofish"]` scope
    - Verify `MirofishThemeProvider` with default `enabled=false` does not apply any theme attributes and adds no wrapper div
    - _Requirements: 10.1, 10.2, 10.3, 10.6, 10.7_

- [x] 4. Checkpoint - Batch 2 verification
  - Ensure all tests pass, ask the user if questions arise.
  - Verify: 2D cockpit area receives MiroFish visual overrides (flat borders, no shadows, no rounded corners)
  - Verify: Scene3D and HoloDrawer shell remain visually unchanged
  - Verify: named surface classes within scope get automatic MiroFish treatment
  - Verify: mobile drawer children receive MiroFish styles while drawer shell is unaffected

- [x] 5. Batch 3: Component-Level MiroFish Variants
  - [x] 5.1 Implement MetricBox MiroFish variant
    - In MetricBox component, use `useMirofishTheme()` to detect scope
    - When in MiroFish scope: render with `data-mf-card` attribute, `1px solid var(--mf-color-border)`, no border-radius, no shadow, monospace font for value, uppercase 10px tracking-wide label
    - When outside scope: render original styling unchanged
    - _Requirements: 8.1_

  - [x] 5.2 Implement ApiErrorNotice MiroFish variant
    - In ApiErrorNotice component, use `useMirofishTheme()` to detect scope
    - When in MiroFish scope: render with black left border (4px), white background, black text instead of rose color scheme
    - When outside scope: render original styling unchanged
    - _Requirements: 8.2_

  - [x] 5.3 Implement AutopilotLanguageSwitch MiroFish variant
    - In AutopilotLanguageSwitch component, use `useMirofishTheme()` to detect scope
    - When in MiroFish scope: active state = full black background with white monospace text; inactive state = transparent with black text
    - When outside scope: render original styling unchanged
    - _Requirements: 8.3_

  - [x] 5.4 Implement FlowStep indicator MiroFish variant
    - IF FlowStep indicators are not currently a separate component, first extract a `FlowStepIndicator` component (or equivalent inline conditional) from the existing `flowSteps` map rendering in `AutopilotRoutePage.tsx`. Props should include `{ status: FlowStatus; icon?: LucideIcon }` or match existing structure. THEN apply MiroFish variant branch.
    - In the FlowStepIndicator component, use `useMirofishTheme()` to detect scope
    - When in MiroFish scope: use `■` (U+25A0) for completed/active states, `□` (U+25A1) for waiting/blocked states
    - When outside scope: render original colored circle icons unchanged
    - _Requirements: 8.4_

  - [x] 5.5 Implement StageCTA (primary action button) MiroFish variant
    - StageCTA is located at `client/src/pages/autopilot/right-rail/stage-viewport/StageCTA.tsx` and is rendered within `AutopilotRightRail -> StageViewport`. Since the provider wraps the right rail content area (task 3.1), StageCTA will be inside the MiroFish scope and can read `useMirofishTheme()` correctly.
    - In StageCTA component, use `useMirofishTheme()` to detect scope
    - When in MiroFish scope: render with `data-mf-button="primary"`, full-width, black background, white monospace text, no border-radius, `translateY(-2px)` on hover as only motion effect
    - When outside scope: render original styling unchanged
    - _Requirements: 8.5_

  - [ ]* 5.6 Write property test: Component attribute test (Property 4)
    - **Property 4: Component Attribute Contract**
    - Render MetricBox, ApiErrorNotice, AutopilotLanguageSwitch, StageCTA inside and outside `MirofishThemeProvider`
    - Verify components output correct `data-mf-*` attributes or MiroFish-specific classes when in themed context (`enabled=true`)
    - Verify components do NOT output `data-mf-*` attributes when outside provider or `enabled=false`
    - Minimum 100 iterations
    - **Validates: Requirements 4.1, 4.3, 8.1, 8.2, 8.3, 8.5**

  - [ ]* 5.7 Write property test: FlowStep mapping test (Property 5)
    - **Property 5: FlowStep Indicator Mapping**
    - Generate random `FlowStatus` values from valid set (`done`, `active`, `waiting`, `blocked`, etc.) via fast-check
    - Verify `■` (U+25A0) rendered for completed/active states
    - Verify `□` (U+25A1) rendered for waiting/blocked states
    - Reliable in jsdom — tests React render output, not CSS computed styles
    - Minimum 100 iterations
    - **Validates: Requirements 8.4**

  - [ ]* 5.8 Write unit tests for component MiroFish variants
    - MetricBox renders with `data-mf-card` and MiroFish classes when inside theme scope
    - ApiErrorNotice renders with black left border in MiroFish scope
    - AutopilotLanguageSwitch active state uses black background + white mono text in scope
    - StageCTA renders with `data-mf-button="primary"` in MiroFish scope
    - FlowStepIndicator renders ■/□ symbols correctly in MiroFish scope
    - All components render original styling when outside scope
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

- [x] 6. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.
  - Verify: all 5 component variants render correctly in both themed and unthemed contexts
  - Verify: right-rail panels are NOT modified (out of Batch 3 scope)
  - Verify: existing right-rail primitives (`metrics-row.tsx`, `status-capsule.tsx`, `sub-stage-card.tsx`) remain unchanged as reference standards

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation per batch
- Property tests validate universal correctness properties via source-level contract tests (no jsdom computed-style reliance)
- Unit tests validate specific examples and edge cases
- Font tokens alias to existing project CSS variables — no @font-face, no woff2, no deferred font loading
- CSS layer targets named surface classes and `data-mf-*` attributes only — no wildcard selectors
- Provider defaults to `enabled=false` — when disabled, renders children directly via Context.Provider WITHOUT any wrapper `<div>` (zero DOM changes)
- Only when `enabled=true` does the provider render `<div data-theme="mirofish">`
- Context is defined in `contexts/MirofishThemeContext.tsx` (creates context + exports provider). Hook file `hooks/useMirofishTheme.ts` imports context from the context file and exports the hook. This avoids circular imports.
- Scope wraps only 2D cockpit content — Scene3D, HoloDrawer shell stay outside
- Mobile drawer children (railElement inside HoloDrawer) get a separate MirofishThemeProvider enabled instance
- Right-rail panels are NOT in Batch 3 scope; existing primitives are reference standards
- `useMirofishTheme()` is Context-based only — no DOM fallback (`useMirofishThemeDOM()` does not exist)

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.4", "1.5"] },
    { "id": 1, "tasks": ["1.2", "1.3"] },
    { "id": 2, "tasks": ["1.6", "1.7", "1.8", "1.9"] },
    { "id": 3, "tasks": ["3.1"] },
    { "id": 4, "tasks": ["3.2", "3.3"] },
    { "id": 5, "tasks": ["3.4"] },
    { "id": 6, "tasks": ["5.1", "5.2", "5.3", "5.4", "5.5"] },
    { "id": 7, "tasks": ["5.6", "5.7", "5.8"] }
  ]
}
```
