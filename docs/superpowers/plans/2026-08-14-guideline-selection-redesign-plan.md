# 가이드라인 선정 개편 설계 계획서

## 1. 목표와 불변 조건

이 개편은 논문 선정과 독립된 가이드라인 전용 수집·판정·대기열·개정판 관리 경로를 만든다.

- [확인] 자동 인정 범위는 PubMed PT뿐 아니라 제목·문서 유형의 `consensus`, `statement`, `focused update`, `recommendations`까지 포함한다.
- [확인] PubMed와 별도로 승인 학회 사이트를 수집한다.
- [확인] 신판은 새 카드로 발행하고 구판은 삭제하지 않으며 `superseded` 배지를 붙인다.
- [확인] 매일 발행을 시도하되, 발행 가능한 큐가 비면 건너뛴다.
- [확인] PeterJ가 수동 입력한 URL은 최종 승인으로 간주한다. 도메인 검증이나 자동선정 필터를 적용하지 않는다.
- [확인] 기관 권위와 주제 적합도의 우선순위는 설정값으로 남긴다.
- [확인] 가이드라인 단계는 계속 non-fatal이어야 한다. 장애가 논문 데일리 코어를 중단시키면 안 된다.
- [추정] 자동 수집에서 “후보로 인정”하는 것과 “자동 발행 가능”은 분리해야 한다. 확대된 문서 유형은 후보에 보존하되, 문서 성격 검증을 통과하지 못하면 `needsReview`로 보낸다.

---

## 2. 현행 경로 실물 확인

### 2.1 수집

- [확인] `src/agents/DataCollectorAgent.js:497-520`의 `collectGuidelines()`는 기본 365일, 최대 40건을 검색한다.
- [확인] 쿼리는 `Practice Guideline` 또는 `Guideline` Publication Type을 필수로 하고 EM/CCM 관련 MeSH와 결합한다(`:500-504`).
- [확인] 검색 후에도 `publicationTypes`에 `/guideline/i`가 있는 문서만 다시 남긴다(`:517-520`). 따라서 PT가 없는 consensus, scientific statement, focused update, recommendations는 제목에 해당 표현이 있어도 탈락한다.
- [확인] “자동 경로가 PT 때문에 좁다”는 진단은 맞다.
- [확인] 다만 “30일당 0~6편”이라는 수치는 현재 코드에서 계산되는 값이 아니다. 저장소의 과거 실측 문서에 기록된 결과이며, 이번 읽기 전용 확인에서는 PubMed를 재측정하지 않았다.
- [확인] 현재 검색창은 30일이 아니라 기본 365일이다. “30일 구간당 0~6편”은 희소도 측정 단위이지 실제 자동 실행의 검색창 설명으로 쓰면 틀린다.

### 2.2 선정과 분석

- [확인] `src/agents/GuidelineAnalyzerAgent.js:20-50`은 전용 스코어러 없이 `MetadataScorer`를 생성하고 `scorePapers()`의 `rawScore`로 정렬한다.
- [확인] `MetadataScorer.scoreOne()`은 저널, 주제 적합도, 설계, 음의 감점, 주제 게이트와 배제 저널 게이트를 합산한다(`src/utils/MetadataScorer.js:186-241`).
- [확인] 배제 저널 판정은 `:249-287`, 연구설계 판정은 `:290` 이후, 소아·비급성 등 감점은 `_negativePenalty()`의 `:443-465`에 있다.
- [확인] 따라서 “논문용 스코어러가 그대로 걸린다”는 진단은 맞다.
- [확인] 제시된 행 범위 `191-210, 245-287`만으로 소아·비급성 감점까지 설명한다는 부분은 부정확하다. 해당 감점의 실제 구현 위치는 `444-465`다.
- [확인] `GuidelineAnalyzerAgent`는 선정 뒤 핵심 권고, 변경점, 임상 영향을 생성하며, 분석 실패 시 `null`을 반환하는 non-fatal 구조다.
- [확인] 같은 에이전트의 `reference` 모드는 수동 참고자료용이며 자동 가이드라인 선정과 섞으면 안 된다.

### 2.3 주기 게이트와 상태

- [확인] `src/orchestrator/TrendReviewOrchestrator.js:72-89`는 `output/selected_guidelines.json`을 노출 기록으로 읽고 `guidelineIntervalDays` 기본값 7일로 주기 게이트를 계산한다.
- [확인] `_stageGuideline()`은 주기가 되면 실시간 수집 → 이미 본 PMID 제거 → 한 편 분석 순서로 동작한다(`:370-410`). 영속 후보 큐는 없다.
- [확인] 발행할 카드가 있을 때만 `_saveGuideline()`이 `{pmid,title,org,date}`를 배열 끝에 추가한다(`:92-98`, `:551`).
- [확인] 단계 전체는 `try/catch`로 감싸져 실패 시 논문 파이프라인을 계속 진행한다.
- [확인] 현재 상태는 PMID 또는 수동 URL의 `sourceId` 중심 중복 방지일 뿐, 계보·버전·`supersededBy` 판정은 없다.
- [확인] `GuidelineScorer`, `config/guideline-orgs.json`, 자동 수집 큐, `needsReview` 구현은 없다. `config/`에는 현재 `collection.json`, `interests.json`, `journals.json`만 있다.
- [확인] 2026-08-06 문서에는 위 구조가 설계안으로 존재하지만, 일부 전제는 이번 확정안과 다르다. 특히 기존 문서의 2/3/7일 적응형 소진 주기는 폐기하고 “매일 시도, 빈 큐면 skip”으로 대체해야 한다.

