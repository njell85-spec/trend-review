# 논문 선정 + 가이드라인 트랙 개편 — 합의 설계 **(DRAFT — PeterJ 확정 전)**

> 상태: **draft**. 클코덱스 설계토론(Fable ↔ gpt-5.6-sol, R0 → R1 → 심판) 수렴 결과.
> **승인 게이트: PeterJ가 확정하기 전에는 구현 착수 금지.** 확정 시 draft 표기를 뗀다.
>
> 토론 원본: `docs/reviews/2026-08-06-1421-selection-quality-debate.md`
> 진단 F1~F8: 같은 문서 §1
> 심판 판정문 전문: 같은 문서 §4

---

## 0. 이 개편이 서 있는 두 개의 실측

설계 논쟁 대부분은 **판정 중 수행한 PubMed 라이브 실측**으로 닫혔다. 양측 설계자의 핵심
전제가 둘 다 사실과 달랐고, 그래서 두 R1의 처방이 모두 부분적으로 빗나가 있었다.

### 실측 A — `"sepsis"[MeSH]` 독립항 하나가 풀의 76%를 만든다

현행 쿼리(`DataCollectorAgent.js:21-22`)로 30일(2026-07-07~08-06) 측정:

| 쿼리 | 30일 건수 | 패혈증 비중 |
|---|---:|---:|
| 현행 3항 (sepsis 독립항 포함) | **403** | — |
| sepsis 독립항 제거 | **96** | — |
| sepsis 독립항 제거 + MeSH 확장(실측 B) | **886** | **61건 = 6.9%** |

→ **확정 ③(패혈증 30% 미만)은 쿼리 1줄 수정으로 충족된다.** 주제별 lane 할당이나
sepsis 하드캡 같은 구조물은 필요 없다. F7의 "선정 25편 중 16편 패혈증"은 랭커의 잘못이
아니라 **쿼리의 지문**이었다.

교차 검증(확장 쿼리 내 주제 분포): 심정지·CPR 6.7% · 호흡/환기/기도 13.9%.
**어떤 단일 주제도 30%를 넘지 않는다.**

### 실측 B — ★ 현행 쿼리는 실제 EM/CCM 문헌의 약 11%만 본다

`"emergency medicine"[MeSH]`·`"critical care"[MeSH]`는 **진료 세팅이 아니라 학문 분야**를
가리키는 디스크립터다.

| MeSH 집합 (30일) | 건수 |
|---|---:|
| `emergency medicine` OR `critical care` (현행) | **96** |
| `emergency service, hospital` OR `critical illness` OR `intensive care units` OR `resuscitation` | **851** |
| 합집합 | **886** |

→ 이것이 F3의 "하위 5편이 전부 소아감염·**의학교육**·질적연구"와 F7의 sepsis 편중을 **동시에**
설명한다. 분야 용어 쿼리가 교육·인력 논문을 끌어왔고, 유일한 *질환* 용어였던 `sepsis`가
나머지를 다 삼켰다.

**중대한 함의**: 양측 설계자 누구도 MeSH 선택 자체를 검토하지 않았다. **sepsis 항만 빼면
풀이 403 → 96으로 붕괴한다** — Fable R0의 0층안을 그대로 시행했다면 후보 고갈로 품질이
오히려 나빠졌을 것이다. 이것이 P0에서 가장 중요한 단일 수정이다.

### 실측 C — 무필터 저명저널 스트림은 확정 ④를 배달하지 못한다

180일(2026-02-07~08-06):

| B 스트림 쿼리 | 180일 건수 | retmax 80의 실효 기간 |
|---|---:|---:|
| 저명저널 `[ta]` 20종, **필터 없음**(Fable R0 원안) | **9,853** | **약 1.5일** |
| 위 + 설계 PT 필터(RCT/메타/체계적고찰) | **690** | 약 21일 |

