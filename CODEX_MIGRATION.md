# Codex Migration

## 마이그레이션 목표

이 프로젝트는 기존 안티그래비티/Claude 중심 작업 흔적을 보존하되, Codex가 바로 분석, 수정, 빌드, 검증할 수 있는 구조로 정리했습니다.

## Codex 기준점

- 루트 `AGENTS.md`를 추가해 프로젝트 목적, 핵심 파일, 금지할 변경, 검증 명령을 명시했습니다.
- `npm test`를 표준 검증 진입점으로 만들었습니다.
- `npm run package:vsix`를 VSIX 생성 진입점으로 만들었습니다.
- `npm run web`를 VS Code 없이 실행되는 standalone 웹사이트 진입점으로 만들었습니다.
- 오래된 IDE 고정 안내는 VS Code/Cursor/IDE 기준 표현으로 바꿨습니다.

## 레거시로 남긴 것

- `.claude/settings.json`은 삭제하지 않았습니다. 다른 도구에서 쓰던 설정일 수 있고 Codex는 이 파일을 기준으로 삼지 않습니다.
- `.secondbrain/` 샘플 지식 데이터는 제품 동작 맥락이므로 그대로 보존했습니다.

## Codex 작업 체크리스트

1. `AGENTS.md`를 먼저 읽고 요청 범위를 정합니다.
2. 관련 파일만 좁혀서 수정합니다.
3. `npm test`로 컴파일 검증을 통과시킵니다.
4. 웹사이트 실행 변경이면 `npm run web:check`와 `http://127.0.0.1:8788` 접속을 확인합니다.
5. 패키징 관련 변경이면 `npm run package:vsix`까지 실행합니다.
6. 검증하지 못한 항목은 최종 보고에 남깁니다.