### 2.4 수동 URL

- [확인] `scripts/on-demand.mjs:38-43`은 URL인지와 `kind=guideline|reference`인지만 검사한다.
- [확인] URL 경로는 `externalGuideline.js`로 본문을 가져오고 합성 문서를 만든다. 발행기관 도메인이나 기관 일치를 검증하지 않는다.
- [확인] 이는 이번 요구에서 결함이 아니라 확정 정책이다. 자동 학회 크롤러의 검증 규칙을 수동 경로에 재사용해서는 안 된다.

### 2.5 발행물과 관련 파일

- [확인] `guidelines.html`은 현재 실제 배포 산출물이며 가이드라인·참고자료 카드와 누적 표를 포함한다.
- [확인] `src/utils/GitHubPublisher.js:195-235`가 가이드라인 카드를 만들고, `:485-513`이 누적 표 행에 `data-kind`와 `data-guideline="1"`을 붙인다.
- [확인] 현재 카드와 표에는 `superseded` 상태를 표시할 필드나 마크업이 없다.
- [확인] `output/selected_guidelines.json`에는 PubMed 항목 6건과 수동 웹 항목 1건이 배열로 저장돼 있다. 웹 항목은 `sourceUrl`과 `sourceId`를 가진다.
- [확인] 직접 관련 실물은 다음과 같다.

  - `src/agents/DataCollectorAgent.js`
  - `src/agents/GuidelineAnalyzerAgent.js`
  - `src/utils/MetadataScorer.js`
  - `src/orchestrator/TrendReviewOrchestrator.js`
  - `src/utils/GitHubPublisher.js`
  - `src/utils/pageSplit.js`
  - `src/utils/externalGuideline.js`
  - `scripts/on-demand.mjs`
  - `scripts/pool-census.mjs`
  - `scripts/spec-lint.mjs`
  - `output/selected_guidelines.json`
  - `guidelines.html`
  - `.github/workflows/daily-review.yml`
  - `.github/workflows/on-demand.yml`
  - `.github/workflows/curate-remove.yml`
  - `test/externalGuideline.test.mjs`
  - `test/pageSplit.test.mjs`
  - `test/tableRowContract.test.mjs`
  - `test/onDemandWidget.test.mjs`
  - `test/selectionGuidelineRedesign.test.mjs`
  - `REPORT_SPEC.md`
  - `docs/superpowers/specs/2026-08-06-selection-guideline-redesign-design.md`

- [확인] 현재 `test/selectionGuidelineRedesign.test.mjs`는 논문 트랙의 저널·쿼리 계약만 검사한다. 새 가이드라인 스코어러나 큐를 검증하는 테스트는 아니다.

---

## 3. 목표 구조

```text
PubMed PT 검색 ─────────────┐
PubMed 제목·유형 확장 검색 ├─ 후보 정규화·중복 병합
승인 학회 사이트 수집 ─────┘
             │
             ▼
     문서 성격 판정 방어선
     ├─ 명백한 오탐 → rejected
     ├─ 불확실 → needsReview
     └─ 가이드라인 확인 → GuidelineScorer
                              │
                              ▼
                  selected_guidelines.json v2
                  ├─ queue
                  ├─ published
                  ├─ rejected
                  └─ sourceHealth
                              │
                       매일 최대 1편
                              ▼
             GuidelineAnalyzerAgent → 발행
                              │
                lineage/supersede 소급 반영
                              ▼
                       guidelines.html
```

`DataCollectorAgent.run()`과 논문 후보·재순위·PICO 경로는 변경하지 않는다. 가이드라인 수집기는 별도 메서드 또는 별도 에이전트로 호출하고, 모든 예외는 가이드라인 단계 안에서 흡수한다.

---

## 4. 자동 수집 설계

### 4.1 PubMed B 경로

두 독립 쿼리를 합친다.

1. 기존 PT 쿼리: `Guideline` 또는 `Practice Guideline`.
2. 확장 쿼리: 제목 또는 PubMed 문서 유형 메타데이터에서 다음 표현을 찾는다.

```text
consensus
consensus statement
scientific statement
position statement
focused update
clinical recommendations
practice recommendations
expert recommendations
```

- [추정] 단독 `statement`와 단독 `recommendations`는 너무 넓다. 쿼리에서는 허용하되 후단의 문서 성격 판정에서 더 강한 증거를 요구해야 한다.
- 결과는 `pmid:` ID로 병합하며, PT 경로와 확장 경로 양쪽에서 발견되면 `discoverySignals`를 합친다.
- `retmax` 절단을 감추지 않도록 `totalFound`, `idsFetched`, `oldestFetchedDate`, `newestFetchedDate`, 쿼리별 건수를 실행 증거에 남긴다.

### 4.2 승인 학회 C 경로