→ Fable R0의 "주제 필터 없이 retmax≈200"과 codex R1의 "B 80편"은 **둘 다 확정 ④(놓친
대작부터 소진)를 전혀 배달하지 못한다.** `sort=date` 절단이 4~6개월 전 대작을 매일 예외
없이 버린다. codex R1 §1.6의 "다음 날 다시 경쟁한다"는 **애초에 풀에 들어온 적 없는
논문에게는 일어나지 않는다.** (Fable N1의 진단이 옳았다.)

→ 처방: **B를 월 6분할 층화 추출 + 설계 PT 필터.** 시드 파일 영속화(~120줄, 새 상태·새
라이프사이클)보다 훨씬 싸고(~25줄 루프), 캐치업이 끝난 뒤에도 영구히 작동한다.

---

## 1. PeterJ 확정 제약 (재론 금지)

| # | 확정 | 설계 반영 |
|---|---|---|
| ① | flagship 리뷰는 예외 허용 | 설계 축을 **저널 티어 조건부**로. `top_general`(최상위 종합지)만 예외 — 확정 문언이 "NEJM·Lancet급"이므로 `em_ccm_flagship`(jama network open·blood·gastroenterology 포함)까지 넓히지 않는다 |
| ② | 간호·보건서비스지 low **-1.0** | `journals.json` low 티어에 명시. default 중립화로는 부족 |
| ③ | 패혈증 30% 미만 | 쿼리에서 sepsis 독립항 제거(주 장치) + 후보 20 주제 상한 5/20(안전벨트) |
| ④ | 따라잡기 허용 — 놓친 대작부터 소진 | **최신성 축 삭제** + B 스트림 월 6분할 |

---

## 2. 확정 합의 15건 (양측 동의 — 판정 불필요)

F1 재순위 복구 · 정직한 로그 · 저널 부분일치 폐기 · 간호지 low -1.0 · 표본 축 삭제 ·
최신성 축 삭제 · 양의 actionability 축 철회 · 날짜 소스 교정(점수 아닌 동점분리용) ·
주제 축 탈포화 + 검색MeSH 누출 제거 · 논문 매일 1편 유지 · 가이드 스코어러 분리 ·
가이드 (다)백필큐+(나)폴백 하이브리드 · 가이드 저널·표본·설계 축 삭제 · 상태 리셋 없음 ·
가이드 별도 페이지.

---

## 3. 심판이 닫은 주요 쟁점

| 쟁점 | 판정 | 한 줄 근거 |
|---|---|---|
| 수집 구조 | **이중 스트림**(lane 기각) | 실측 A로 lane의 존재 이유(확정 ③ 보장)가 사라짐. lane 쿼리를 `interests.json.terms`에서 자동 생성하는 절충은 **타입 오류** — 그 배열은 PubMed 검색어가 아니라 `String.includes()` 스코어링 문자열이고 맨몸 `"cardiac"`·`"shock"`이 들어 있어 F2를 쿼리 층에서 재현한다 |
| 저널 축 스케일 | **티어 -1.0~4.0 유지** + `DESIGN_SCALE 0.375→0.5` | codex 안(`topic 3.0 > design 2.2 > journal 1.8`)은 **보조 축이던 설계를 ② 자리로 승격** — 확정 우선순위(`interests.json:2`, `MetadataScorer.js:9`)를 뒤집는다. codex 자신도 A0 §J-2에서 이를 미해결 질문으로 남겨놓고 R1 수렴안엔 바꾼 값을 넣었다 |
| 후보 20 다양성 | 상한 방식 + **5/20** | 확정 ③이 "30% **미만**"이므로 6/20=30%는 위반, 5/20=25%는 충족. 실측상 캡 발동이 거의 없어 타이트한 캡이 사실상 공짜 |
| 가이드 상태파일 | **1파일**, 기존 `selected_guidelines.json` 재사용 | Fable R1의 "2파일"은 자기 R0 스키마(한 파일에 queue+published)와 모순. 기존 경로를 쓰면 `GitHubPublisher.js:666, :825`의 수동 파일 목록을 **0곳** 고친다 |
| 가이드 주제 게이트 | **needsReview**(codex) | 보존과 발행을 분리해 Fable의 우려(희소 코퍼스 영구 소실)를 완전히 흡수하면서, 무조건 면제가 만드는 "저명하지만 무관"의 기관명 버전을 막는다 |
| 논문 캐치업 큐 | **영속 큐 불필요** — 단 메커니즘은 월 6분할로 대체 | 실측 C |

