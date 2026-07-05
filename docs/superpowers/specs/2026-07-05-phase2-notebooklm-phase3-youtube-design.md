# Phase 2 (NotebookLM) · Phase 3 (YouTube) 확장 설계 스펙

> 상태: **PeterJ 승인 대기** · 작성 2026-07-05 (Fable 세션)
> 마스터 플랜(Artifact) v4의 확정본. 구현은 이 문서와 후속 실행 계획을 따른다.
> 이 스펙이 확정되면 운영 규칙은 REPORT_SPEC.md 4-E/4-F 조항으로 요약 편입한다.

## 0. 목표와 대원칙

**목표**: 매일 오전, 사람 손 없이 —
(Phase 2) 선정 논문의 원문·분석·근거가 NotebookLM에서 질문 가능한 상태가 되고,
(Phase 3) 논문 해설 영상(중간폼·숏폼 × 한국어·영어 = 4편)이 전용 YouTube 채널에 비공개로 올라와 있을 것.

대원칙:
1. **Phase 1(코어) 무수정** — 확장은 코어 완료 *뒤에* 붙는 후처리.
2. **소프트 실패 격리** — Phase 2/3 실패는 코어·서로의 성공에 영향 없음(카카오 발송과 동일 패턴).
3. **콘텐츠 원천은 검증된 리포트** — 환각 배제 정책(명시 수치만)을 통과한 리포트 JSON만 발화·표기.
4. **처음부터 공개 가능 기준** — 논문 원문 그림·표 이미지 미사용(라이선스 확인된 발췌 제외), 전 슬라이드 자체 제작 + 출처 표기.

## 1. 확정 결정 사항 (2026-07-05, PeterJ)

| 항목 | 결정 |
|---|---|
| NotebookLM 연동 구조 | **하이브리드**: 리빙 Google Doc(자동층) + 원문 PDF(보강층, 주 1회 폰에서 일괄 소스 추가) |
| 페이월 대체 자료 | 남의 PPT/PDF 수집 대신 **자체 근거 도시에**(4-B 웹보강 산출을 우리 문서로 구조화) |
| 영상 구성 | 중간폼(3~5분, 1920×1080) + 숏폼(**≤60초**, 1080×1920) |
| 언어 | **한국어판(한국어 자막, 의학용어는 영어 표기) + 영어판(영어 자막)** → 일 4편 |
| 채널 | **전용 새 채널**(브랜드 계정) · 비공개 업로드로 시작(API 심사 전 강제) |
| ChartAgent | **도입 — 영상·Doc 우선**. Phase 1 대시보드 적용은 추후 /preview 시안 승인 후 별도 결정 |
| 1회성 설정 | **데스크탑 데이**에 일괄(GCP·OAuth·TTS 키·채널·NotebookLM 세팅) |

## 2. 공통 기반 — Google 인증

- **기존 자산 재사용**: `NotificationAgent`에 보존된 OAuth2 골격(`drive.file` 스코프, 브라우저 인증 → `output/google_token.json`)을 확장한다.
- 스코프: `https://www.googleapis.com/auth/drive.file` + `https://www.googleapis.com/auth/youtube.upload` (2개 고정, 최소 권한).
- **Actions(무인) 경로**: `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REFRESH_TOKEN` Secrets에서 토큰 구성 — 토큰 파일이 없으면 env로 폴백하는 공용 헬퍼 `src/utils/googleAuth.js`로 분리, NotificationAgent·신규 에이전트가 공유.
- 갱신 실패 시 카카오와 동일: 경고 로그 + job summary 노출 → Secret 재발급 안내. 토큰·시크릿은 로그에 절대 노출하지 않는다.
- TTS는 같은 GCP 프로젝트의 API 키(`GOOGLE_TTS_API_KEY`) 사용 — OAuth와 분리해 단순화.

### 데스크탑 데이 체크리스트 (1회성, 예상 1~2시간)