`config/guideline-orgs.json`에 기관 권위뿐 아니라 실제 수집 어댑터와 건강성 계약을 둔다. 단순 도메인 목록으로는 사이트 개편의 무음 실패를 검출할 수 없다.

기관별 어댑터는 다음 중 하나를 명시한다.

- `rss`: RSS/Atom 항목 추출
- `listing-html`: 목록 페이지에서 링크·제목·날짜 선택자 추출
- `sitemap`: sitemap URL 패턴 필터
- `api-json`: 공식 JSON API
- `manual-seed`: 자동 수집 불가능한 기관. 자동 성공으로 계산하지 않고 명시적으로 관찰 제외 상태를 표시

HTML 전체에서 임의 링크를 긁는 범용 크롤러 하나에 의존하지 않는다. 기관 사이트 변경이 모든 기관을 동시에 깨뜨리는 것을 막기 위해 기관별 추출 규칙을 데이터화한다.

---

## 5. `config/guideline-orgs.json` 스키마

```json
{
  "schemaVersion": 1,
  "policy": {
    "authorityWeight": 1.0,
    "topicWeight": 1.0,
    "recencyWeight": 1.0,
    "unmatchedTier1Policy": "needsReview",
    "autoPublishThreshold": 6.0,
    "reviewThreshold": 3.0
  },
  "organizations": [
    {
      "id": "aha",
      "name": "American Heart Association",
      "aliases": ["AHA", "American Heart"],
      "tier": 1,
      "authorityScore": 4.0,
      "domains": ["heart.org", "cpr.heart.org", "ahajournals.org"],
      "pubmedMatchers": {
        "affiliation": ["American Heart Association"],
        "title": ["AHA", "American Heart Association"]
      },
      "sources": [
        {
          "id": "aha-cpr-guidelines",
          "type": "listing-html",
          "url": "https://…",
          "includePatterns": ["guideline", "statement", "focused-update"],
          "excludePatterns": ["commentary", "podcast", "news"],
          "selectors": {
            "item": "…",
            "title": "…",
            "link": "…",
            "date": "…"
          },
          "health": {
            "maxSilenceDays": 14,
            "minimumItems": 1,
            "expectedContentMarker": "…"
          }
        }
      ]
    }
  ]
}
```

- `id`는 영구 키이며 기관명 변경에도 바꾸지 않는다.
- `aliases`와 `pubmedMatchers`는 기관 판정에, `domains`는 자동 C 경로의 링크 검증에만 사용한다.
- `domains`를 수동 URL 승인에 적용하지 않는다.
- `source.id`는 상태·로그·경보의 기준이다.
- 선택자는 설정에 두되, 필요한 경우 기관별 파서 모듈 이름을 `adapter`로 참조할 수 있다.
- 시작 시 스키마 검사: 중복 기관 ID, 중복 source ID, 잘못된 URL, 알 수 없는 adapter, tier와 점수 불일치를 실패로 처리한다.

---

## 6. 오탐 방어선

확장 검색의 핵심 원칙은 “키워드가 있으면 후보에는 넣되, 키워드만으로 자동 발행하지 않는다”이다.

### 6.1 1차: 명백한 부정 문맥 제외

제목을 소문자화하고 구두점·유니코드를 정규화한 뒤 다음 유형을 `rejected`로 보낸다.

- 합의 과정을 연구한 논문:

  - `consensus process`
  - `consensus methods`
  - `developing consensus`
  - `consensus exercise`
  - `delphi study|survey|round`
  - `agreement among`
  - `validation of consensus`
  - `adherence to recommendations`

- 지침 자체가 아닌 논평·요약·평가:

  - `commentary on`
  - `editorial`
  - `perspective`
  - `response to`
  - `letter`
  - `what is new in`
  - `implications of`
  - `appraisal of`
  - `evaluation of`
  - `comparison of guidelines`
  - `implementation of guidelines`
  - `barriers to guideline`
  - `guideline adherence`

단, 정확한 제목 패턴만으로 거부하고 초록의 단어 하나만으로는 자동 거부하지 않는다. 예를 들어 지침 본문이 방법론을 설명하면서 “Delphi”를 언급할 수 있기 때문이다.

### 6.2 2차: 가이드라인의 양성 증거

자동 발행 후보는 다음 중 최소 두 축의 증거를 요구한다.

- 문서 형식: PT가 Guideline/Practice Guideline이거나 제목이 `guideline`, `consensus statement`, `scientific statement`, `focused update`, `recommendations` 형식이다.
- 발행 주체: 승인 기관과 제목·저자단·저널·C 경로 출처가 일치한다.
- 규범적 내용: 초록 또는 공식 페이지에 `recommend`, `should`, `recommendation`, `class of recommendation`, `level of evidence`, `guidance` 같은 실제 권고 신호가 있다.
- 공식성: C 경로의 승인된 기관 source에서 발견되었거나 PubMed 메타데이터가 공식 문서임을 지지한다.

PT가 있는 문서는 강한 형식 증거 하나로 취급하되, “commentary/editorial” Publication Type이 함께 있거나 제목이 명시적 논평 패턴이면 `needsReview`로 내린다.

### 6.3 3차: 별도 `GuidelineScorer`

논문용 저널·연구설계·표본 점수를 완전히 제거한다.