---

## 4. 심판 추가 지적 (양측 모두 놓친 것)

1. **★ 쿼리 MeSH가 학문 분야 용어** — 실측 B. P0에서 가장 중요.
2. **★ 주제 탈포화가 ①주제 ②저널을 조용히 뒤집는다** — Fable R0의 체감가중 `[0.45, 0.20, 0.10]`은
   3히트 합이 0.75다. `rel01`이 1.0에 못 닿으면 `relPart = rel01 × 4.0`의 **실질 상한이 3.0으로
   내려앉고** 저널 축은 4.0 그대로 남아 **저널 > 주제**가 된다.
   → 처방: 합이 1.0에 도달하는 `[0.50, 0.25, 0.15, 0.10]`(4히트=1.00). 2히트=0.75로 포화는
   확실히 해소되면서 상한은 보존.
3. **`guidelines.html`은 상태 파일에서 전량 재생성** — `index.html`의 증분 정규식 패치
   (`:746, :758, :787`)는 역사적 부채다. 코퍼스가 90~180건뿐이라 전량 재생성이 더 싸고,
   N3(발행분 소급 supersede 배지)가 거의 공짜가 된다.
4. **REPORT_SPEC / spec-lint 연동** — `spec-lint.mjs:32-40`이 `"180일"`·`"300편"`·`"1편"` 토큰을
   강제한다. 본 설계는 셋 다 문자 그대로 유지한다(codex의 B=120일 안은 "180일" 토큰의 근거를
   잃게 만든다 — B 창을 180일로 두는 부수적 이유). 텔레그램 ⚠ 1줄 추가는 §2 개정 + lint 갱신 선행.
5. **`DESIGN_RULES`의 `guideline → 3.3`이 논문 트랙에도 살아 있다**(`MetadataScorer.js:26`) —
   B 스트림 설계 필터에 `guideline`을 넣으면 가이드라인이 논문 후보 풀에 들어와 1.65를 받는다.
   트랙 분리 취지에 어긋남 → B 필터는 RCT/메타/체계적고찰만.
6. **단일 축 지배 상시 계측** — F2가 4주간 안 잡힌 이유는 저널 축이 지배했다는 사실을 **아무도
   볼 수 없었기 때문**이다. 후보 20의 축별 기여율 평균이 50% 초과 시 주간 경보.

---

## 5. 합의 스펙

### 5.1 논문 트랙 — 0층 수집

**신규 `config/collection.json`** (폰 튜닝):
```json
{
  "maxPapers": 300,
  "streamA": {
    "days": 30,
    "retmax": 220,
    "mesh": ["emergency service, hospital", "critical illness",
             "intensive care units", "resuscitation",
             "critical care", "emergency medicine"]
  },
  "streamB": {
    "days": 180,
    "slices": 6,
    "retmaxPerSlice": 16,
    "journalChunkSize": 10,
    "designTypes": ["randomized controlled trial",
                    "meta-analysis", "systematic review"]
  },
  "candidatePoolSize": 20,
  "candidateTopicCap": 5,
  "streamBReserved": 2,
  "queryMeshExclusions": ["critical care", "emergency medicine",
                          "intensive care units", "resuscitation",
                          "critical illness", "emergency service, hospital"]
}
```

