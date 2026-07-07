# Codex를 Claude Code에서 쓰기 — 셋업 · 토큰 갱신 · 트러블슈팅

> **이 문서를 여는 법**: PeterJ가 "codex 셋업 문서 / 코덱스 MCP 문서 불러와" 라고 하면
> 이 파일(`trend-review/docs/codex-mcp-setup.md`)을 연다. 다른 repo 세션이면
> `add_repo`로 `njell85-spec/trend-review`를 가져와 이 경로를 읽는다.
>
> 최초 셋업 완료: 2026-07-07 (PeterJ 데스크탑 Windows + 모바일 클코). 실동작 검증됨
> (새 세션 `/mcp`에 `mcp__codex__codex`·`mcp__codex__codex-reply` 로드 확인).

## 0. 한 줄 요약
데스크탑에서 만든 Codex 로그인 인증(`auth.json`)을 **Claude Code 클라우드 환경의 환경변수**로
옮기고, **setup script**가 매 환경에 Codex CLI를 설치 + 인증을 복원하며, repo의 **`.mcp.json`**이
`codex mcp-server`(stdio)를 등록한다 → 클코 세션(모바일 포함)에서 Codex를 도구로 호출.

## 1. 구조 (무엇이 어디에)
- **인증 원본**: PeterJ 데스크탑 `~/.codex/auth.json` (Windows: `%USERPROFILE%\.codex\auth.json`).
  ChatGPT **Plus** 로그인으로 생성(API 키 아님 — 추가 종량과금 없음). `codex login` 결과.
- **클라우드 환경(Default) 설정** — claude.ai/code → 구름 아이콘 → 환경 설정:
  - **네트워크 액세스 = 사용자 정의(Custom)** + "기본 목록 포함" 체크. 허용 도메인에 추가:
    `chatgpt.com`, `*.openai.com`, `api.openai.com` (+ 기존 github/npm 등 유지).
  - **환경 변수**: `CODEX_AUTH_B64=<auth.json의 base64 한 줄>`.
    ※ 이 플랫폼엔 암호화 시크릿 저장소가 없어 환경변수는 "환경 편집자에게 보임" — **이 환경을 공유하지 말 것**.
  - **설정 스크립트**(기존 내용 끝, `exit 0` **위**에 추가):
    ```bash
    npm install -g @openai/codex
    mkdir -p ~/.codex
    printf '%s' "$CODEX_AUTH_B64" | base64 -d > ~/.codex/auth.json
    # (선택·전역 자동화 시도) claude mcp add --scope user codex -- codex mcp-server 2>/dev/null || true
    ```
- **repo별 등록**: 각 repo 루트의 **`.mcp.json`**:
  ```json
  { "mcpServers": { "codex": { "command": "codex", "args": ["mcp-server"] } } }
  ```
  Claude Code on the web는 repo의 `.mcp.json`을 클론과 함께 로드한다(공식). `claude mcp add`로
  로컬에 넣은 건 원격에 안 넘어가므로 **`.mcp.json`이 정본**.

## 2. 로드된 도구
- `mcp__codex__codex` — 새 Codex 세션 시작(파라미터: `prompt` 필수 · `model` 예 gpt-5.2-codex ·
  `sandbox` read-only/workspace-write/danger-full-access · `approval-policy` · `cwd`).
- `mcp__codex__codex-reply` — 기존 Codex 대화 이어가기(`threadId`).

## 3. ★ 토큰 만료/인증 에러 시 (가장 흔한 고장) — 갱신 절차
증상: Codex 도구 호출이 인증 에러(로그인 만료/무효). 원인: `auth.json` 토큰 만료.
**고치는 법(데스크탑에서 2분)**:
1. 데스크탑 PowerShell에서 재로그인(필요 시): `codex login`
2. auth.json을 base64로 클립보드 복사:
   ```powershell
   [Convert]::ToBase64String([IO.File]::ReadAllBytes("$env:USERPROFILE\.codex\auth.json")) | Set-Clipboard
   ```
3. claude.ai/code → 구름 아이콘 → 환경 설정 → **환경 변수의 `CODEX_AUTH_B64=` 값만 새 base64로 교체** → 저장.
4. **새 세션**을 열면 setup script가 새 auth를 복원한다. (기존 세션엔 반영 안 됨)
   - ※ 환경변수만 바꿔도 setup script가 재실행 안 될 수 있음(캐시). 그러면 설정 스크립트를
     아무 문자(공백 한 칸 등)라도 건드려 저장 → 캐시 재빌드가 강제된다.

## 4. 다른 고장 & 점검
- **`/mcp`에 codex가 안 뜸**:
  ① 그 repo에 `.mcp.json` 있나(없으면 위 3줄 추가·커밋).
  ② 새 세션에서 확인했나(기존 세션은 MCP를 시작 시 로드 — 재시작 필요).
  ③ setup script가 실제로 돌아 codex가 깔렸나(첫 세션은 설치로 시작이 느림).
- **컨테이너에서 `codex: command not found`**: setup script의 `npm install -g @openai/codex`가
  실패(네트워크/레지스트리). 네트워크 "기본 목록 포함" 체크 확인.
- **OpenAI 연결 차단(403/타임아웃)**: 네트워크 허용 도메인에 `chatgpt.com`·`*.openai.com` 있나 확인.
- **codex를 MCP 서버로 못 띄움**: 명령은 `codex mcp-server`(= "Start Codex as an MCP server (stdio)").
  버전이 다르면 `codex --help`로 서브커맨드 확인.

## 5. 다른 repo에 Codex 붙이기 (전파)
- **방법 B(확실)**: 그 repo 루트에 위 `.mcp.json` 3줄 추가·커밋. (환경 셋업은 Default 환경에
  이미 있으므로 repo엔 이 파일만 있으면 됨.)
- **방법 A(전역 자동화·미확정)**: setup script에 `claude mcp add --scope user codex -- codex mcp-server`
  를 넣어 컨테이너 전역 등록 시도. 웹 세션이 전역 유저 설정을 읽으면 repo 파일 없이도 뜬다 —
  `.mcp.json` 없는 repo에서 새 세션 `/mcp`로 검증 후 채택.

## 6. 비용·보안 메모
- ChatGPT **Plus**로 인증 → Codex 사용은 구독 쿼터 내(추가 API 종량과금 아님).
- `CODEX_AUTH_B64`는 PeterJ의 ChatGPT 인증 토큰 → **채팅·공개 커밋 금지**, Default 환경 비공유 유지.
- 이 문서/`.mcp.json`은 공개 repo에 있어도 무방(민감정보 없음 — 인증은 환경변수에만).