```text
priority =
    authorityWeight × authorityScore(0..4)
  + topicWeight     × topicScore(0..4)
  + recencyWeight   × recencyScore(0..2)
  + scopeAdjustment
  + discoveryConfidence(0..2)
```

`discoveryConfidence` 예:

- PT Guideline/Practice Guideline: +2
- 승인 기관 C 경로: +2
- 확장 제목 신호만 있음: +1
- 명시적 권고 내용 신호: +1, 전체 상한 2

소아·비급성은 논문 스코어러에서 가져오지 않는다. 필요한 범위 조정은 가이드라인 전용 설정으로 명시한다. 명백히 관심 밖인 문서는 점수로 억지 보정하지 않고 상태 정책으로 분리한다.

### 6.4 상태 결정

- `rejected`: 명시적 부정 패턴이며 양성 증거가 이를 뒤집지 못함.
- `needsReview`: 문서 유형은 후보 범위에 들지만 공식성·규범성이 불충분하거나 양성/음성 신호가 충돌함.
- `queued`: 자동 발행 조건과 점수 하한을 모두 통과함.
- `published`: 발행 완료.
- `superseded`: 같은 계보의 신판이 확인된 대기 항목.
- `failed`: 분석이나 원문 확보가 실패해 재시도 대상임. 실패를 `queued`나 `published`로 위장하지 않는다.

`needsReview`는 삭제하지 않고 `guidelines.html`에 건수와 제목·판정 이유를 표시한다. PeterJ가 on-demand로 URL을 승인하면 자동 필터를 다시 통과시키지 않고 `manualApproved=true`로 바로 분석·발행한다.

### 6.5 스코어 임계값만으로 막지 않는 이유

- [추정] 기관명과 유행 주제가 제목에 함께 등장하면 “지침 논평”도 높은 점수를 받을 수 있다.
- [추정] 따라서 문서 성격 판정은 점수 계산 전에 실행해야 한다.
- 점수는 진짜 가이드라인 사이의 발행 우선순위에 사용한다.
- 오탐 여부가 불분명한 문서는 점수를 낮춰 언젠가 자동 발행시키지 않고 `needsReview`로 격리한다.

---

## 7. 기관 권위와 주제 우선순위 정책

코드는 하나의 공식과 상태 결정기를 유지하고 `policy` 값만 바꾼다. 정책명에 따른 분기 로직을 만들지 않는다.

### 권위 우선

`authorityWeight > topicWeight`로 둔다. 승인된 tier-1 기관의 범용 응급·중환자 지침이 좁은 관심주제 문서보다 먼저 발행될 수 있다. 주제 무매칭 tier-1을 자동 발행하려면 `unmatchedTier1Policy="queue"`로 설정한다. 장점은 대형 학회 업데이트를 놓치지 않는 것이고, 단점은 실제 관심 밖 문서가 큐를 차지할 수 있다는 점이다. 오탐 방어선의 문서 성격 검증은 그대로 유지한다.

### 주제 우선

`topicWeight > authorityWeight`로 둔다. 기관 규모보다 EM/CCM 관심주제 적합도가 높은 지침을 먼저 소진한다. tier-2 전문학회의 밀접한 지침이 tier-1의 주변 주제 지침보다 앞설 수 있다. 주제 무매칭은 기관 티어와 무관하게 `rejected` 또는 `needsReview`가 되므로 큐 순도는 높지만, 중요한 범용 정책 문서를 늦게 보거나 놓칠 위험이 있다.

### 무매칭 tier-1 `needsReview` 보존

가중치는 어느 쪽으로 두어도 되며 `unmatchedTier1Policy="needsReview"`만 고정한다. 주제 점수가 0인 tier-1 문서는 자동 발행하지 않되 삭제하지 않고 검토함에 보존한다. 이는 권위 우선과 주제 우선 사이의 안전한 중간 정책이다. 설정 변경 후 `queued`와 `needsReview`만 재채점하고 `published` 이력은 바꾸지 않는다.

---

## 8. 큐·발행 상태 스키마

기존 파일명을 유지하되 배열을 v2 객체로 승격한다.