| # | 작업 | 산출물 |
|---|---|---|
| 1 | GCP 프로젝트 생성 + Drive·YouTube Data·Cloud TTS API 활성화 | 프로젝트 |
| 2 | OAuth 클라이언트(데스크탑 앱) + 동의 화면(테스트 사용자 본인 추가) | client_id/secret |
| 3 | 발급 스크립트(`scripts/google-auth-setup.mjs`) 실행 → 브라우저 승인 | refresh token |
| 4 | Cloud TTS API 키 발급 | GOOGLE_TTS_API_KEY |
| 5 | GitHub Secrets 4종 등록 | Secrets |
| 6 | 브랜드 계정 + 전용 YouTube 채널 생성 | 채널 |
| 7 | NotebookLM 노트북 생성 + 당월 리빙 Doc 소스 연결(+쌓인 PDF 일괄 추가) | 노트북 |
| 8 | Actions 수동 실행(workflow_dispatch)으로 Drive 업로드·토큰 갱신 검증 | 성공 로그 |

## 3. Phase 2 — NotebookLM 연동 (ArchiveAgent)

### 3.1 매일 확보 자료 3티어

| 티어 | 자료 | 확보율 | 적재 위치 |
|---|---|---|---|
| T0 | 리포트 — 서지 + PICO 분석 전문 + **확보한 본문 전문 텍스트** + 근거 출처 | 매일 100% | 리빙 Doc |
| T1 | 논문 원문 PDF (PMC/Unpaywall OA) | 40~60% 추정 | Drive `trend-review/YYYY-MM/` |
| T2 | 근거 도시에 — 페이월 시 웹보강(4-B) 근거·수치를 자체 문서로 구조화 | 페이월 시 | 리빙 Doc 내 섹션 |

- 근거 규칙은 4-B와 동일(권위 소스 한정·출처 명시·수치는 명시된 값만). **타인 저작물 파일 수집은 하지 않는다.**
- T0에 본문 전문을 포함하므로 "2차 가공으로 인한 텍스트 근거 손실" 없음. 그림·표 이해는 T1(PDF 소스)이 담당.

### 3.2 리빙 Google Doc (자동층)

- **월별 1개** (`Trend Review — YYYY-MM`). 파이프라인이 매일 그 달 전체를 HTML로 재생성 →
  Drive API `files.update`(HTML → Google Doc 변환)로 통째 갱신. Docs API 불필요, `drive.file` 스코프로 충분.
- 문서 구조: 날짜별 섹션 = 서지 → 근거 배지·출처 → PICO 분석 → 본문 전문(확보 시) → 근거 도시에(페이월 시) → 원문 PDF 링크.
- NotebookLM Drive 자동 동기화(2026-05-26~, Docs·Slides·Sheets 한정)가 몇 분 내 반영.
- 수동 작업: **월 1회** 새 달 Doc 소스 추가(30초) + **주 1회** 원문 PDF 일괄 소스 추가(약 5분, 기본 주기 — 조정 가능).
- 한도 대응: 소스당 50만 단어 → 월별 분권. 노트북당 50소스 → 월별 노트북(Doc 1 + PDF ~31)로 한도 내.

### 3.3 ArchiveAgent 동작 (코어 완료 후, +2~3분)

```
A1 PDF 확보   : FullTextAgent가 확보한 PMC/Unpaywall PDF URL 다운로드 (페이월이면 스킵)
A2 Drive 적재 : YYYY-MM-DD_PMID_제목.pdf → trend-review/YYYY-MM/
A3 Doc 갱신   : 월별 리빙 Doc 재생성·업데이트 (아카이브 JSON 기반)
A4 상태 기록  : output/drive_log.json (업로드 fileId·해시) → 재실행 시 중복 방지(resume 안전)
```

- 전체 try/catch 소프트 실패. 실패는 Actions job summary에 노출.
- 신규 파일: `src/agents/ArchiveAgent.js`, `src/utils/googleAuth.js`. 호출: `github-actions-daily.mjs`(카카오 발송 뒤).