- **스트림 A** — `(mesh OR 체인)`, `datetype=edat`, `sort=date`, `retmax=220`, 30일.
  `"sepsis"[MeSH]` 독립항 **삭제**. 실측 886편/30일 → 220 슬롯은 **실효 약 7.5일**이므로
  "30일 창"이라고 부르지 않는다. 수집 통계에 `oldestPubDate/newestPubDate` 필수 기록(정직성).
- **스트림 B** — 30일 슬라이스 6개 각각:
  `(저명저널 pubmedTa OR 체인, 10개씩 chunk) AND (designTypes OR 체인)`, `retmax=16`.
  `journals.json`의 `top_general.pubmedTa` + `em_ccm_flagship.pubmedTa` 사용. 주제 필터 없음
  (fail-closed는 1층 게이트 담당).
- **합성** — `dedup(A ∪ B)` → B 최소 80편 확보 → 부족분 A로 충전 → 최대 300편 → efetch 30배치
  (현행과 동일).
- **날짜** — `PubmedData.History/PubMedPubDate[pubmed]` → `Article.ArticleDate` →
  `JournalIssue.PubDate`. `pubDateSource` 병기. **점수에 쓰지 않고 동점 분리에만.**

### 5.2 논문 트랙 — 1층 결정적 스코어러 v2 (축 6 → 4)

```
게이트/감점
  rel01 <= 0                        → -5.0
  editorial/comment/letter/news     → -3.0
  retraction / erratum              → -3.0
  case reports                      → -1.5
  전임상(동물/시험관)                → -2.0
  pediatric                         → -2.0
  nonacute_method                   → -3.0   (actionability 음의 흡수로 확장)

rawScore = journalWeight × journal(-1.0 … 4.0)   // exact, 간호지 low      [확정 ②]
         + relevanceWeight × (rel01 × 4.0)       // 탈포화 + 검색MeSH 누출 제거
         + designPart(0 … 2.0)                   // DESIGN_SCALE 0.5       [확정 ①]
         + penalties + gate

삭제: 최신성 축, 표본 축
tie-break: ArticleDate DESC
```

**저널 축** — 티어 점수 그대로(`top 4.0 / flagship 3.2 / specialty 2.0 / default 0.8 / low -1.0`).
`_journalScore`(`MetadataScorer.js:142-157`)를 **exact 우선**으로. `includes`는 low 티어에만:
```json
"low": { "score": -1.0,
  "exact": ["medicine", "cureus"],
  "includes": ["scientific reports","bmc ","plos one","frontiers in","heliyon",
               "world journal of","mdpi","int j environ res public health",
               "nursing","nurs ","critical care nursing","dccn"] }
```
CI에 **config lint** 추가: top/flagship/specialty 티어에 `includes` 키가 있으면 실패.

**주제 축**(`_relevance`, `:243-266`):
```
titleHits 체감가중: [0.50, 0.25, 0.15, 0.10]   // 4히트 = 1.00 (심판 §4-2)
metaHits: queryMeshExclusions 제외 후 0.08 × min(metaHits, 3)
signal  = min(1, 합)
rel01   = clamp(best + 0.15 × second, 0, 1)
```
동일 term 중복 계수 금지. `cardiac_resus.terms`의 맨몸 `"cardiac"`(`interests.json:14`) 제거.

**설계 축**:
```js
// interests.json.scoring — 폰 튜닝
designScale: 0.5,
reviewFlagshipTiers: ["최상위 종합지"],   // 확정 ①: top_general 만
reviewScoreFlagship: 3.2,
reviewScoreOther: 0.7

if (design.label === 'Review')
  design.score = reviewFlagshipTiers.includes(jr.tier) ? reviewScoreFlagship : reviewScoreOther;
designPart = Math.min(2.0, design.score * designScale);
```
결과: RCT/메타 **2.00** · top_general 서술리뷰 **1.60** · 그 외 서술리뷰 **0.35** · 관찰연구 1.15.
검증: `specialty(2.0) RCT(2.0) = 4.00` > `flagship(3.2) 비-top 서술리뷰(0.35) = 3.55` — F4 해소.
보조 축 합 = 2.0 < 3.0으로 **문서화된 "보조 ~3" 불변식도 조인다**.