```json
{
  "schemaVersion": 2,
  "updatedAt": "2026-08-14T00:00:00.000Z",
  "configVersion": "guideline-v2",
  "lastRun": {
    "runId": "…",
    "startedAt": "…",
    "completedAt": "…",
    "outcome": "published|empty|nonfatal-failure",
    "publishedId": null
  },
  "queue": [
    {
      "id": "pmid:41236566",
      "pmid": "41236566",
      "sourceId": null,
      "canonicalUrl": "https://…",
      "title": "…",
      "normalizedTitle": "…",
      "organizationId": "esicm",
      "documentType": "guideline|consensus|scientific-statement|focused-update|recommendations",
      "discoveredBy": ["pubmed-pt", "pubmed-title", "org:esicm:guidelines"],
      "discoveredAt": "…",
      "lastSeenAt": "…",
      "pubDate": "2025-11-01",
      "versionYear": 2025,
      "lineageKey": "esicm|circulatory-shock-hemodynamic-monitoring",
      "status": "queued",
      "priority": 8.7,
      "scoreBreakdown": {
        "authority": 4,
        "topic": 2.7,
        "recency": 1,
        "scope": 0,
        "confidence": 1
      },
      "decisionReasons": ["approved-org", "normative-content"],
      "attempts": 0,
      "lastAttemptAt": null,
      "lastError": null,
      "manualApproved": false
    }
  ],
  "published": [
    {
      "id": "pmid:…",
      "lineageKey": "…",
      "publishedAt": "…",
      "status": "current|superseded",
      "supersededBy": null,
      "supersededAt": null,
      "card": {}
    }
  ],
  "rejected": [
    {
      "id": "pmid:…",
      "reasonCode": "commentary|consensus-method-study|untrusted-source|off-topic",
      "decidedAt": "…",
      "evidence": []
    }
  ],
  "sourceHealth": {
    "org:aha:aha-cpr-guidelines": {
      "attemptedAt": "…",
      "httpStatus": 200,
      "parseSucceeded": true,
      "itemsSeen": 12,
      "newItems": 1,
      "contentFingerprint": "sha256:…",
      "selectorMatches": {
        "item": 12,
        "title": 12,
        "link": 12
      },
      "consecutiveFailures": 0,
      "lastSuccessfulAt": "…"
    }
  }
}
```

기존 배열 로더는 각 항목을 `published`로 무손실 이관한다. 빈 PMID 웹 항목은 `sourceId`를 ID로 사용한다. 기존 필드를 버리지 말고 알 수 없는 `organizationId`, `lineageKey`, `versionYear`는 `null`로 둔 뒤 별도 마이그레이션 보고서에 기록한다.

---

## 9. 계보와 개정판 판정

### 9.1 결정적 정규화

`lineageKey = organizationId + "|" + normalizedSubject`로 구성한다.

제목 정규화 순서:

1. Unicode NFKC, 소문자화, 구두점·중복 공백 정리.
2. 기관명과 알려진 alias 제거.
3. 연도와 버전 토큰 제거:

   - `19xx|20xx`
   - `update`, `updated`, `focused update`
   - `version`, `edition`
   - `guideline(s)`, `guidance`
   - `consensus statement`, `scientific statement`
   - `recommendations`
   - `for the management of`

4. 의미 없는 관사·접속어 제거.
5. 남은 핵심 토큰을 정렬하지 않고 원래 순서로 유지해 subject slug를 생성한다.
6. 기관 설정의 `lineageAliases`로 알려진 제목 변경을 보정한다.

예:  
`2025 ESICM Guidelines on Circulatory Shock and Hemodynamic Monitoring`  
→ `esicm|circulatory-shock-hemodynamic-monitoring`

### 9.2 신판 판정

같은 `lineageKey` 안에서 다음 우선순위로 최신성을 비교한다.

1. 명시적 버전/판 연도
2. 공식 발행일
3. PubMed 발행일
4. 공식 페이지의 `lastModified`
5. 모두 같거나 없으면 자동 supersede 금지

새 항목이 더 최신이면:

- 새 항목은 독립 `queued` 카드로 유지한다.
- 대기 중 구판은 `status="superseded"`로 바꾸고 자동 발행 대상에서 제외한다.
- 이미 발행된 구판은 `status="superseded"`, `supersededBy`, `supersededAt`을 기록한다.
- 구판 카드와 누적 표는 삭제하지 않는다.

서로 다른 제목이 같은 계보로 합쳐질 가능성이 있거나, 같은 제목인데 범위가 달라진 경우에는 자동 supersede하지 않고 양쪽을 `lineageReview=true`로 둔다.

### 9.3 배지 위치

`guidelines.html`의 구판 카드 상단 chips 영역에 `구판 · {신판 연도/버전}으로 대체됨` 배지를 붙이고 새 카드 링크를 제공한다. 누적 표에는 제목 앞 또는 별도 상태 셀에 `superseded`를 표시한다. 새 카드에는 필요하면 `신판`과 `supersedes: 구판 제목`을 표시한다.

발행 HTML 문자열만 사후 정규식으로 고치는 방식을 정본으로 삼지 않는다. `published[].card`와 상태 필드로 가이드라인 섹션을 재렌더링해야 재실행 때 배지가 사라지지 않는다.

---

## 10. 매일 소진 규칙

매일 `_stageGuideline()`을 호출하며 날짜 간격 게이트를 제거한다.

1. PubMed B 및 승인 학회 C 수집을 시도한다.
2. 후보를 정규화·병합하고 문서 성격을 판정한다.
3. 큐·`needsReview`·`rejected`·source health를 저장한다.
4. lineage 스윕을 실행한다.
5. `queued` 중 `priority >= autoPublishThreshold`인 최상위 한 건을 고른다.
6. 후보가 없으면 `outcome="empty"` 증거를 남기고 건너뛴다.
7. 한 건이 있으면 분석하고 성공 후에만 `published`로 이동한다.
8. 분석 실패 시 `attempts`, `lastError`, `nextRetryAt`을 기록하고 큐에 남긴다. 같은 실패 항목이 영원히 head를 막지 않도록 제한 횟수 뒤 `needsReview`로 이동한다.

