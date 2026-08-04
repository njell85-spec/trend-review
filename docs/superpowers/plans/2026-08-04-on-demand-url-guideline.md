# On-demand — URL 지정 가이드라인 분석 (PubMed 미등재 대응)

날짜: 2026-08-04 · 요청: PeterJ("2026 IDSA gram-negative 가이드라인을 TR에 추가로 돌려줘")

## 1. 문제

`scripts/on-demand.mjs`의 `resolvePmid()`는 **PMID 숫자 또는 DOI(→PubMed esearch)** 만 받는다.
그런데 이번 대상인 **IDSA 2026 AMR 그람음성 가이던스(v4.0, current as of 2026-03-01)** 는
학회 홈페이지에 living document로만 나와 있고 **PubMed 레코드가 없다**.

실측 근거(2026-08-04):
- PubMed `gram-negative[Title] AND guidance[Title]` 전수 6건, `Tamma PD[Author] AND (guidance|guideline*)[Title]`
  전수 18건 — 최신 등재본은 **2024판 PMID 39108079 / DOI 10.1093/cid/ciae403**. 2026판 없음.
- 원문: `https://www.idsociety.org/practice-guideline/amr-guidance/`,
  PDF `https://www.idsociety.org/globalassets/idsa/practice-guidelines/amr-guidance/4.0/amr-guidance-4.0.pdf`
  (세션 환경에서는 프록시 정책상 접근 불가 — Actions 러너는 열려 있음).

가이드라인은 학회 홈페이지 선공개 → 저널 등재가 몇 달 뒤인 경우가 흔하므로, 이번 1회용이 아니라
**경로 자체를 추가**한다.

## 2. 설계 (기존 부품 재사용 · 데일리 코어 무접촉)

on-demand 입력이 `http(s)://…` 이면 **웹 출처 가이드라인 모드**:

1. 러너에서 URL을 받아 HTML이면 `htmlToText`로 본문 텍스트 확보(PDF·차단 시 텍스트 없이 진행).
2. PubMed 경로(DataCollector·FullTextAgent)를 타지 않고 **합성 guideline 객체**를 만들어
   기존 `GuidelineAnalyzerAgent.analyze()`에 그대로 넘긴다.
   - 이 에이전트는 이미 `webSearch: true`로 LLM 웹검색 보강을 하므로, 본문을 못 받아도
     Opus가 발행기관 페이지를 직접 읽어 핵심 권고·변경점을 채운다(프롬프트에 Source URL 명시).
3. 발행·카톡·섹션 키·"직접 지정" 배지는 **기존 수동 경로 그대로**.

임상 내용은 전부 파이프라인 LLM이 생성한다(세션은 식별자·URL만 다룸 — CLAUDE.md/HANDOFF §11).

## 3. 변경 파일

| 파일 | 변경 |
|---|---|
| `src/utils/externalGuideline.js` (신규) | `sourceIdOf(url)`, `fetchSourceText(url)`, `buildWebGuideline(...)` |
| `src/agents/GuidelineAnalyzerAgent.js` | 프롬프트에 Source URL + 캐시키 `pmid \|\| sourceUrl` + `_toCard`가 `sourceUrl`을 출처·paper에 전달 |
| `src/utils/GitHubPublisher.js` | PMID 없는 가이드 카드: 죽은 PubMed 링크(`#`) 대신 **원문 링크**, 표 행 링크도 동일, 중복 제거를 sourceUrl로도 |
| `scripts/on-demand.mjs` | URL 모드 분기(가이드라인 한정) + 상태파일 dedup에 sourceUrl 반영 |
| `.github/workflows/on-demand.yml` | 선택 입력 `title`(문서 제목) 추가 |
| `REPORT_SPEC.md` | §1-B에 URL 지정 경로 1줄 + §5 이력 |
| `test/externalGuideline.test.mjs` (신규) | URL 파싱·합성 객체·PMID 없는 카드 렌더 회귀 |

## 4. 불변식 (깨지면 실패)

- 데일리 자동 경로(PMID 기반)는 **바이트 동일** — URL 모드는 새 분기 안에서만 동작.
- PMID 있는 가이드 카드 렌더는 기존과 동일(회귀 테스트로 고정).
- 실패는 소프트: URL 접근 실패해도 LLM 웹검색으로 계속, 분석 실패면 대시보드 미변경.

## 5. 절차

계획(이 문서) → 구현 → `npm run spec-lint` + `npm run test:unit` → **/preview로 카드 렌더 승인** →
브랜치 push → PeterJ 승인 후 병합 → Actions에서 on-demand dispatch(대상: IDSA 2026 v4.0).
