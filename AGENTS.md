# Connect AI Codex 작업 지침

이 파일은 Codex가 이 프로젝트를 열었을 때 가장 먼저 읽는 기준 문서입니다. 기존 안티그래비티/Claude용 흔적보다 이 문서를 우선합니다.

## 프로젝트 목적

Connect AI Lab은 VS Code/Cursor 확장 프로그램입니다. 로컬 LLM(Ollama, LM Studio), 로컬 지식 폴더(`~/.connect-ai-brain`), 회사 폴더(`_company`)를 연결해 1인 기업용 멀티 에이전트 워크스페이스를 제공합니다.

## 핵심 파일

- `package.json`: VS Code extension manifest, 명령, 설정 스키마, npm scripts.
- `src/extension.ts`: 확장 프로그램의 메인 엔트리와 대부분의 런타임 로직.
- `src/agents.ts`: 에이전트 정의, 이름, 역할, 페르소나.
- `src/paths.ts`: 두뇌 폴더와 회사 폴더 경로 결정.
- `assets/webview/`: 사이드바/대시보드 webview HTML, JS, CSS.
- `web/`: VS Code 없이 브라우저에서 실행하는 standalone 웹 앱.
- `scripts/web-server.js`: standalone 웹 앱 서버와 `/api/status`, `/api/models`, `/api/chat` API.
- `assets/tool-seeds/`: 에이전트 도구 템플릿. 사용자의 로컬 자격증명은 여기에 넣지 않습니다.
- `out/`: 빌드 결과물이며 `.gitignore` 대상입니다. 직접 수정하지 않습니다.

## 실행과 검증

```bash
npm install
npm run compile
npm test
npm run web
npm run package:vsix
```

- `npm run compile`: `src/extension.ts`를 `out/extension.js`로 번들합니다.
- `npm test`: 현재는 컴파일 검증을 표준 테스트 진입점으로 사용합니다.
- `npm run web`: VS Code 확장 호스트 없이 `http://127.0.0.1:8788`에서 웹 앱을 실행합니다.
- `npm run package:vsix`: 컴파일 후 VSIX 패키지를 만듭니다.
- VS Code에서 직접 실행할 때는 `.vscode/launch.json`의 `Run Extension` 구성을 사용합니다.

## 변경 원칙

- 요청 범위와 직접 연결된 파일만 수정합니다.
- `assets/force-graph.min.js`, 픽셀 에셋, 대형 이미지, 생성 산출물은 명확한 요청 없이는 건드리지 않습니다.
- `package.json`의 `version`과 `src/extension.ts`의 `_CONNECT_AI_VERSION`은 함께 맞춥니다.
- 사용자 토큰, API 키, OAuth 파일, 로컬 개인 데이터는 출력하거나 커밋 대상으로 만들지 않습니다.
- 이 폴더는 git 저장소가 아닐 수 있습니다. git 상태가 없으면 파일/명령 결과로 변경을 검증합니다.
- 기존 `.claude/settings.json`은 레거시 도구 설정입니다. Codex 작업 기준은 이 `AGENTS.md`입니다.

## 완료 기준

코드 변경 후 최소 `npm test`를 통과시킵니다. standalone 웹 앱 변경이면 `npm run web:check`와 실제 `http://127.0.0.1:8788` 접속을 확인합니다. 패키징 또는 확장 설치 흐름을 건드렸다면 `npm run package:vsix`까지 확인합니다. UI/webview 변경이면 가능하면 Extension Host에서 실제 사이드바 렌더링까지 확인합니다.