백로그가 깊어도 하루 최대 한 카드만 자동 발행한다. 큐 깊이에 따라 2/3/7일로 늦추는 기존 설계안은 적용하지 않는다.

---

## 11. 무음 실패 방지와 실행 증거

“설정 플래그가 켜졌다” 또는 “단계를 호출했다”는 성공 증거가 아니다. 각 실행에서 실제 관측값을 영속화한다.

### 11.1 수집 증거

기관 source마다 다음을 기록한다.

- 요청 시작·종료 시각
- 최종 URL과 HTTP 상태
- 응답 byte 수와 콘텐츠 fingerprint
- 파서 버전
- 목록·제목·링크·날짜 선택자별 매칭 수
- 발견 총수, 신규 수, 기존 항목 재관측 수
- 가장 최신·오래된 항목 날짜
- `lastSuccessfulAt`, 연속 실패 횟수

HTTP 200이어도 선택자 매칭 0건, 필수 콘텐츠 마커 소실, 응답 크기 급감, 로그인 페이지 fingerprint, 동일 콘텐츠 장기 고정은 실패 또는 경고다.

### 11.2 실행 manifest

매일 `guideline-run:{runId}` 증거에 다음 결과를 남긴다.

```json
{
  "runId": "…",
  "pubmed": {
    "queriesAttempted": 2,
    "queriesSucceeded": 2,
    "idsFound": 31,
    "articlesFetched": 31
  },
  "orgSources": {
    "configured": 8,
    "attempted": 8,
    "parsed": 7,
    "failed": 1
  },
  "decisions": {
    "queued": 3,
    "needsReview": 2,
    "rejected": 4,
    "superseded": 1
  },
  "publish": {
    "attempted": true,
    "candidateId": "pmid:…",
    "analyzed": true,
    "htmlContainsCardId": true,
    "stateContainsPublishedId": true
  },
  "outcome": "published"
}
```

발행 성공은 다음 세 증거가 모두 있을 때만 인정한다.

1. 분석 카드 생성
2. 상태의 `published` 전이
3. 생성된 `guidelines.html`에서 해당 안정 ID 확인

로그에 “DONE”을 찍는 것만으로 성공 처리하지 않는다.

### 11.3 경보 조건

- source 연속 실패
- `maxSilenceDays` 초과
- HTTP 성공이나 파싱 0건
- 이전 중앙값 대비 항목 수 급감
- 설정된 source 중 미시도 source 존재
- PubMed 쿼리 일부 실패
- 큐 쓰기 실패 또는 저장 후 재읽기 불일치
- `published` 전이와 HTML 카드 불일치
- `supersededBy` 대상이 존재하지 않음
- 모든 source가 동시에 신규 0건인 상태가 비정상적으로 지속
- `needsReview`가 일정 수 이상 누적되거나 장기 미검토
- 동일 항목의 반복 분석 실패

가이드라인 단계는 non-fatal이므로 논문 잡은 성공할 수 있다. 대신 manifest의 `outcome="nonfatal-failure"`와 요약 경고가 반드시 남아야 한다.

---

## 12. 독립 커밋 단위와 의존성

### G0. 계약과 회귀 보호

**변경 범위:** `REPORT_SPEC.md`, 가이드라인 전용 fixture 및 현재 동작 고정 테스트.

- 현행 7일 게이트, 배열 상태 마이그레이션 입력, 수동 URL 최종 승인, non-fatal 경계를 테스트로 고정한다.
- 논문 데일리 경로의 수집·선정 결과가 바뀌지 않는 회귀 테스트를 추가한다.
- 아직 런타임 배선을 바꾸지 않는다.

**테스트**

- 기존 unit/spec-lint 전체 통과
- `DataCollectorAgent.run()`과 논문 스코어러 산출 불변
- 수동 URL에 기관 검증이 호출되지 않음

**의존:** 없음.

### G1. 데이터 계약과 전용 스코어러

**변경 범위:** `config/guideline-orgs.json`, `GuidelineScorer`, 스키마 검증기.

- 기관·source·정책 스키마를 추가한다.
- `MetadataScorer`를 수정하지 않고 가이드라인 전용 점수기를 만든다.
- 기관/주제 가중치와 무매칭 정책을 설정으로 주입한다.

**테스트**

- 세 정책 조합에서 코드 변경 없이 순위·상태만 달라짐
- 저널·표본·연구설계가 점수에 영향 없음
- 중복 ID, 잘못된 adapter, 무효 URL fail-fast
- 확장 문서 유형별 양성 fixture

**의존:** G0.

### G2. 문서 성격 판정과 오탐 corpus

**변경 범위:** 가이드라인 후보 분류기와 fixture corpus.

- 양성 증거, 부정 패턴, 충돌 시 `needsReview` 규칙을 구현한다.
- 점수 계산보다 먼저 실행한다.

**테스트**

- 실제 지침 제목은 `queued`
- Delphi/consensus-process 연구는 `rejected`
- guideline commentary·implementation·adherence 연구는 `rejected`
- 애매한 statement/recommendations는 `needsReview`
- PT와 editorial 신호 충돌은 `needsReview`
- 패턴 대소문자·구두점 변형

**의존:** G1.

### G3. 상태 v2와 무손실 마이그레이션

