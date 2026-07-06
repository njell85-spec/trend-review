# 데스크탑 데이 가이드 — Phase 2·3 1회성 설정 (예상 1~2시간)

> 스펙: `docs/superpowers/specs/2026-07-05-phase2-notebooklm-phase3-youtube-design.md` §2
> 이 문서 순서대로만 진행하면 됩니다. 이후 일상 운영은 전부 폰으로 충분합니다.

## 준비물
- 데스크탑 브라우저(Google 계정 로그인) + 이 저장소 클론 (`git pull` 먼저)
- Node 18+ (`npm ci` 완료 상태)

## 1. GCP 프로젝트 생성 + API 활성화 (15분)
1. https://console.cloud.google.com → 새 프로젝트 (이름 예: `trend-review`)
2. "API 및 서비스 → 라이브러리"에서 아래 3개를 각각 **사용 설정**:
   - Google Drive API
   - YouTube Data API v3
   - Cloud Text-to-Speech API

## 2. OAuth 클라이언트 + 동의 화면 (15분)
1. "API 및 서비스 → OAuth 동의 화면": User Type **외부**, 앱 이름 `trend-review`,
   본인 이메일 입력 → **테스트 사용자에 본인 Gmail 추가** (⚠️ 빠뜨리면 로그인 차단됨).
   게시 상태는 "테스트" 유지(심사 불필요 · refresh token은 계속 유효).
2. "사용자 인증 정보 → 사용자 인증 정보 만들기 → OAuth 클라이언트 ID":
   유형 **데스크톱 앱** → 생성 → **JSON 다운로드** → 저장소 루트에 `credentials.json`으로 저장
   (gitignore 대상 — 커밋 금지, spec-lint가 감시).

## 3. refresh token 발급 (10분)
```bash
node scripts/google-auth-setup.mjs
```
- 브라우저가 열리면 본인 계정 선택 → 경고 화면("확인되지 않은 앱")에서 **고급 → 이동** → Drive·YouTube 권한 허용.
- 터미널에 출력되는 `GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN` 3줄을 복사.
- ⚠️ 출력값은 비밀 — 등록 후 터미널 기록 삭제.

## 4. Cloud TTS API 키 (5분)
"사용자 인증 정보 → 만들기 → API 키" → 생성된 키를 복사.
(권장: 키 제한에서 "Cloud Text-to-Speech API"만 허용)

## 5. GitHub Secrets 등록 (10분)
repo → Settings → Secrets and variables → Actions:

| 이름 | 값 |
|---|---|
| `GOOGLE_CLIENT_ID` | 3번 출력값 |
| `GOOGLE_CLIENT_SECRET` | 3번 출력값 |
| `GOOGLE_REFRESH_TOKEN` | 3번 출력값 |
| `GOOGLE_TTS_API_KEY` | 4번 키 |

Variables `GOOGLE_DRIVE_FOLDER_ID`는 **등록하지 않습니다** — 폴더는 첫 실행 때 자동 생성(6-b 참고).

## 6. Drive 폴더 + YouTube 전용 채널 (10분)
- a. https://youtube.com → 프로필 → "채널 만들기" → **브랜드 계정으로 새 채널** (영어 채널, 이름 예: `Trend Review EM/CCM`).
  발신물은 영어 단일 버전으로 시작(확정 07-06). 한국어 채널은 추후 필요 시 추가.
  ⚠️ 3번 인증 때 이미 로그인한 같은 Google 계정이어야 함. 채널만 새로 만들면 됨.
  (브랜드 채널에 올리려면 3번 승인 화면에서 해당 채널/계정을 선택했어야 함 — 채널을 먼저 만들고 3번을 다시 실행하는 순서도 무방)
- b. Drive 폴더는 **만들지 않아도 됩니다** — 첫 실행 때 파이프라인이 내 드라이브 루트에
  `trend-review` 폴더를 자동 생성합니다. (⚠️ Drive 웹에서 손으로 만든 폴더는 이 앱의
  `drive.file` 스코프로 접근이 불가해, 그 ID를 `GOOGLE_DRIVE_FOLDER_ID`에 넣으면 무시되고
  자동 생성 폴더로 폴백합니다. Variables `GOOGLE_DRIVE_FOLDER_ID`는 비워 두세요.)

## 6+. 수동 디깅용 Fine-grained PAT (5분, 선택이지만 권장)
직접 지정 분석을 대시보드에서 바로 쓰려면:
1. https://github.com/settings/personal-access-tokens → "Generate new token (fine-grained)"
2. Repository access → **Only select repositories → `trend-review`만**
3. Permissions → Repository → **Actions: Read and write** (그 외는 최소)
4. 생성된 토큰(`github_pat_...`)을 복사 → 나중에 폰에서 대시보드 "직접 지정 분석 → 토큰 설정"에 1회 붙여넣기.
   (이 토큰은 GitHub Secrets가 아니라 **PeterJ 폰 브라우저에만** 저장됨. 만료 기간은 길게 설정 권장.)

## 7. NotebookLM 노트북 (10분)
1. https://notebooklm.google.com → 새 노트북 (이름 예: `Trend Review 2026-07`)
2. 첫 데일리 실행(8번) 후 Drive에 생긴 `Trend Review — 2026-07` Doc을 "소스 추가 → Google Drive"로 연결.
   → 이후 매일 자동 동기화. **월초마다 새 달 Doc 1개만 추가**하면 됨(30초).
3. (선택) 쌓인 원문 PDF들을 일괄 소스 추가 — 주 1회 폰에서 5분.

## 8. 검증 (15분)
1. repo → Actions → "Daily EM/CCM Trend Review" → **Run workflow** (workflow_dispatch)
2. 완료 후 job summary 확인: `아카이브: 완료 (PDF 적재|없음 · Doc 갱신)`
3. Drive: `trend-review/2026-07/` 폴더에 Doc(+PDF) 생겼는지 확인
4. NotebookLM: 7-2 소스 연결 → 당일 논문 내용 질문 → 정상 인용 응답 확인
5. (선택) 수동 디깅 검증: 대시보드에서 "직접 지정 분석" 펼치기 → PMID 입력 → 토큰 붙여넣기 →
   실행 → 수 분 후 새로고침 → "직접 지정"(주황) 배지 카드가 데일리 카드와 별도로 추가됐는지 확인.

## 참고 — 영상·카드뉴스 샘플 승인(데스크탑 데이와 별개, 이후 진행)
- Phase 2 가동 후 `node scripts/video-sample.mjs` → `output/video/*` 영상 + `output/cards/*` 카드 생성(업로드 없음).
- 모바일에서 확인 → 톤·디자인 튜닝 → 만족 시 Variables `ENABLE_VIDEO=true`로 데일리 편입.

## 문제 해결
- **"이 앱은 확인되지 않았습니다" 차단**: 2-1 테스트 사용자 미등록 — 본인 Gmail 추가 후 재시도.
- **refresh_token이 안 나옴**: https://myaccount.google.com/permissions 에서 `trend-review` 승인 삭제 후 3번 재실행.
- **Actions에서 401/invalid_grant**: Secrets 오타 또는 토큰 회수 — 3번 재실행 → Secrets 갱신.
- **YouTube 업로드 403 (channelNotFound 등)**: 6-a 채널 생성 후 3번을 다시 실행해 채널 컨텍스트로 재승인.
