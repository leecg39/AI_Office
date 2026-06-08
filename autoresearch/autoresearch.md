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

## Experiments

| # | Scope | Delta ignore_catch | compile_ok | web_check_ok | Decision |
|---|-------|-------------------|------------|--------------|----------|
| 1 | paths.ts | -2 | 1 | 1 | KEEP |
| 2 | agents.ts | 0 | 1 | 1 | KEEP |
| 3 | extension.ts (deactivate) | -6 | 1 | 1 | KEEP |

## Current Metrics
- compile_ok: 1
- web_check_ok: 1
- any_count: 280
- ignore_catch_count: 375
- cors_wildcard_count: 1
- extension_ts_lines: 21782

## Improvement
- ignore_catch_count: 383 → 375 (-2.1%)
- Success rate: 3/3 (100%)

## Remaining Issues (for future loops)
1. **CORS wildcard** (`cors_wildcard_count: 1`) — Bridge server allows any origin.
2. **any types** (`any_count: 280`) — Massive `any` usage in `extension.ts`.
3. **File size** (`extension_ts_lines: 21782`) — Needs modularization.

## How to Resume
```bash
node autoresearch/eval/prepare.js
```