**변경 범위:** `selected_guidelines.json` 로더·저장기.

- 기존 배열을 메모리에서 v2로 승격한다.
- 원자적 저장과 저장 후 재읽기 검증을 추가한다.
- 아직 오케스트레이터에 연결하지 않는다.

**테스트**

- 현재 7개 항목 무손실 이관
- PMID가 빈 웹 항목의 `sourceId` 보존
- 손상 파일은 조용히 빈 큐로 바꾸지 않고 오류 증거를 남김
- v2 반복 로드/저장 멱등성
- 동시 중복 후보 병합

**의존:** G1.

### G4. PubMed B 수집 확장

**변경 범위:** 가이드라인 전용 PubMed 수집 메서드.

- 기존 PT와 제목·유형 확장 쿼리를 병렬 수집하고 결과를 병합한다.
- 논문 수집 메서드와 설정은 건드리지 않는다.

**테스트**

- PT 없는 consensus/statement/focused update/recommendations 유입
- 두 쿼리 중복 PMID 병합 및 discovery signal 보존
- 한 쿼리 실패 시 부분 성공 증거
- retmax·날짜·실제 fetch 건수 manifest 기록

**의존:** G2, G3.

### G5. 승인 학회 C 수집기와 health evidence

**변경 범위:** 기관별 source adapter, source health 저장, dry-run 명령.

- 처음에는 AHA·ESC·SCCM·ACEP 등 우선 기관을 각각 fixture와 함께 추가한다.
- 프로덕션 큐 배선 전 dry-run으로만 실행한다.

**테스트**

- 저장된 HTML/RSS fixture에서 항목 추출
- 선택자 변경 시 HTTP 200이어도 적색
- 빈 목록, 로그인 페이지, 리디렉션, 중복 링크, 날짜 누락
- source 일부 실패가 다른 기관 수집을 막지 않음
- `maxSilenceDays` 경보

**의존:** G1, G3.

### G6. 계보와 supersede 상태 전이

**변경 범위:** 제목 정규화기, lineage resolver, 상태 전이.

- 연도·버전·문서 형식 표현을 제거해 계보를 만든다.
- 애매한 병합은 자동 처리하지 않는다.

**테스트**

- 동일 기관·동일 주제의 2025→2026 신판
- 다른 기관의 같은 제목은 별도 계보
- `focused update`와 본 지침의 올바른 연결
- 제목이 크게 바뀐 alias
- 날짜·버전 불명은 자동 supersede 금지
- queue와 published 양쪽 구판 처리
- 삭제된 발행 기록 0건

**의존:** G3.

### G7. 가이드라인 오케스트레이터 배선

**변경 범위:** `_stageGuideline()`만 교체.

- 7일 게이트를 제거하고 매일 수집·큐 소진을 시도한다.
- 최대 한 편, 빈 큐 skip, retry/needsReview 전이를 구현한다.
- 가이드라인 단계의 최상위 `try/catch`와 논문 non-fatal 계약을 유지한다.

**테스트**

- 연속 이틀 큐가 있으면 각 하루 한 편
- 빈 큐면 LLM 미호출 및 `outcome=empty`
- 수집 실패에도 기존 큐 발행 정책이 명시대로 동작
- 분석 실패 시 published 전이 금지
- 가이드라인 예외 뒤에도 논문 publish 호출
- 플래그가 아니라 실제 `candidateId`, 분석, 상태 전이 증거 확인

**의존:** G4, G5, G6.

### G8. 배지·검토함·전량 재렌더

**변경 범위:** 가이드라인 publisher와 `guidelines.html` 렌더링.

- published 상태를 정본으로 카드와 표를 재생성한다.
- 구판 카드에 `superseded` 배지와 신판 링크를 소급 적용한다.
- `needsReview` 접이식 목록과 판정 이유를 표시한다.
- 논문 `index.html` 렌더러와 날짜 스윕 계약은 건드리지 않는다.

**테스트**

- 구판 카드와 표가 보존되고 배지만 추가됨
- 새 카드와 구판 링크 상호 일치
- 재발행 후 배지 소실 없음
- `data-pmid`, `data-kind`, `data-guideline` 기존 계약 유지
- page split, curation, table row 기존 테스트 통과
- HTML 카드 ID와 상태 published ID 일치

**의존:** G6, G7.

### G9. workflow 증거·관제

**변경 범위:** daily workflow의 가이드라인 manifest 보존·검증 단계.

- 실행 manifest를 artifact와 영속 상태에 남긴다.
- source health 검증은 논문 잡을 실패시키지 않되 눈에 띄는 경고를 만든다.
- state 커밋 성공과 Pages 반영을 별도 증거로 본다.

**테스트**

- manifest 누락 시 검증 실패
- “단계 실행 로그만 있고 source attempt 없음” 탐지
- state에는 published인데 HTML에 카드가 없는 경우 탐지
- HTML에는 카드가 있는데 state 전이가 없는 경우 탐지
- workflow fixture에서 일부 source 실패가 경고로 노출됨

**의존:** G7, G8.

### G10. 백필

**변경 범위:** workflow_dispatch 전용 백필 명령.