### 3.4 완료 기준

실제 데일리 실행(또는 workflow_dispatch) 후 — Drive에 PDF·Doc 생성 확인 + NotebookLM에서 당일 논문 내용 질문·정상 응답 확인.

## 4. 공용 모듈 — ChartAgent (결과 시각화)

- **재구성(기본)**: 리포트 JSON의 검증된 수치(효과크기·CI·군간 비교)를 **코드가 렌더**(LLM이 그림을 그리지 않음 → 수치 왜곡 원천 차단). 산출: 핵심 결과 차트 1~2종(SVG→PNG). 스타일은 대시보드 Sky 파스텔 팔레트.
- **발췌(조건부)**: PMC OA 그림 중 **CC BY 계열 라이선스 확인 + 출처 표기** 시에만. 페이월 그림은 사용하지 않는다. Kaplan-Meier 등 원자료 필요 곡선은 발췌만 가능(재구성 금지).
- 수치가 차트화에 불충분하면 **차트를 생략**(억지로 만들지 않음 — 환각 배제 연장).
- 사용처: Phase 3 영상 슬라이드(핵심 결과), Phase 2 리빙 Doc. Phase 1 대시보드는 추후 /preview 승인 후.
- 신규 파일: `src/utils/ChartRenderer.js` (순수 함수: 수치 JSON → SVG).

## 5. Phase 3 — YouTube 영상 (VideoAgent)

### 5.1 산출물 (일 4편)

| | 중간폼 | 숏폼 |
|---|---|---|
| 규격 | 1920×1080 · 3~5분 | 1080×1920 · ≤60초 |
| 구성 | 슬라이드 6~8장: 배경→PICO→핵심 결과(차트)→한계→임상 적용 | 3장: 훅→핵심 결과(차트)→임상 한 줄 |
| 언어 | 한국어판(한국어 자막·의학용어 영어 표기) + 영어판(영어 자막) | 동일 |

### 5.2 제작 파이프라인 (코어·Phase 2 후, +8~15분)

```
B1 스크립트 생성 : 리포트 JSON → LLM 1회 호출로 4종 스크립트+슬라이드 JSON 동시 생성
                  (기존 LLMClient 경로 재사용 · 수치는 리포트 값 그대로, 새 수치 생성 금지 규칙 명시)
B2 슬라이드 렌더 : HTML 템플릿(Sky 파스텔) → chromium 스크린샷 (가로/세로 2종)
B3 TTS          : Google Cloud TTS — ko-KR·en-US Neural2 계열. 문장별 합성으로 타이밍 확보
B4 자막(SRT)    : TTS 문장별 길이에서 타임스탬프 계산 → ko/en SRT 생성
B5 ffmpeg 합성  : 슬라이드 타이밍을 내레이션에 동기화 (러너 기본 ffmpeg)
B6 업로드       : videos.insert (privacyStatus: private) + captions.insert (SRT)
                  제목·설명(PubMed·DOI·대시보드 링크·근거 배지)·태그 자동
B7 상태 기록    : output/video_log.json (videoId·해시) → 중복 업로드 방지
```

- 쿼터: 업로드 4건(6,400) + 자막 4건(1,600) = 8,000/10,000 이내. 여유 확보를 위해 자막 실패는 소프트 스킵.
- TTS 사용량 추정 월 ~45만 자 < 무료 티어 100만 자.
- 신규 파일: `src/agents/VideoAgent.js`, `src/utils/tts.js`, `src/utils/videoRender.js`(슬라이드 템플릿·ffmpeg), `scripts/video-sample.mjs`(샘플 생성용).
- 롤아웃: **한국어판 샘플 승인 → 영어판 추가** 순서. 첫 데일리 편입 전 샘플 승인 게이트(모바일 시청 가능하게 전달) 필수.

### 5.3 완료 기준

데일리 실행에서 4편이 전용 채널에 비공개 업로드 + 자막 표시 + 재실행 시 중복 없음.