### 5.3 논문 트랙 — 후보 20 구성

`_selectTopPapers`(`FilterAnalyzerAgent.js:259-277`)의 `.slice(0, limit)` 교체:
```
1. rawScore 내림차순 순회
2. primaryTopic(= rel.groups[0]) 누적이 candidateTopicCap(5)이면 보류
3. 20편 채울 때까지
4. 미달이면 cap 6, 7 … 완화 + lowConfidence = true
5. streamSource === 'B' 가 0편이면, 풀 최하위 점수 이상인 B 논문 최대 2편을 최하위와 교체
```

### 5.4 논문 트랙 — 2층 LLM 재순위 (F1)

```js
// FilterAnalyzerAgent.js:40
const parsed = Number(process.env.RERANK_POOL);
this.rerankPool = options.rerankPool
  ?? (Number.isInteger(parsed) && parsed > 0 ? parsed : 20);
```
```yaml
# daily-review.yml:85
RERANK_POOL: ${{ vars.RERANK_POOL || '20' }}
```
- 로그: `rerank_requested` / `rerank_pool_size` / `rerank_llm_called` / `rerank_applied` /
  `fallback_reason`. `(LLM reranked)` 문구는 `rerank_applied === true`에서만(`:495`).
- LLM 응답이 풀의 PMID를 전부 포함하지 않으면 재순위 **전체 무효** → 결정적 순위 + `lowConfidence`.
- 회귀 테스트 2개: `RERANK_POOL=''` → `poolSize === 20` / `pool.length > n` → LLM 경로 진입.

**선정 증거 영속화** (`selected_papers.json`):
```json
{ "selectionMode":"llm_reranked", "rerankPoolSize":20, "rerankApplied":true,
  "lowConfidence":false, "scoreVersion":"paper-v2",
  "deterministicRank":7, "streamSource":"B", "primaryTopic":"resp_airway" }
```
F1이 4주간 은폐된 직접 원인은 버그가 아니라 **로그가 실행 증거가 아닌 플래그를 찍은 것**이다.
로그는 90일이면 사라지지만 이 파일은 영속하므로 사후 분석의 유일한 기반이다.

**약한 날 표기**: `lowConfidence = (rerankApplied !== true) || (eligiblePoolSize < 10)`.
미발동 시 아무것도 안 보인다(REPORT_SPEC §2 "핵심만"). 발동 시 대시보드 + 텔레그램 1줄.
※ 텔레그램 표기는 **§2 개정 + spec-lint 허용 패턴 갱신이 선행**돼야 한다(안 하면 CI가 막는다).

### 5.5 가이드라인 트랙

**`config/guideline-orgs.json`** (신규, 폰 튜닝):
```json
{ "tier1": { "score": 4.0, "match": ["surviving sepsis","idsa","american heart","acc/",
             "european society of cardiology","esc ","ats/","ers/","kdigo","nice",
             "who ","american thoracic","ilcor"] },
  "tier2": { "score": 2.5, "match": ["esicm","sccm","neurocritical","ncs/","dgni",
             "scandinavian","canadian","esa","easl"] },
  "default": { "score": 1.0 } }
```

**`GuidelineScorer`** (신규 — 축 집합이 논문과 다르다):
```
priority = wOrg   × orgAuthority(0 … 4)    // 제목+저널+org 결정적 매칭 (저널명 아님)
         + wTopic × topicRel(0 … 4)        // _relevance 공유 모듈, 탈포화 적용
         + wRec   × recencyBucket(0 … 2)   // 캐치업 = 현행성 → 신판 우선 (논문과 반대)
         + scopeAdj                        // pediatric -2.0 등
기본: wOrg 1.0, wTopic 1.0, wRec 1.0.  저널·표본·설계 축 없음.

주제 게이트:
  topicRel > 0                    → queued
  topicRel = 0 AND org tier1      → needsReview (보존, 자동발행 금지)
  topicRel = 0 AND tier2/default  → 제외
```
`needsReview`는 `guidelines.html`에 "검토 대기 N건" 접이식으로 렌더 — **보이지 않으면 썩는다.**
승격 경로는 이미 있는 on-demand 위젯을 쓴다(새 UI 불필요).

