# 가이드라인 예고 리스트가 빈다 — 원인 규명과 처방 (2026-08-17)

## 0. 증상
배포된 `guidelines.html` 의 예고 블록이 **`0건` · "예고할 것이 없습니다"**.
PeterJ: *"시작시점인데 엄청 예비 많아야 하는 거 아냐?"*

## 1. 실물 실측 (문서 아니라 파일에서)

`output/selected_guidelines.json` (updatedAt 2026-08-17):

```
queue 5 (전부 needsReview) · published 7 · rejected 3
lastRun.outcome = "observe-only" · publish.attempted = false
manifest.pubmed: pubmed-pt totalFound 2 · pubmed-expanded totalFound 8 · merged 8
manifest.orgSources: 9곳 전부 "unconfigured" (sources: [] )
decisions: queued 1 · needsReview 5 · rejected 2
```

큐 5건의 판정 사유는 **전부 `insufficient-positive-evidence`** 다.

## 2. 왜 비었나 — 인과 사슬

### ① 화면(직접 원인)
`GitHubPublisher._renderUpcomingFromDisk()` 는 예고에 **`status === 'queued'` 만** 올린다
(2026-08-16 에 일부러 넣은 가드 — 화면과 게이트가 다른 걸 보면 안 되므로 옳다).
지금 `queued` 는 **0** 이다. 유일하던 1건(42087034)을 PeterJ 가 🗑 로 뺐다. → 0건.

### ② 판정 — `queued` 가 안 쌓인다 (★ 실버그 2건)

`classifyGuidelineDocument()` 는 양성 증거 4축 중 **2축 이상**을 요구한다:
`format`(문서형식) · `publisher`(승인기관) · `normative`(권고문 표현) · `official`(공식 색인).

- **★ 실버그 F1 — `publicationTypes` 가 항상 빈 배열이다.**
  `src/utils/guidelinePubmed.js:27` 이 esummary 응답에서 `record.pubtypelist` 를 읽는다.
  **NCBI esummary 의 실제 필드명은 `pubtype` 이다.** 같은 저장소의 논문 트랙
  (`DataCollectorAgent.js:229`)과 시장조사(`guideline-census.mjs:138`)는 `pubtype` 을 쓴다.
  가이드라인 수집기 한 곳만 틀렸다.
  실측: 상태 파일의 PubMed 수집분 8건 **전부 `publicationTypes: []`**.
  결과 → `format` 축과 `official` 축이 통째로 죽는다. **PT 쿼리로 찾은 문서조차
  "PT 가 아님"으로 판정된다**(42522393 이 `ptPmids` 에 있는데 `documentType: null`).
  테스트가 초록이던 이유: `test/guidelinePubmed.test.mjs:14` 픽스처가 **틀린 이름을 그대로
  박아뒀다.** 이 저장소가 아홉 번 데인 그 모양 — 모듈은 옳은데 실물에서 안 불린다.

- **★ 실버그 F2 — 초록을 한 번도 안 받는다.**
  `normative` 축은 `abstract/fullText/content` 에서 권고 표현을 찾는데, 수집기는
  esummary 만 때린다(초록을 안 준다). 실측: 15건 **전부 `abstract` 없음**.
  → `normative` 축도 항상 false. `meshTerms`·`keywords` 도 비어 `topicScore` 가
  제목으로만 매겨진다.

정리하면 4축 중 **3축이 구조적으로 항상 false** 이고, 남은 `publisher`(승인기관 9곳
제목/저널/소속 매칭) 하나로는 2축을 못 채운다. → **기관명이 제목에 박힌 대형 지침이
아니면 전부 `needsReview`.** 발행 이력 7건이 전부 SSC·AHA·ESICM 류인 게 그 증거다.

### ③ 소진 통로 — needsReview 는 죽은 상태다
- 예고 리스트는 `queued` 만 그린다 → needsReview 5건은 **화면에 안 보인다.**
- ▶(promote) 는 `promoteInQueue()` 로 **배열 순서만 바꾼다. status 를 안 건드린다.**
- 발행 픽은 `status === 'queued'` 만 본다.
→ 한 번 needsReview 로 떨어지면 **PeterJ 가 손으로 올릴 방법이 없다.** 영구 적체.

### ④ 백로그 — 캐치업이 한 번도 안 돌았다
`.github/workflows/guideline-backfill.yml` 은 `scripts/guideline-backfill.mjs` 를
**`--apply` 없이** 부른다. 입력에 apply 스위치도 없다. → 돌려도 리포트만 나오고
**상태 파일은 안 채워진다.** 그리고 실제로 한 번도 안 돌았다(상태에 그 경로 항목 0건).

### ⑤ 공급 — 그물이 30일 · EM/CCM MeSH 8개
`PT_TERM`/`EXPANDED_TERM` 은 `AND ("emergency medicine"[MeSH] OR "critical care"[MeSH]
OR ... 8개)` 로 묶여 있다. 30일 창에서 PT 2 · 확장 8건.
데일리 소비는 1편/일 = **30편/월** 필요한데 공급이 **8편/월** 이다. 구조적 결손.
`config/guideline-topics.json`(주제축 전용 설정)은 **아무도 안 읽는 죽은 설정**이다 —
`grep` 결과 참조처가 자기 테스트뿐. 시장조사(census)는 `interests.json` 으로 별도 축을
만들어 **연 2,888편**을 셌는데, 프로덕션 수집기에는 그 축이 아예 안 붙어 있다.

## 3. 이 PR 이 하는 것

| 코드 | 무엇 | 왜 |
|---|---|---|
| F1 | esummary `pubtype` 읽기 (+`pubtypelist` 폴백 유지) · 픽스처 정정 · 실필드명 계약 테스트 | 죽은 2축을 살린다 |
| F2 | efetch 로 초록·PT·MeSH·키워드 보강 (`enrichCandidates`) | `normative` 축과 주제점수를 살린다 |
| F3 | 분류기가 `discoveredBy: pubmed-pt` 를 `official` 근거로 인정 | esummary 가 PT 를 늦게 다는 날의 회귀 차단 |
| F4 | ▶(promote) 가 needsReview → queued 로 **승격**한다 + 예고에 검토대기 행을 배지로 노출 | 적체 소진 통로 |
| F5 | backfill 워크플로에 `apply` 입력 추가 | 백로그를 실제로 채운다 |

**이 PR 이 하지 않는 것**: ⑤ 그물 확대(주제축 도입). 회수량을 수십 배로 바꾸는 변경이라
자동발행이 켜진 채로 같이 넣지 않는다 — 이 저장소의 배포 원칙(넓힌 그물과 자동발행을
동시에 켜지 마라)이 정확히 이 경우를 막으려는 것이다. 별건으로 올린다.

## 4. 검증
- `npm run test:unit` 초록 (기준선 672).
- 각 수정마다 **변이를 주입해 적색이 되는 것**까지 확인한다.
- 실물 PubMed 는 이 컨테이너에서 프록시에 막힌다(CONNECT 403) → Actions 로 디스패치해 확인.
