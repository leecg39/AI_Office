# Connect AI Lab — AutoResearch Session

## Baseline
- Date: 2026-06-09
- commit: c628612 (before experiments)
- Metrics:
  - compile_ok: 1
  - web_check_ok: 1
  - any_count: 280
  - ignore_catch_count: 383
  - cors_wildcard_count: 1
  - extension_ts_lines: 21782

## Phase 1: Inner Loop (Experiments 1–3)

| # | Scope | Delta ignore_catch | compile_ok | web_check_ok | Decision |
|---|-------|-------------------|------------|--------------|----------|
| 1 | paths.ts | -2 | 1 | 1 | KEEP |
| 2 | agents.ts (order/ids freeze) | 0 | 1 | 1 | KEEP |
| 3 | extension.ts (deactivate) | -6 | 1 | 1 | KEEP |

## Phase 2: Predict → Fix Chain (Experiments 4–6)

| # | Scope | Delta any | Delta ignore_catch | compile_ok | web_check_ok | Decision |
|---|-------|-----------|-------------------|------------|--------------|----------|
| 4 | extension.ts (metrics type) | -2 | -1 | 1 | 1 | KEEP |
| 5 | extension.ts (setup await) | 0 | 0 | 1 | 1 | KEEP |
| 6 | agents.ts (AGENTS freeze) | 0 | 0 | 1 | 1 | KEEP |

## Predict Report
- File: `autoresearch/predict-report.md`
- 5 personas: Architecture Reviewer, Security Analyst, Performance Engineer, Reliability Engineer, Devil's Advocate
- Consensus: CORS wildcard, silent catch blocks, `any` types are all high-confidence issues.

## Current Metrics
- compile_ok: 1
- web_check_ok: 1
- any_count: 278
- ignore_catch_count: 374
- cors_wildcard_count: 1
- extension_ts_lines: 21782

## Improvement
- ignore_catch_count: 383 → 374 (-2.3%)
- any_count: 280 → 278 (-0.7%)
- Success rate: 6/6 (100%)
- Discard: 0

## Remaining Issues (for future loops)
1. **CORS wildcard** (`cors_wildcard_count: 1`) — Bridge server allows any origin. Risky to fix without understanding all callers.
2. **any types** (`any_count: 278`) — Still massive. `catch (e: any)` alone accounts for ~114.
3. **File size** (`extension_ts_lines: 21782`) — Needs modularization roadmap.
4. **spawnSync blocking** — Performance issue in `gitExec`, `_killProcessesOnPort`.

## How to Resume
```bash
node autoresearch/eval/prepare.js
```
