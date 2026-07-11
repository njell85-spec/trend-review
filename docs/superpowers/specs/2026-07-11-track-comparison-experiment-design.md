# 논문 선정 트랙 비교 실험 (2주 무인 A/B) — 설계

> 최종 갱신: 2026-07-11 (KST) · 상태: 설계 확정 대기(PeterJ 검토 게이트)
> 브레인스토밍 대화 근거로 작성. 구현 계획은 별도(writing-plans).

## 1. 목적

PeterJ의 문제의식: "논문 선정 파이프라인이 복잡한데, LLM이 알아서 한 번에 고르는 방식과
품질 차이가 실제로 있나?" 이를 **감이 아니라 2주 실측**으로 판단하기 위해, 세 트랙을
같은 형식으로 매일 나란히 쌓아 비교한다.

- **Arm 1** — 현재 프로덕션 파이프라인(결정적 메타 스코어러 → Opus rerank 상위 K → 1편 → PICO). **변경 없음.**
- **Arm 2** — Opus가 웹서치 + PeterJ 관심 키워드로 *"최근 6개월 EM/CCM 저명저널 임상효용 최고 1편"*을
  **스스로 선정**하고, **Arm 1과 동일한 PICO 포맷으로 분석**. (300편 스크리닝 없음 = ChatGPT 앱 방식을 Opus로 재현.)
- **Arm 3** — PeterJ가 ChatGPT 앱 automation으로 **개인적으로 별도 운영**. 2주 뒤 선정 리스트를
  복사·붙여넣기로 제공 → 비교 페이지에 병합. (본 자동화 범위 밖. 슬롯만 비워둠.)

**성공 기준**: 2주 후 Arm 1·2(·3) 픽·분석을 한 화면에서 대조해, PeterJ가 "어느 방식이 임상적으로
더 나은 논문을 고르나"를 눈으로 판정할 수 있다. 정량 지표(겹침률 등)는 부산물.

## 2. 확정 결정 (브레인스토밍, 되묻지 말 것)

1. **Arm 1은 재실행하지 않는다.** 실 프로덕션 데일리가 이미 매일 골라 발행하므로,
   그날의 실제 픽(`output/analysis_archive.json`)을 **읽어와** 비교 대상으로 삼는다. (토큰 0, 429 0.)
2. **Arm 2 분석은 Arm 1의 기존 PICO 포맷 그대로.** 선정만 스스로, 분석은 동일 코드·동일 형식.
3. **각 트랙은 자기 과거 픽만 제외.** arm1·2·3 간 겹침은 무방(오히려 "수렴" 신호).
4. **Claude만 2-arm 무인화.** OpenAI(유료) 미사용. Arm 3는 PeterJ 수동.
5. **데일리 코어 무접촉(제1 불변식).** 실험은 별도 워크플로우로 격리, 프로덕션 파이프라인
   코드·`index.html`·상태 파일을 바꾸지 않는다.
6. **게시**: Arm 2/비교는 **기존 GitHub Pages의 별도 URL**
   `https://njell85-spec.github.io/trend-review/experiments/compare.html`.
   compare 워크플로우가 `experiments/` 폴더에만 커밋(main). 데일리 `index.html`과 파일이 안 겹친다.

## 3. 아키텍처

### 3.1 구성요소 (전부 프로덕션과 격리)

| 파일 | 역할 |
|---|---|
| `.github/workflows/compare-tracks.yml` | 데일리 커밋 이후(예: 08:00 KST) 도는 별도 크론 + 수동 실행. 게이트·종료일 검사·안전 푸시. |
| `scripts/compare-tracks.mjs` | 진입점. 하루치 비교 실행을 오케스트레이션. |
| `src/experiments/trackCompare.js` | 실험 로직(격리 모듈). 아래 재사용 컴포넌트를 조립. |
| `src/experiments/compareRender.js` | `track-comparison.json` → `compare.html`(폰용 자립형 페이지) 렌더. |
| `experiments/track-comparison.json` | 일자별 비교 레코드 누적(SSOT). |
| `experiments/arm2-history.json` | Arm 2 자기 제외 PMID 누적. |
| `experiments/compare.html` | 렌더된 비교 페이지(Pages 서빙). |

**재사용(수정 없이 import)**: `DataCollectorAgent`(PMID 조회·본문 보강), `FilterAnalyzerAgent`
(`_analyzeSinglePaper` PICO 분석), `config/interests.json`(관심 키워드), `LLMClient`(Opus+웹서치),
`RetryHelper`/`Logger`.

### 3.2 하루치 실행 흐름 (`trackCompare.runOnce`)