## 6. 파이프라인 편입·타임라인

```
06:30 KST  코어(현행 그대로) → 대시보드 발행 → 카카오 발송
  +2~3분   Phase 2: ArchiveAgent (소프트 실패)
  +8~15분  Phase 3: VideoAgent (소프트 실패)
```
- LLM 세션 한도 재시도(최대 3회×60분)가 겹쳐도 정오 전 완료 (timeout 240분 내).
- 편입 지점: `github-actions-daily.mjs`의 카카오 발송 이후, 각 단계 독립 try/catch.
- Actions에 chromium(슬라이드 렌더용) 필요 — `npx playwright install chromium --with-deps` + 캐시.

## 7. Secrets 인벤토리 (추가분)

| Secret | 용도 | 도입 |
|---|---|---|
| `GOOGLE_CLIENT_ID` `GOOGLE_CLIENT_SECRET` `GOOGLE_REFRESH_TOKEN` | Drive + YouTube OAuth | 데스크탑 데이 |
| `GOOGLE_TTS_API_KEY` | Cloud TTS | 데스크탑 데이 |
| (기존) `GOOGLE_DRIVE_FOLDER_ID` env | 적재 루트 폴더 | 데스크탑 데이 |

## 8. 품질 게이트·검증

- REPORT_SPEC에 **4-E(아카이브·NotebookLM)**, **4-F(영상)** 조항 추가 + `spec-lint` 확장(예: 영상 스크립트 프롬프트에 "새 수치 생성 금지" 규칙 존재 확인, drive/video 상태 파일 gitignore 회귀 방지).
- 커밋 전 셀프 리뷰 체크리스트(전역 지침) 준수 — 특히 ① 시크릿 로그 노출, ② LLM 출력의 HTML/셸 이스케이프(슬라이드 템플릿!), ④ 재실행·부분 실패 안전, ⑤ KST 날짜.
- 대시보드·카톡 포맷은 이번 확장에서 변경하지 않는다(변경 시 /preview 필수).
- 각 마일스톤 완료 기준은 §3.4·§5.3 — 증거(명령·출력) 없이 완료 주장 금지.

## 9. 리스크

| 리스크 | 등급 | 대응 |
|---|---|---|
| Google refresh token 만료·회수 | 중 | 경고 로그 + job summary → Secret 재발급 (카카오 동일 패턴) |
| OA PDF 확보율 40~60% (추정) | 하 | T0 리포트 Doc + T2 도시에가 매일 보장 |
| NotebookLM 정책 변경 | 하 | Drive 아카이브는 독립 자산 — 손실 없음 |
| 1차 영상 품질 = 슬라이드쇼 수준 | 하 | 샘플 승인 게이트에서 튜닝 |
| 리빙 Doc 50만 단어 한도 | 하 | 월별 분권 |
| Actions 실행 시간 증가(+10~18분) | 하 | chromium 캐시 · 일 1회라 실질 영향 없음 |

## 10. 구현 마일스톤 (실행 계획에서 상세화)

| # | 내용 | 시점 |
|---|---|---|
| M1 | googleAuth 헬퍼 + 발급 스크립트 + 데스크탑 데이 가이드 | Fable 선작업 |
| M2 | ArchiveAgent (PDF·리빙 Doc·drive_log) | Fable 선작업 |
| M3 | ChartRenderer + 스크립트 프롬프트 + 슬라이드 템플릿 + TTS/ffmpeg/SRT/업로더 골격 | Fable 선작업 |
| M4 | 데스크탑 데이: 체크리스트 8항목 + Phase 2 가동·검증 | 데스크탑 데이 |
| M5 | 영상 샘플(KO) 생성 → 승인 → EN 추가 → 데일리 편입 | 데스크탑 데이~+1일 |
| M6 | REPORT_SPEC 4-E/4-F + spec-lint 확장 + 안정화 관찰(7일 무개입) | 편입 후 |