**상태: `output/selected_guidelines.json` v2** — 파일명 유지(퍼블리셔 목록 무수정):
```json
{ "version": 2, "updatedAt": "…",
  "config": { "drainEveryDays": { "deep": 2, "mid": 3, "shallow": 7 },
              "drainThresholds": { "deep": 30, "mid": 10 },
              "minPriority": null, "newReleaseBoost": 3.0, "backfillYears": 3,
              "configVersion": "guideline-v1" },
  "queue":     [ { "id":"pmid:41236566", "pmid":"…", "sourceId":"", "sourceUrl":null,
                   "title":"…", "org":"ESICM", "lineageKey":"esicm|circulatory-shock",
                   "year":2025, "pubDate":"2026-07-23", "priority":8.7,
                   "status":"queued|needsReview|superseded",
                   "priorityVersion":"guideline-v1", "addedAt":"…" } ],
  "published": [ /* 기존 6건 무손실 이월, 재채점 없음 */ ] }
```
로더 시임(`Orchestrator.js:76-81`): 최상위가 배열이면 `{version:2, config:기본, queue:[], published:배열}`로 승격(3줄).

**소진 루프**(`_stageGuideline` 개편, **non-fatal 유지**):
```
1. 큐 깊이로 drainEveryDays 결정 → 경과일 미달이면 skip
     queuedEligible >= 30 → 2일 / 10~29 → 3일 / 1~9 → 7일 / 0 → 발행 없음
     LLM 호출 상한: 하루 1건 (불변)
2. 신규 감지 collectGuidelines({days:21}) → 미등록분 +newReleaseBoost 후 삽입
3. supersede 스윕: queue + published[] **양쪽** 스캔
     같은 lineageKey 신판 → queue 항목 status=superseded
                          published 항목 supersededBy 세팅 (카드에 소급 배지)
4. head = queued 최상위. 없거나 head.priority < minPriority
     → (나) 폴백: 순수 신규만 재확인, 없으면 빈 날
   아니면 발행 → analyze() → guidelines.html 전량 재생성 → status=published
5. configVersion 변경/백필 시 queued·needsReview 만 전량 재채점(이력은 재채점 금지)
```

**lineageKey**(결정적 3단, LLM 불개입):
1. 제목 정규화(연도·`update`·`focused update`·`guidelines for the management of` 제거) + org
2. 제목 내 최대 연도 토큰 → 같은 패밀리 신판 존재 시 구판 stale
3. **경과 가드**: 동일 패밀리 신판이 없으면 3년 초과라도 자동 삭제 금지 →
   `발행 N년 경과 — 최신판 확인` 배지만 (가이드 수명 5~10년)
4. 발행 시점 LLM 웹검색은 **주석 전용**(`GuidelineAnalyzerAgent.js:126`이 이미 "What's New" 검색).
   선정 결정은 결정층에서 끝났으므로 재현성 불변.

**백필**: `scripts/guideline-backfill.mjs`, `workflow_dispatch` 전용(코어 밖 — 레이트리밋 격리).
`collectGuidelines`를 분기별로 나눠 호출(현행 `max=40` 단일 esearch는 3년치를 못 담는다).

**렌더**: `guidelines.html`을 상태 파일에서 **전량 재생성**. `_buildGuidelineCard`(`:178`) 재사용.
`publish()`(`:710-760`)의 가이드 분기를 `publishGuidelines()`로 이주. `index.html`엔 링크 카드 +
"검토 대기 N건".