- 월 또는 분기 단위로 PubMed를 나누어 수집하고 승인 기관 사이트의 현재 목록을 병합한다.
- 기본은 dry-run이며 큐 깊이·오탐 판정 분포·기관별 수집 상태를 보고한 뒤 명시적 apply에서만 상태를 갱신한다.
- 데일리 코어 밖에서 실행해 rate limit과 대량 상태 변경을 격리한다.

**테스트**

- 동일 구간 재실행 멱등성
- 중간 실패 후 재개
- 기존 published 재큐잉 금지
- 백필 신판이 과거 published 구판에 supersede를 소급 적용
- dry-run이 어떤 파일도 바꾸지 않음

**의존:** G4-G9.

---

## 13. 배포 순서

1. G0-G3을 먼저 병합해 계약·점수·상태 기반을 만든다. 런타임 자동선정은 현행 그대로 둔다.
2. G4와 G5를 dry-run으로 배포해 최소 1주간 PubMed 확장 오탐률과 기관별 파서 건강성을 관찰한다.
3. fixture와 실제 후보를 사용해 G2의 제외 패턴과 임계값만 설정으로 조정한다.
4. G6과 G8을 상태 fixture로 검증해 기존 카드가 한 건도 사라지지 않는지 확인한다.
5. G7에서 매일 소진을 연결하되 첫 배포는 `autoPublishThreshold`를 보수적으로 두고 `needsReview` 분포를 관찰한다.
6. G9의 실행 증거 검증이 실제 배포에서 확인된 뒤 G10 백필을 dry-run한다.
7. 백필 결과를 승인한 후 apply하여 사실상 매일 한 편씩 소진한다.

각 단계는 독립 revert 가능해야 한다. 특히 G4/G5 수집 확대와 G7 자동 발행을 같은 커밋에 넣지 않는다.

---

## 14. 주요 위험과 대응

| 위험 | 실패 양상 | 방어·실행 증거 |
|---|---|---|
| 확장 키워드 오탐 | consensus 연구·지침 논평 자동 발행 | 선행 문서 성격 판정, fixture corpus, 충돌 시 `needsReview` |
| 승인 기관 오인 | 저자 소속이나 기사에서 기관명만 언급 | 기관 alias뿐 아니라 문서 형식·규범적 내용·공식 source를 교차 확인 |
| 사이트 개편 | HTTP 200이지만 항목 0건 | selector별 match 수, content marker, fingerprint, `maxSilenceDays` |
| 로그인/봇 차단 페이지 | 성공 응답으로 오인 | 최종 URL·본문 marker·응답 크기·제목 검사 |
| RSS 중단 | 영원히 신규 0건 | 마지막 성공·마지막 신규를 분리하고 기관별 침묵 한도 경보 |
| PubMed 일부 쿼리 실패 | PT 또는 확장 경로 하나가 조용히 사라짐 | 쿼리별 attempted/succeeded/found/fetched 증거 |
| `retmax` 절단 | 오래된 백로그가 보이지 않음 | totalFound와 fetched 비교, 백필 기간 분할 |
| 큐 파일 손상 | 빈 큐로 간주해 계속 skip | 파싱 실패를 nonfatal-failure로 기록, 빈 상태 자동 덮어쓰기 금지 |
| 중복 문서 | PubMed판과 학회 웹판이 별도 발행 | DOI, canonical URL, PMID, 제목+기관+연도 순의 병합 |
| 잘못된 lineage | 관련 있지만 다른 범위의 지침이 구판 처리 | 기관+주제 키, 날짜/버전 비교, 애매하면 lineage review |
| 신판 미탐지 | 구판 배지 누락 | 수집 때마다 queue와 published 양쪽 lineage 스윕 |
| HTML만 성공 | 상태와 페이지 불일치 | 상태 전이·HTML 안정 ID·Pages 반영을 별도 확인 |
| 상태만 성공 | 사용자는 카드를 못 봄 | `htmlContainsCardId` 없으면 published 성공으로 인정하지 않음 |
| 분석 실패 head 고착 | 매일 같은 항목만 재시도 | attempts/nextRetryAt, 제한 후 `needsReview` 이동 |
| `needsReview` 부패 | 후보가 영구 방치 | 페이지에 건수·나이·이유 표시, 장기 미검토 경보 |
| 정책 변경으로 이력 변형 | 과거 발행 순위·상태가 재작성 | queued/needsReview만 재채점, published 불변 |
| 수동 URL 차단 | PeterJ 승인 입력이 자동 검증에서 거부 | 수동 경로를 자동 source 검증과 분리하고 회귀 테스트 |
| 가이드 장애가 논문을 중단 | 데일리 코어 손상 | 별도 단계·별도 상태·최상위 non-fatal catch 회귀 |
| F1 재발 | 로그는 성공인데 실제 판정·발행 미실행 | 후보 ID, 분류 결과, 분석 완료, 상태 전이, HTML 존재를 실행 증거로 묶음 |

최종 운영 계약은 다음 한 문장으로 고정한다.

> 가이드라인 기능은 논문 데일리를 멈추지 않지만, 가이드라인 내부의 실패를 성공이나 빈 날로 가장해서는 안 된다. 설정값이나 진입 로그가 아니라 수집·판정·상태 전이·발행 결과의 실행 증거를 남긴다.