```
0. 게이트: ENABLE_TRACK_COMPARE=true & 오늘(KST) <= TRACK_COMPARE_END 아니면 no-op 종료.
1. Arm1 픽 로드: main의 analysis_archive.json에서 date == 오늘(KST) 엔트리. 없으면 arm1=null.
2. Arm2 선정(A): Opus 1콜 + 웹서치.
     프롬프트 = 6개월 창(오늘-183일 이후) + 관심 키워드(interests.json) + 제외목록(arm2-history).
     반환: { pmid, doi, title, journal, pubDate, whyChosen }.
3. Arm2 검증·보강(B): 반환 PMID를 `DataCollectorAgent.fetchArticles([pmid])`로 PubMed 재조회
     (on-demand.mjs와 동일 경로 — efetch로 canonical 메타·초록 확보).
     - 빈 결과(존재하지 않음) / 발표일이 6개월 밖 → 소프트 실패. 1회 재시도(실패 사유를 프롬프트에 피드백).
       재시도도 실패면 arm2=null(그날 "픽 없음").
     - 성공 시 canonical 메타 + 초록/본문 확보 → Arm 1과 동일한 paper 객체 형태.
4. Arm2 분석(C): 검증된 paper를 FilterAnalyzerAgent._analyzeSinglePaper로 PICO 분석(동일 포맷).
5. 기록: arm2 PMID를 arm2-history에 append. { date, arm1, arm2, converged: arm1?.pmid===arm2?.pmid }
     레코드를 track-comparison.json에 upsert(같은 날 재실행 시 덮어씀).
6. 렌더: compareRender로 compare.html 생성.
7. 커밋·푸시: experiments/ 자동 산출 3파일만(track-comparison.json·arm2-history.json·compare.html).
     git pull --rebase 후 push, 실패 시 재시도(경합 회피). (arm3-list.json은 §6 수동·후속 — 자동 커밋 대상 아님.)
8. Job summary: 오늘 Arm1·Arm2 픽 요약(제목·저널·PMID·수렴여부) 출력.
```

### 3.3 Arm 2 선정 프롬프트 (요지)

시스템: 기존 PICO 경로와 동일한 "정당한 학술 문헌 리뷰" 컨텍스트(안전필터 회피 문구 재사용).
유저 프롬프트 핵심:
- "You are an EM/CCM expert. Using web search, find exactly ONE peer-reviewed primary
  research paper published on or after {sixMonthsAgo} in a **notable EM/CCM journal**, with the
  **highest clinical bedside utility** for an acute/critical-care physician."
- 관심 영역 힌트: interests.json의 topicGroups 라벨+대표 용어를 요약해 제공(참고용, 강제 아님).
- 제외: "Do NOT choose any of these already-selected PMIDs: {arm2History}."
- 반환은 툴(`submit_track_pick`)로 구조화: pmid(필수), doi, title, journal, pubDate, whyChosen.
- 가드: "The PMID must be a real PubMed identifier you verified via search; do not invent it."

## 4. 데이터 계약

### 4.1 track-comparison.json
```jsonc
{
  "startDate": "2026-07-12",
  "endDate":   "2026-07-25",
  "records": [
    {
      "date": "2026-07-12",
      "arm1": { /* analysis_archive 오늘 엔트리 전체(전체 리포트 필드: clinicalQuestion·pico·
                   pico_ko·secondaryOutcomes·statGlossary·practiceChange·keyFindings·
                   clinicalTakeaway·limitations·evidenceLevel·references·badge 등) */ },
      "arm2": { /* Arm1과 동일한 전체 분석 객체(_analyzeSinglePaper 결과). 실패 시 null */ },
      "arm3": null,                                          // 2주 뒤 PeterJ 데이터로 채움
      "converged": false
    }
  ]
}
```
- arm1은 archive 엔트리를 그대로 발췌(추가 분석 없음).
- arm2는 동일 필드를 PICO 분석 결과에서 매핑.
- arm3 슬롯은 항상 존재(초기 null). 병합 시 각 날짜 대응 or 별도 "arm3 목록" 섹션으로 처리(§6).

### 4.2 arm2-history.json
```jsonc
{ "pmids": ["...", "..."] }   // Arm 2가 과거에 고른 PMID. 선정 제외에만 사용.
```

## 5. 출력면 (compare.html)

> **레이아웃 확정(PeterJ 2026-07-11)**: 더미 미리보기(폰 390 / 태블릿 800) 그대로 승인.
> 실험용이므로 비교 페이지 디자인은 현행 유지, 세부 디자인 재작업 없음.
> **분석 자체는 "원래 하던 리포트처럼"** — 즉 Arm 2도 Arm 1과 **동일한 전체 PICO 분석**
> (`FilterAnalyzerAgent._analyzeSinglePaper`, 이중언어·통계용어 해설·근거등급 등 전 필드)을 생성한다.
> compare 페이지는 그 전체 분석을 근거로 **칼럼 요약**(제목·저널·PMID·P/I/O·핵심소견·근거등급)을
> 나란히 보여주고, **전체 리포트 필드는 `track-comparison.json`에 그대로 보존**(추후 상세보기/링크 확장 여지).