> **참고자료 모드(`kind=reference`, 2026-08-06 구현됨)도 이 페이지 분리에 얹혀 간다.**
> 카드 빌더를 공유하므로 `guidelines.html` 이주 시 함께 옮긴다(REPORT_SPEC §1-B).

### 5.6 폰에서 튜닝하는 config 키

| 파일 | 키 | 무엇을 바꾸나 |
|---|---|---|
| `config/collection.json` | `streamA.retmax`·`days` | 신착 스트림 크기·창 |
| | `streamB.slices`·`retmaxPerSlice`·`days` | 캐치업 깊이·분포 |
| | `candidateTopicCap` | 한 주제가 후보 20을 몇 편까지 |
| | `streamBReserved` | 저명저널 예약석 |
| `config/interests.json` | `topicGroups[*].weight` | **주제 선호의 유일한 정본** |
| | `scoring.designScale` | 설계 축 증폭 |
| | `scoring.reviewScoreFlagship/Other`·`reviewFlagshipTiers` | 확정 ① 리뷰 예외 |
| | `deprioritize.groups.*.penalty` | 소아·비급성 감점 |
| `config/journals.json` | 티어 `score` | 저널 축 크기 |
| | 티어 `exact` | 스코어링 매칭 |
| | 티어 `pubmedTa` | B 스트림 검색 |
| `config/guideline-orgs.json` | tier1/tier2 `match`·`score` | 학회 권위 |
| `output/selected_guidelines.json` | `config.drainEveryDays`·`minPriority` | 가이드 카덴스·하한 |
| GitHub Variables | `RERANK_POOL`·`ENABLE_RERANK` | 재순위 풀 |

**설계 불변식(신설)**: 수집 파라미터에 **주제별 할당량을 두지 않는다.** 주제 선호는
`interests.json`의 `weight` 한 곳에만 산다. (Fable N2 — 향후 "sepsis만 줄이자" 요구가 올 때
lane 재도입을 막는 방벽.)

---

## 6. 구현 순서

### P0 — 당일 효과 + 되돌리기 쉬움 (커밋 3개, 각각 독립 revert 가능)

| # | 항목 | 변경 | 검증 | 규모 | 코어 영향 |
|---|---|---|---|---|---|
| P0-1 | F1 재순위 복구 + 정직 로그 + 회귀 2건 | `FilterAnalyzerAgent.js`, `daily-review.yml`, `test/rerankPool.test.mjs` | test:unit 통과 → 다음 데일리 로그에 `rerank_applied=true`·`pool=20` | ~40줄 | **없음** — 재순위는 소프트 폴백(`:313-316`). LLM +1회/일 |
| P0-2 | 쿼리 교정(sepsis 독립항 제거 + MeSH 확장) | `DataCollectorAgent.js:21-22`, `config/collection.json` 최소본 | `selection-experiment`(EXP_LLM=0, 프로덕션 무영향) → sepsis <15%, 총 250~300편 | ~10줄 | 풀 성격이 하루아침에 바뀐다. **P0-1이 먼저 들어가야 안전망 작동** |
| P0-3 | 저널 exact + 간호지 low + 표본 축 삭제 | `journals.json`, `MetadataScorer.js`, 테스트 | 케이스: 간호지→-1.0 / `Current opinion in critical care`→0.8 / `J Am Coll Clin Pharm`→0.8 / `Critical Care Medicine`→3.2 | ~70줄(대부분 config) | exact 누락 저널은 default 강등(fail-closed, 의도) |

> **P0-1을 먼저 단독 배포하고 1일 관찰**한 뒤 P0-2·P0-3을 함께. 동시 변경 시 귀인 불능.

### P1 — 구조 개편 (상한 자체를 올린다)

