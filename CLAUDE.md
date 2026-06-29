# Trend Review — 프로젝트 메모 (에이전트용)

## 사용자
- 사용자 호칭: **PeterJ** (항상 이렇게 지칭), **존댓말** 유지.
- 작업은 대부분 **리모트 컨트롤(안드로이드 폰/태블릿)** 로 진행. 데스크탑 사용은 어려움.

## 목표 (North Star)
> 매일 일정 시간에 **PubMed 논문 스크리닝·셀렉을 Opus로** 실행하고,
> **새 디자인(Sky 파스텔) 링크가 포함된 카카오톡 리포트**가 PeterJ에게 도착하게 한다.

## 저장소 구성
- `Trend_Review`(대문자) = 예전 데스크탑(VS Code) 작업 저장소. 과거 라이브 사이트.
- `trend-review`(소문자, **현재 작업 home**) = 리모트 컨트롤 연동용. 모든 신규 작업은 여기서.

## 운영 방침 (단일 기준: REPORT_SPEC.md)
- 검색 6개월(180일) · 스크리닝 최대 300편 · **하루 1편 선정** · **Claude Opus**.
- 셀렉/스크리닝 = 초록 기준. **선정 1편 분석 = 본문 확보 → 실패 시 ClinicalTrials.gov(NCT) 레지스트리 보강**, 출처링크·근거배지 표기, 수치는 명시값만(환각 배제).
- 디자인 = **Sky 파스텔**(`GitHubPublisher` self-contained 테마). 카톡/이메일/웹 표기 통일.

## 작업 습관
- 리모트 작업 **마무리 시 자동 commit + push**, 시작 시 `git pull` 로 데스크탑과 동기화(허브=GitHub).
- 데일리 카카오 리포트는 **Claude 세션(PlayMCP MemoChat)** 으로만 발송 가능 (GitHub Actions 불가).