- **프로덕션 대시보드와 완전 별개**의 자립형 HTML(외부 의존 없음, 인라인 CSS).
  프로덕션 `index.html` 포맷을 건드리지 않으므로 /preview 프로덕션 게이트 대상 아님(단, 실물
  스크린샷 1회 PeterJ 확인은 권장 — 구현 시).
- 레이아웃: 일자별 카드. 각 카드 안에 Arm 1 / Arm 2 (/ Arm 3) 칼럼. 모바일(≤430px) 세로 스택.
- 칼럼당 표시: 제목(ko/en), 저널, PMID/DOI 링크, 핵심 PICO(population·intervention·outcome),
  keyFindings 상위, evidenceLevel, 근거 배지. PMID 겹치면 "🔗 수렴" 뱃지.
- 상단: 실험 기간·경과일·요약(총 일수, 수렴 일수, Arm 2 실패 일수).
- 다크/라이트 모두 무난한 중립 스타일.

## 6. Arm 3 병합 (2주 후, 수동)

- PeterJ가 ChatGPT 앱 automation 결과(논문 리스트: 저널·제목·발표월·PMID/DOI)를 복붙 제공.
- 형태가 날짜 1:1 대응이 아닐 수 있으므로(그가 며칠에 한 번, 여러 편), **날짜 매칭을 강제하지 않는다.**
  compare.html에 **"Arm 3 (ChatGPT) — 2주 누적 목록"** 별도 섹션을 두고 그의 리스트를 표로 렌더.
  겹치는 PMID는 Arm 1·2 카드에도 "Arm3도 선정" 뱃지로 교차표시.
- 구현: `experiments/arm3-list.json`에 PeterJ 데이터 저장 → compareRender가 있으면 섹션 추가.
  코드 신규 없음, 렌더 분기만.

## 7. 에러 처리 · 불변식

- **전 구간 소프트 실패**: Arm 2 선정/검증/분석 중 어느 단계 실패도 그날 `arm2=null`로 기록하고
  계속. 크래시·프로덕션 접촉 없음.
- **429/레이트리밋**: 기존 RetryHelper로 재시도. 데일리와 시간 분리(1h+)로 세션 한도 충돌 완화.
  그래도 실패면 그날 스킵.
- **데일리 코어 무영향(제1 불변식)**: 실험은 `analysis_archive.json`을 **읽기만**. 커밋 대상은
  `experiments/` 3파일뿐. 데일리 워크플로우·`index.html`·`output/` 상태 파일 무변경.
- **커밋 경합**: compare-tracks는 데일리 이후 실행. push 전 `git pull --rebase origin main`,
  실패 시 지수백오프 재시도(데일리의 main 커밋과 안전 병합).
- **비용**: Arm 2 = Opus 구독 CLI(웹서치 포함) → 무료. 하루 1콜(선정) + 1콜(PICO) 규모.

## 8. 기간 · 중단

- `vars.ENABLE_TRACK_COMPARE` (기본 미설정=off). true여야 실행.
- `vars.TRACK_COMPARE_END` (KST 종료일, 예: 2026-07-25). 오늘 > 종료일이면 워크플로우 no-op.
- 시작: PeterJ가 두 Variable 설정 + 첫 수동 dispatch로 스모크. 이후 크론 자동.
- 중단: 종료일 자동 도달 or 워크플로우 disable. 실험 종료 후 `experiments/` 산출물은 보존
  (판정 근거), 워크플로우는 남겨두되 off.

## 9. 테스트 (오프라인 · 라이브 LLM 없음)

- `arm2 제외 로직`: history의 PMID가 프롬프트 제외목록·후처리에서 배제되는지.
- `PMID 검증·6개월 창`: 무효 PMID·창밖 발표일을 거부하고 소프트 실패로 떨어지는지(목 PubMed).
- `비교 레코드 조립`: arm1(archive 발췌)·arm2(분석 매핑)·converged 계산·upsert(재실행 덮어쓰기).
- `compareRender 스모크`: 샘플 JSON → HTML에 두 칼럼·수렴 뱃지·모바일 스택 클래스 존재.
- `종료일 게이트`: 종료일 이후 no-op.
- 기존 `npm run spec-lint` + 전체 테스트 스위트 그린 유지. Opus·웹·PubMed는 전부 목.

## 10. 범위 밖 (YAGNI)

- OpenAI/Arm 3 자동화(수동 유지).
- LLM 심판·정량 스코어링(사람 눈 판정이 1차 목표. 필요 시 후속).
- 프로덕션 대시보드에서 compare 페이지로의 링크(index.html 미접촉 위해 생략. 북마크로 접근).
- Arm 2의 full-text 아카이브·NotebookLM 연동(실험은 비교만).