| # | 항목 | 규모 | 검증 |
|---|---|---|---|
| P1-1 | B 스트림 월 6분할 + A/B 합성 300 cap + `pubmedTa` | ~130줄 | 슬라이스별 ≥10편, B 총 ≥60편, 최고령 ≥150일 |
| P1-2 | 주제 축 탈포화 + 검색MeSH 누출 제거 | ~50줄 | `rel01=1.00` 비율 40% → **<10%**, 주제 상한 4.0 도달 가능 |
| P1-3 | 설계 축 증폭 + 리뷰 티어조건부 | ~25줄 | 후보 20의 Review 6편 → **≤2편**, RCT+메타 **≥4편** |
| P1-4 | 후보 20(cap 5 + B 예약 2) + `lowConfidence` 영속 | ~70줄 | 단일 주제 ≤5, B ≥2, 증거 필드 기록 |
| P1-5 | 날짜 소스 우선순위 + tie-break | ~30줄 | `pubDateSource` 분포, "1년+" 오판 소멸 |
| P1-6 | 리플레이 하네스 `npm run rank-replay` | ~150줄 | 폰에서 보는 HTML 1장 (구 픽 vs 신 픽) |

### P2 — 가이드라인 트랙 (~780줄, 별도 프로젝트 규모)

P2-1 `GuidelineScorer` + `guideline-orgs.json` + `_relevance` 공유 모듈 추출(~180줄) ·
P2-2 상태 v2 + 드레인 루프 + needsReview(~170줄, **try/catch 유지 필수**) ·
P2-3 `guidelines.html` 전량 재생성 + publisher 분리(~220줄, **/preview 승인**) ·
P2-4 백필 스크립트(~130줄, 코어 밖) · P2-5 supersede 스윕(queue + published 소급, ~80줄,
**폐기판 노출 0 = CI 실패 조건**).

---

## 7. 측정으로만 결판날 것

| # | 무엇을 재는가 | 어떻게 | 판정 기준 |
|---|---|---|---|
| 7-1 | B 쿼리 실행 가능성(불리언 연산자 한도) | P1-1 중 esearch dry-run (판정 중 24연산자 쿼리 거부 실측됨) | 거부 시 chunk 10→8, 슬라이스 6→3(60일). 슬라이스당 ≥10편이면 통과 |
| 7-2 | 재순위 풀 10/15/20 | `rank-replay`로 동일 풀 재생 | 20 대비 15의 최종 픽 일치율 ≥95%면 15(429 여유). 아니면 20 |
| 7-3 | 가이드 백필 2년 vs 3년 | P2-4 dry-run(발행 없음) | 3년 추가분 중 `current` 비율 <30%면 2년 |
| 7-4 | 가이드 `minPriority` | 백필 큐 20건 폰 육안 | PeterJ가 "안 봐도 됨"이라 한 최고점을 하한으로 |
| 7-5 | 저널 티어 간격 재보정 | P0-3 후 2주 + `rank-replay` | 저널 축 평균 기여율 >50%면 `journalWeight` 0.9→0.8 (숫자 1개) |
| 7-6 | 결정층 actionability 필요 여부 | F1 복구 후 30일 리플레이 | LLM 1등이 결정적 5위 밖에서 나오는 날 ≥30% → 재순위가 일하고 있음, 축 영구 불필요 |

> **F2가 살아 있는 동안 flagship 3.2는 오매칭 7종에 뿌려지고 있었다**(라이브 상위 20 중 11편).
> exact 전환 후 저널 축의 실제 분포는 아무도 모른다. **오염된 분포를 근거로 스케일을 고치는 것은
> 잘못된 관측에 대한 처방**이므로 7-5는 P0-3 이후로 미룬다.

---

## 8. PeterJ 확인 대기 (권고 기본값 있음 — "그대로 가"면 진행)

§9 참조 — 채팅으로 별도 제시.

## 9. 승인 게이트

PeterJ가 이 스펙을 확정하기 전에는 **구현 착수 금지**. 현재 프로덕션 코드·config 무변경.
확정 시 draft 표기를 떼고 P0-1부터 착수한다.
