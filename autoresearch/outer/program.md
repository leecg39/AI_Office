# Connect AI Lab — AutoResearch Program

## Goal
Improve code quality of Connect AI Lab VS Code extension by reducing unsafe patterns while keeping all builds and checks passing.

## Frozen Metrics
- `compile_ok`: must stay 1 (npm run compile passes)
- `web_check_ok`: must stay 1 (npm run web:check passes)

## Targets (Level 2 — agent can modify)
- `src/paths.ts`: empty catch blocks, type safety
- `src/system-specs.ts`: type safety
- `src/agents.ts`: immutability
- `src/extension.ts`: CORS wildcard, catch blocks, any types (touch only safe regions)
- `scripts/web-server.js`: CORS, input validation

## Constraints
- NEVER break existing functionality.
- NEVER modify test/QA scripts (`scripts/*-qa.js`, `scripts/qa-all.js`).
- NEVER modify `eval/` or `outer/`.
- One atomic change per experiment.
- git commit after each change with message: `experiment(<scope>): <description>`.
- If compile or web:check fails → DISCARD (git revert).

## Hints
1. `catch { }` → `catch (e) { console.warn(...) }` is usually safe in path/config utilities.
2. `any` → `unknown` + type guard is safe for error objects and parsed JSON.
3. CORS `*` → restrict to known local origins (`http://127.0.0.1:8788`, `vscode-webview://*`).
4. `Object.freeze(AGENTS)` is a safe one-liner.
5. Do NOT attempt large refactoring of `extension.ts` in a single experiment.
