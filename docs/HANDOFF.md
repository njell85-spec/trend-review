# HANDOFF — 세션 인수인계 노트

> 목적: 새 세션(어느 모델이든)이 이 파일 하나로 지금까지의 맥락·결정·상태·다음 할 일을
> 복원해 이어가기 위함. **새 세션을 열면 이 파일부터 읽고, 아래 "먼저 읽을 파일"을 훑으세요.**
>
> **[2026-08-13(2) — ★ 수집 풀 실측: "최신 구간이 마른 것은 색인 지연이다" · A·C·D 원인 규명 · 저널 2건 수정]**
> - **성격**: 이 세션은 **가설을 숫자로 갈아치운 날**이다. 핸드오프가 다음 세션에 넘긴
>   전제 두 개가 실측에 뒤집혔고, 재생 실험이 못 주던 답이 나왔다.
>
> **■ 먼저 — 앞 블록에서 낡은 것 3개 (그대로 믿지 마라)**
> - **"`main` 무변경"은 낡았다.** PR #82·#83 이 머지돼 재생 하네스는 `main` 에 있다.
> - **"스트림 B가 `DataCollectorAgent` 본체에 없다"는 틀렸다.** `collectDualStreams`·
>   `composeDualStreams` 둘 다 본체에 있다. 맞는 건 **데일리가 `collectionMode:'single'`
>   기본이라 안 탄다**는 것뿐이다.
> - **8/13 데일리 `31645751643` 은 failure 지만** 실패 잡은 `verify-pages` 하나이고 본
>   리뷰 잡은 성공했다. PR #81 이 그 뒤 머지돼 원인은 고쳐졌다 — **아직 데일리로 검증
>   안 됐다**(다음 데일리가 첫 검증). 그 잡이 또 빨간색이면 이걸 먼저 본다.
>
> **■ ★★ 실측 ⑤ — 최신 구간이 마른 것은 재고 부족이 아니라 색인 지연이다**
> 러너 `31716438262`(esearch 102회 · `EXP_MODE=census`):
> ```
> | 구간        | MeSH쿼리총 | TIAB총(색인무관) | top+flag 저널단독 | 저널∧설계 | 엄격풀 |
> | S0 0~30일   |   659   |  3797  |  1792  |  41  |  4  |
> | S2 60~90일  |  1103   |  3732  |  1906  | 119  | 23  |
> | S4 120~150일|  1295   |  3594  |  1885  | 132  | 18  |
> ```
> **TIAB(제목·초록 텍스트)도 저널 단독도 구간마다 평평하다** — 최신 구간에도 논문은 그대로
> 있다. 그런데 **MeSH 쿼리 총만 51%로, publication type 은 31%로 꺼지고**, 둘이 곱해져
> 엄격 풀이 17%(S0 4편)가 된다.
> → **현행 MeSH 전용 쿼리로는 "오늘 나온 대작"을 원리적으로 못 본다.** 오늘 나온 NEJM RCT 는
>   MeSH 도 PT 도 아직 안 붙었다. **최신 구간 가중을 아무리 올려도 없는 것은 못 뽑는다** —
>   쟁점 ⓑ 는 가중치 문제가 아니라 **쿼리 축 문제**였다.
> → 설계 필터(쟁점 ⓐ)는 전 구간에서 **8~10% 만 남기고** 관찰 43~50%·진단 7~9%·가이드라인을
>   통째로 버린다.
> → 구간 균등 표집의 상한은 가장 마른 구간이 정하는데 그게 S0=4 다. 6구간×4 = **180일에 24편**
>   으로 30일치 데일리를 못 채운다(엄격 풀 기준).
>
> **■ ★ 재생 A·C·D 동일 문제 — 배선이 아니라 "효과가 하위권에서만 난다"**
> 러너 `31716446549`(2026-07-16~08-14 · 무LLM · `armDivergence` 신설):
> ```
> | arm | 선정/30일 | 점수 달랐던 날 | 후보수 달랐던 날 | 선정 달랐던 날 | 최대 rawScore 차 |
> |  B  |    30    |      0       |       30       |      29      |    0    |
> |  C  |    17    |     12       |        0       |       0      |  5.32   |
> |  D  |    17    |     17       |        0       |       0      |  10.8   |
> ```
> **배선은 살아 있다.** C 는 12일치를 최대 5.32점, D 는 17일치를 최대 10.8점 흔들었다.
> 그런데 **top-1 이 한 번도 안 바뀌었다** — 변동이 전부 하위권에서만 일어난다.
> D 는 이미 바닥인 배제 저널 점수를 올리는 것뿐이고(`excludeGate -10` 이 빠지는 차이),
> C 는 원래 상위권이 아닌 논문을 `topicGate -5.0` 로 더 떨어뜨릴 뿐이다.
> **`test/selectionReplay.test.mjs` h) 가 D≡A 를 구조로 증명한다** — D 의 soft∪hard 패턴
> 집합이 A 의 배제 집합과 동일하고, soft 복원은 allow 가 0 일 때만 걸린다.
> **A·C·D 는 30일 중 13일이 빈손이다(17/30). B 만 30/30 을 채운다.**
>
> **■ 만든 것**
> - **`EXP_MODE=census` 수집 풀 실측** (`scripts/pool-census.mjs`) — esearch `retmax=0` 의
>   count 만 읽어 ①구간별 편수(edat·pdat) ②설계 유형 ③저널 티어 ④엄격 풀+도착률
>   ⑤색인 지연 프로브를 잰다. **기존 `selection-experiment.yml` 의 `mode` 입력에 붙였다** —
>   워크플로 신설 없이 작업 브랜치에서 바로 돌리기 위함(workflow_dispatch 는 파일이
>   `main` 에 있어야 하는데 census 워크플로는 없다).
> - **`armDivergence()`** (`src/experiments/selectionReplay.js`) — arm 발산을 ⓐ배선/ⓑ효과
>   크기로 가르는 표. 재생 요약 맨 아래에 자동으로 붙는다.
> - **`Shock (Augusta, Ga.)` 2.0 복구** — PubMed 괄호 접미사(`(Augusta, Ga.)` ·
>   `(London, England)`)를 떼고 한 번 더 exact 를 맞춘다. `Medicine (Baltimore)` 는
>   여전히 low(-1.0) 로 남는다.
> - **교육·QI 계열 배제** — `education` 통패턴 + health professions·academic medicine·
>   simulation·quality improvement/healthcare quality/medical quality/quality & safety/
>   patient safety. config 와 **코드 내장 바닥 양쪽**에 넣었다(journals.json 이 깨져도 안 꺼진다).
>   **오탐 검증: 정상 임상지 47종 통과**(academic emergency medicine ·
>   Circulation. Cardiovascular quality and outcomes 같은 인접 이름 포함).
> - `test:unit` 237 → **242 pass** · spec-lint 통과 · 발행 표현 계층 무변경(/preview 불필요).
>
> **■ 러너에서만 되는 것 (이 세션 환경 제약 — 다음 세션도 같다)**
> - **프록시가 eutils 를 막는다**(HTTP 000). PubMed 실측은 전부 러너로 보내야 한다.
> - **아티팩트 CDN(`blob.core.windows.net`)·Actions 로그 zip 도 막힌다.** 결과를 되읽는
>   길은 **`get_job_logs` 하나뿐**이므로, 러너 스크립트는 **읽을 것을 로그 끝에 찍어야 한다**
>   (tail 로만 잘라 볼 수 있다).
>
> **■ ★★ 설계토론이 실버그를 먼저 잡았다 — `pubmedTa` 결손 41종**
> Claude측(Fable) R0 가 리스크로 "`pubmedTa` 에 `Lancet Respir Med` 가 없다"를 들었고,
> 확인해 보니 **지적보다 심각했다.**
> ```
> 티어        exact   pubmedTa(수정 전)
> top_general   10        5
> flagship      30       14
> specialty     29        9
> ```
> **`pubmedTa` 는 `exact` 와 별개 용도다** — PubMed `[Journal]` 검색어(MEDLINE 약어)이고
> **수집 쿼리(streamB)는 이것만 본다.** `Lancet Respir Med`·`JACC`·`Ann Intensive Care`·
> `Eur Respir J`·`Thorax`·`Br J Anaesth`·`Clin Infect Dis`·`Crit Care Explor` 등이
> **수집에서 통째로 빠지고 있었다.** 41종 보충(28→52종).
> **저널을 추가할 때 두 목록을 같이 채워야 한다** — `journals.json` 주석에 박아 뒀다.
> - **이것이 내 오늘 실측도 오염시켰다.** ③④ 티어·엄격풀은 과소계상이었고 재실측했다:
>   **엄격 풀 상한 4 → 6편/구간**(180일 24 → 36편). 결론은 불변(하루 1편을 못 버틴다).
>   **⑤ 색인 지연 결론은 정정 후 더 강해졌다** — 저널 단독은 평평(S0 2104 vs S4 2228)한데
>   `저널∧설계`는 S0 44 vs S4 175 = **25%** 로 더 벌어진다.
> - **약어가 틀리면 에러가 아니라 조용히 0건이 된다.** census ⑥ 에 180일 건수 검증을 넣었고
>   **도입 즉시 하나 더 잡았다** — `J Trauma`(2012년 `J Trauma Acute Care Surg` 로 개명) 0건.
>   제거했다. 나머지 51종은 살아 있다.
>
>
> **■ ★★ 설계토론 결론 — 스펙 draft 로 저장했다 (PeterJ 확정 전 · 구현 착수 금지)**
> **`docs/superpowers/specs/2026-08-13-collection-pool-criteria-design.md`**
> 실측을 먼저 붙였더니 **양측 전제와 내 전제가 모두 반증됐다.** 심판이 뒤집은 것:
> - **(A0) "`edat` 으로 하자" → 데일리는 이미 `pdat` 이다**(`:145`). 개선이 아니라 회귀 제안.
> - **(B1) "S0 저널∧설계의 91%가 MeSH 밖 = 지연" → 성숙 구간도 86~89%가 밖이다.**
>   지연 성분은 약 4%p·구간당 1~3편 — **약 20배 부풀려졌다.**
> - **(양측) "도착률 0.13~0.29/일이라 구조적 적자" → 순환논증.** 지연에 눌린 S0 창에서 잰
>   값을 공급량 증거로 썼다. **성숙 구간은 0.63~0.77/일** — 결론(ⓐ)은 살지만 적자 폭은
>   "5배"가 아니라 "간당간당"이다.
> - **(양측) 전이 길이 38~42일 / 최소 136일~ → 둘 다 모집단이 틀렸다**(거부하기로 한 설계
>   필터 풀에서 계산). 대리 모집단 89편+α ÷ 0.23~0.37/일 = **240~387일**.
> - **★ "B만 30/30" 은 증거에서 내려야 한다.** legacy 코퍼스가 `retmax 300·sort=date` 1회
>   조회라 최신 며칠치에 몰려 있고 `candidatesAsOf` 가 `edat <= day` 로 걸러 **재생 초반에는
>   legacy 후보가 구조적으로 0**이다(`selectionReplay.js:91-94`). B 의 우월성이 아니라
>   **B 코퍼스가 창을 덮었다는 사실**을 잰 것에 가깝다. 프로덕션은 매일 300편을 새로 받으므로
>   후보 0 이 원리적으로 안 난다. (완전 확정은 일자별 `candidateCount` 필요 — 부분 확정)
>
> **■ ★ 내가 코드로 확인한 것 — 날짜축이 경로마다 어긋나 있다 (토론 양측 다 놓쳤다)**
> - 데일리(single): `datetype: 'pdat'` (`:145`) · **이중 스트림 A·B: 기본값 `'edat'`**
>   (`:148` 기본값 · `:182`·`:196` 이 datetype 미전달)
> - 파서의 `paper.pubDate` 는 `History/PubMedPubDate[pubmed]` **우선이라 사실상 EDAT**(`:377-393`)
>   이고 `paper.edat = pubDate` 로 같은 값이 복사된다(`:338`).
> → **쿼리는 pdat, 객체는 edat.** `dateField:"pdat"` 한 줄로는 구간 귀속이 안 되고
>   **파서 변경이 필요하다.**
>
> **■ ★ 다음 세션 첫 스텝 — 되돌리기 쉬운 것부터 (스펙 §4)**
> ① **census 에 P1~P6 쿼리 추가**(약 30~40회 esearch · `retmax=0`).
>    **축 J 존폐(P2: `(51종[Journal]) NOT (MeSH OR tw)`)와 예약비를 이것 없이는 못 정한다.**
> ② 저널 약어 생존성 감사를 정기 워크플로로 고정 ③ 파서에 `pdat`/`edat` 병기 필드 추가
>    (기존 `pubDate` 의미 불변 — 리포트 표시 계층 보호)
> ④ 재생 코퍼스를 180일 전수로 재구축 → E-arm 재생 ⑤ esummary 사전순위를 실험 경로에 먼저
> **컷오버 게이트 = E-arm 30/30 채움 + J축 단독 기여 > 0 + P2 확보.**
> **가장 되돌리기 어려운 것은 발행 이력이다** — 컷오버 첫날부터 `windowRamp` 를 걸고 시작한다.
>
> **[2026-08-13 — 30일 재생 실험 하네스 개방 + P0-3 저널 exact + 분업모드 실측 · main 무변경]**
> - **성격**: 선정 개편을 "눈감고 머지"에서 **"재생 실험으로 판정하고 머지"**로 바꾼 날.
>   **`main`은 하루 종일 한 줄도 안 바뀌었다** — 전부 작업 브랜치
>   `claude/handoff-conversation-archive-yl30sw`에 있다. 데일리 코어 무영향.
>
> **■ ★★ 다음 세션 첫 스텝 — 수집 풀 기준부터 확정한다 (PeterJ 확정 2026-08-13)**
> **가중치보다 풀이 위다.** 오늘 실험이 그 증거다 — 가중치만 다른 A·C·D는 결과가
> **한 글자도 안 달랐고**, **풀이 다른 B만** 갈렸다. 풀을 안 정하고 가중치를 논하면 헛돈다.
>
> **PeterJ가 제기한 구조 문제**(정확한 지적이다):
> - 지금은 문턱이 다른 두 표집이 한 표에서 겨룬다 — 스트림 A(문턱 낮음·최근 2주 몰림)와
>   스트림 B(RCT·메타·SR + 저명지·6개월 균등). **스코어러는 출처 스트림을 모르므로**
>   3일 된 평범한 관찰연구가 5개월 된 NEJM RCT와 같은 표에서 겨룬다.
>   **점수 차이가 품질 차이인지 표집 차이인지 구분이 안 된다.**
> - **180일 컷오프가 이미 최신성을 보장하는데** 스트림 A가 최신성을 한 번 더 밀어준다 —
>   이중 계상이다. EM/CCM 에서 4개월 된 RCT 는 낡은 것이 아니다.
> - **PeterJ 대안**: 갈래를 나누지 말고 **180일 전체를 같은 품질 문턱으로 구간 균등 표집**.
>   최신성은 ①180일 컷오프 ②동점 분리 두 군데서만 작동.
>
> **결정 방법 = 클코덱스 설계토론(Fable 5 vs GPT-5.6 Sol + 중립 심판), 단 실측을 먼저 붙인다.**
> 이 질문은 숫자 없이 못 정한다. 추측으로 붙이면 **지난번처럼 양측 전제가 심판에게
> 반증당한다**(2026-08-06 선례 — 심판이 PubMed 라이브 실측 7건으로 양측을 다 뒤집었다).
> **이 세션은 프록시가 eutils 를 403 으로 막아 실측을 못 했다. 러너는 열려 있다.**
>
> **먼저 재야 할 숫자 (러너에서)**:
> 1. 현행 쿼리로 **180일을 30일씩 6구간 나눌 때 구간별 총 편수**(esearch `retmax=0` 의 count
>    만 읽으면 싸다). "구간 균등"이 성립하는지, 구간마다 몇 편을 배정할 수 있는지가 여기서 갈린다.
> 2. 각 구간의 **설계 유형 분포**(RCT·메타분석·체계적고찰 vs 관찰·진단·기타 비율).
>    → 단일 문턱을 **설계 필터로 둘지** 정하는 근거다. 필터를 전체에 걸면
>    **관찰연구·진단연구·가이드라인이 통째로 빠진다**(지금은 스트림 A 가 받아주고 있었다).
> 3. 각 구간의 **저널 티어 분포**(top/flagship/specialty/default/low).
> 4. **최신 구간에 할당을 얼마 주면 "오늘 나온 대작"을 안 놓치는가** — 이건 별도 스트림이
>    아니라 **파라미터 하나**로 풀린다(구조를 안 깬다).
>
> **토론에 넘길 쟁점 3개**: ⓐ 단일 문턱을 설계 필터로 둘 것인가 ⓑ 최신 구간 가중을 얼마로
> 할 것인가 ⓒ 초반 1~2주가 "밀린 대작 소화"로 보이는 것을 받아들일 것인가
> (PeterJ 확정 ④ "놓친 대작부터 소진"과 같은 방향이긴 하다).
>
> **■ ★ 다음 세션이 두 번째로 할 것 — 재생 실험이 아직 답을 못 준다**
> 러너 실행 `31712702785`(7/14~8/12 · A/B/C/D · 무LLM · 42초 · success) 결과:
> ```
> | arm | 선정 | 배제 | soft복원 |   A·C·D 는 30일 내내 완전히 같은 논문을 골랐다
> |  A  | 15  | 291 |    0    |   → C(검색어 누출 제거)·D(배제 3층화)가 효과 0
> |  B  | 30  | 116 |    0    |   → B(이중 스트림)만 다르다
> |  C  | 15  | 291 |    0    |
> |  D  | 15  | 291 |    0    |
> ```
> **갈라야 할 것**: ⓐ arm 주입이 실제로 스코어러까지 닿는가(픽스처 스모크에서는 갈렸는데
> 실데이터에서는 안 갈린다 — 배선 의심) ⓑ 아니면 효과가 top-1을 못 뒤집을 만큼 작은가.
> **D의 `soft 복원 0`이 단서다** — soft 층이 한 번도 발동하지 않았으니 D≡A는 당연하다.
> 현행 폴백은 `kept.length >= topN`이고 `topN=1`이라 **후보가 전멸할 때만** 걸린다.
>
> **■ ★ 그래도 큰 것 하나는 증명됐다 — PeterJ 문제 1("실효 2주")의 실물**
> A·C·D는 **7/14~7/28 15일 동안 아무것도 못 골랐다**(후보 없음). **B만 30일을 다 채웠다.**
> `searchDays=180`인데 `maxPapers=300`·`sort=date`라 과거로 가면 후보가 0이 되는 것이
> 재생에서 그대로 드러났다. **이중 스트림(B)이 이 문제의 답이라는 근거가 생겼다.**
>
> **■ 만든 것 (작업 브랜치)**
> - **30일 재생 하네스 개방** — `EXP_ARM=A,B,C,D`로 같은 코퍼스 스냅샷 위에서 비교.
>   `src/experiments/selectionReplay.js`(순수 로직) + `experiments/arms.json`(arm 정의 데이터) +
>   `scripts/selection-experiment.mjs`에 `EXP_MODE=replay` 갈래 + 워크플로 입력 5종.
>   스코어러 상수 8종을 주입 가능하게 열되 **기본값 불변**, `config/*.json` **무수정**,
>   `collectionMode` 기본 `'single'`이라 **데일리 경로 종전 그대로**.
>   `test:unit` 229 → **237 pass** · spec-lint 통과 · `output/` 상태파일 무변경 확인.
> - **P0-3 저널 exact 전환** — 실측: `Clinics in chest medicine` 3.2→**0.8**
>   (**8/13 데일리 픽이 이 저널이었다**) · `Current opinion in critical care` 3.2→**0.8**.
>   간호지 배제(-1.0)·NEJM 4.0 불변. **미해결**: `Shock (Augusta, Ga.)`가 2.0→0.8로
>   의도치 않게 강등됐다(접미사 때문에 exact에서 빠졌다).
> - **P0-2 쿼리 교정 1단계** — `"sepsis"[MeSH]` 독립항 제거 + MeSH 6항 확장(PeterJ 확정).
>   **★ 미완**: 스펙 §5.1의 스트림 B·합성·`oldest/newestPubDate`·날짜 3단 우선순위가
>   `DataCollectorAgent` 본체에는 아직 없다. `config/collection.json`은 하네스가 읽지만
>   **데일리 경로는 여전히 단일 스트림**이다.
>
> **■ ★ 실측으로 뒤집은 것 — 다음 세션이 그대로 믿으면 안 되는 두 가지**
> - **간호·재활지 배제는 이미 작동한다**(2026-08-10 도입). 하청 설계가 "배제 미작동"으로
>   오진했는데 직접 돌려보니 간호 4종·재활·영양 **전부 -1.0으로 잡힌다.**
>   `analysis_archive.json`의 간호지 **6/37편(16%)**은 전부 **수정 이전**(07-09~08-10) 선정분이다.
>   **잔존 구멍은 교육·QI 계열 하나**(`Journal of continuing education in the health professions` → 0.8 통과).
> - **★ 새 발견: 검색어 누출.** 수집 쿼리가 쓰는 MeSH가 **주제 점수에도 가산된다** —
>   `resuscitation`→`cardiac_resus`(weight 1.0) · `emergency medicine`·`intensive care unit`
>   →`general_em_ccm` · `fluid resuscitation`→`sepsis_shock`. 수집 조건이 주제 적합의
>   증거로 재사용되는 **동어반복**이다. 이것이 C안의 근거다.
>
> **■ PeterJ 확정 (2026-08-13)**
> - **수집 쿼리에서 sepsis 독립항을 뺀다** — "관심 주제들이 비슷한 가중치를 가져야 한다".
>   실측 정정: 그룹 `weight`는 **이미 전부 1.0으로 같다.** 실제 불균형은 **용어사전 크기**
>   (외상 11 vs 심혈관 32)와 **유사어 중복**에서 온다 — 같은 RCT라도 주제 점수가
>   **2.00~3.00으로 벌어진다**(`sepsis`와 `septic`이 별개 히트로 세어진다).
>   **고칠 자리는 `weight`가 아니라 히트 세는 방식이다.**
> - **분업모드 ON** · 하청은 앞으로 **CLI 직접 호출이 기본**(아래).
>
> **■ 분업모드 실측 — 타워 룰북을 고쳤다 (GC PR #148 머지)**
> | 방식 | 건수 | 클로드 토큰 | 결과 |
> |---|---:|---:|---|
> | 래퍼(Haiku) | 5 | **417k** | 성공 2 · 실패 3 |
> | CLI 직접 | 1 | **약 6k** | 성공 1 (첫 시도) |
>
> 실패 3건이 **전부 판단·보고 층**이었다: "스펙 정확 준수"라며 절반만 구현 /
> Sol을 한 번도 안 부르고 래퍼가 직접 설계 작성(**전량 폐기**) / **스코어러 테스트 6건을
> 깨뜨려 놓고 "완료 ✓" 보고**(되돌렸다) / 산출물 길이 오보고·본문 반환 누락.
> - **개정 내용**: CLI(`codex exec`)는 **직접 호출 + 출력을 파일로**, MCP는 래퍼로 감싼다.
>   **래퍼는 MCP가 출력을 못 자르는 약점에 대한 처방이었다** — 전송을 바꾸면 처방도 불필요.
>   범위는 **코덱스 하청 한정**이다("MCP가 나쁘다"가 아니다 — 셸 없는 표면과 로컬 CLI가
>   없는 서버(Gmail·Drive·Figma)는 MCP가 유일한 길이다).
> - **뼈아픈 것**: CLI 경로는 07-07(MCP 채택)·08-11(래퍼 채택) **두 번 다 후보에 없었다.**
>   `.mcp.json`이 `codex mcp-server`이므로 CLI는 처음부터 깔려 있었고,
>   `codex-debate` 스킬의 `codex-review.sh`는 **애초에 `codex exec`를 쓰고 있었다.**
> - **짝 규칙**: 어느 경로든 **최종 검수는 본 세션이 직접 명령을 돌려서** 한다.
>   오늘 실패 3건이 전부 그 단계에서 잡혔다.
>
> **■ 외부 레포 조사 — `Aperivue/medsci-skills` (MIT, 스킬 59개)**
> PeterJ가 카톡으로 받은 레포. **가져올 것이 생각보다 좁다** — 영상의학·AI 연구자가
> "논문을 쓰는" 라이프사이클용이고 TR은 "남의 논문을 매일 고르는" 시스템이라 단계가 다르다.
> - **저널 프로필 76개**: 스키마(ISSN 병기·저널별 article type)는 값이 있으나
>   **EM/CCM 저널이 사실상 0건**(Critical Care Medicine·Intensive Care Medicine·Resuscitation·
>   Annals of EM 전부 없음). **데이터는 못 쓴다.**
> - **페이월(`fulltext-retrieval`)**: TR이 이미 PMC·Unpaywall·Europe PMC를 다 쓴다.
>   추가되는 건 OpenAlex/Crossref뿐. `find_available_pdf.js`는 Zotero 브라우저 스니펫이라 못 쓴다.
> - **리포팅 가이드라인 49종**(STROBE·CONSORT·PRISMA·QUADAS-2·RoB 2 …)은 실재하고
>   설계 평가축 보강에 쓸 여지가 있다. **무결성 검출기 86종은 저자 원고 QC용이라 무관.**
> - `search-lit`에 **EM/CCM 쿼리 템플릿·MeSH 확장 전략이 없다** → P0-2에는 못 쓴다.
>
> **■ 남은 것 (우선순위)**
> ① **재생 실험 A·C·D 동일 문제 규명** — arm 배선인지 효과 크기인지
> ② **스트림 B를 `DataCollectorAgent` 본체에 완성**(스펙 §5.1) — 재생이 그 값을 증명했다
> ③ `Shock (Augusta, Ga.)` exact 누락 복구 ④ 교육·QI 계열 배제 추가
> ⑤ 주제 히트 세는 방식 교정(그룹 크기 보정) ⑥ `config/collection.json`이 데일리 경로에는
> 아직 안 닿는다 ⑦ (기존) 구글 토큰 재발급 → PR #64 ⑧ (기존) 트랙 비교 19일치 분석
>
> **[2026-08-09 — ★ F1 재순위 복구(스펙 P0-1) + 표 행 계약 실행 잠금 · 선정 개편 첫 착수]**
> - **성격**: 진단이 아니라 **첫 프로덕션 수정**. 선정 개편 스펙의 P0-1 을 실제로 넣었다.
>   발행 표현 계층·대시보드는 **한 픽셀도 안 건드렸다**(/preview 불필요).
>
> **■ 재확인부터 (문서 말고 실측)**
> - 데일리 최근 실행 `31280455886`(08-08) **success** · 잡은 `review` + `verify-pages` 둘뿐.
>   **`archive-gate` 잡은 main 에 아직 없다** — PR #64 에 들어 있고 #64 는 **열린 채**다.
> - `npm run test:unit` **180 pass**(기준선 일치) · spec-lint 통과.
> - `RERANK_POOL` 실제 주입값 = **빈 문자열**(로그 env 덤프에 `RERANK_POOL:` 로 찍힘).
>
> **■ ★ F1 을 먼저 재현했다 (가설 아님, 실행 로그)**
> ```
> ENABLE_RERANK: true          ← 켜져 있고
> RERANK_POOL:                 ← 빈 문자열이 주입되고
> Selected top 1 papers (LLM reranked) for full-text enrichment   ← 돌았다고 찍고
> Stage ANALYZING completed in 0.1s                               ← 실제론 0.1초
> LLM 실행 경로: 구독×1        ← 재순위가 돌면 2회여야 한다
> ```
> 그날 선정된 논문은 *"intensive care telemedicine program on weaning from invasive
> ventilation"* — 재순위 프롬프트가 **명시적으로 감점하라고 적어둔** 원격모니터링·보건서비스
> 연구다. 재순위가 돌았다면 안 뽑혔을 것이다. **고장의 대가가 로그가 아니라 산출물에 있었다.**
>
> **■ 고친 것 (커밋 3개, 각각 독립 revert 가능)**
> - **`3ab1c9f` P0-1 재순위 복구**: 파싱을 정수·양수만 신뢰(빈 문자열·0·음수·비수치 → 20) +
>   워크플로도 `vars.RERANK_POOL || '20'` 로 이중 안전망.
>   - **★ 로그 거짓말 제거**: `(LLM reranked)` 는 이제 `telemetry.applied` 에서만 나온다.
>     플래그로 찍으면 안 돈 날도 돌았다고 적혀 **다음 고장도 4주간 안 보인다.**
>     `rerank_requested/pool_size/llm_called/applied/fallback_reason` 실행 증거 추가.
>   - **부분 응답 무효화**: LLM 이 풀 PMID 를 전부 안 덮으면 재순위 **전체 무효**(누락분이
>     0점 취급돼 순위가 통째로 뒤집히는 것을 막는다).
> - **`f06d368` 표 행 속성 순서 계약 실행 잠금**: 계약은 §4-H-3·HANDOFF 별표·주석에 **세 번**
>   적혀 있었지만 실행으로 잠기지 않았다. `_rowDateDupRe(dateStr)` 를 스윕 정규식 **단일
>   원본**으로 추출(정규식 자체는 종전과 동일 — 발행 HTML 무변경)하고, 테스트가 사본이 아니라
>   **프로덕션이 쓰는 그 정규식**을 `_tableRows` 산출물과 맞물려 검사한다. spec-lint 3중 추가.
> - **`581e290` 코드리뷰 3건**: ⓐ 오케스트레이터가 telemetry 를 버려 증거가 사장 →
>   `selected_papers.json` 에 `selectionMode/rerankApplied/rerankPoolSize/fallbackReason/
>   lowConfidence` 가산(소비자는 `.pmid` 만 읽어 코어 무영향) ⓑ `selection-experiment` 가
>   무효인 날에도 "LLM 이 결정적과 같은 순서를 골랐다"처럼 읽히던 것 → 사유 명시
>   ⓒ 같은 스크립트에 원래 함정이 그대로 남아 있었다 → **spec-lint 신설로 클래스 차단**
>   (`vars.NAME` 주입 이름을 `Number(process.env.NAME ?? …)` 로 읽으면 실패).
>   - **★ 배운 것**: 올바른 가드(`envNum`)는 **이미 `github-actions-daily.mjs` 에 있었다.**
>     `SESSION_RETRY_MAX/DELAY_MIN` 도 빈 문자열로 주입되는데 그쪽은 안 죽었다.
>     RERANK_POOL 만 그 가드를 안 썼다 — 지식이 없어서가 아니라 **한 곳에만 적용돼서** 샜다.
>
> **■ 선정 실버그 4건 — 손대지 않았다(전부 스펙에 이미 흡수돼 있다)**
> 실제 코드로 4건 다 **살아 있음**을 확인했고, 4건 다 합의 스펙에 매핑된다. 중복 구현 금지:
> | 버그 | 코드 실측 | 스펙 |
> |---|---|---|
> | 표본수 오추출 | `_extractSampleSize` 가 맨몸 `(\d+) patients` 까지 잡고 **`Math.max`** — 배경 문장의 대규모 코호트 숫자가 이긴다 | §5.2 "표본 축 **삭제**" · **P0-3** |
> | 최신성 = 호 발행일 | `DataCollectorAgent:196` 이 `JournalIssue.PubDate`(호 표지 날짜)를 읽는다 | §5.2 "최신성 축 삭제" + tie-break ArticleDate · **P1-5** |
> | `jacc` 오매칭 | flagship 티어는 `exact` 0개 · `includes` 29개뿐이라 `includes('jacc')` 가 JACCP 를 3.2점으로 올린다 | §5.2 "저널 축 **exact 우선**" · **P0-3** |
> | 가이드가 논문 스코어러 | `GuidelineAnalyzerAgent:30,40` 이 `MetadataScorer` 를 그대로 쓴다 | §5.5 · **P2-1 `GuidelineScorer`** |
> **스펙이 "P0-1 을 먼저 단독 배포하고 1일 관찰한 뒤 P0-2·P0-3"** 이라고 못 박았다(동시 변경 시
> 귀인 불능). 그래서 오늘은 P0-1 만 넣었다. **다음 세션이 P0-2·P0-3 을 같이 넣으면 된다.**
>
> **■ 검증 (증거)**
> `test:unit` **180 → 197 pass**(신규 17) · spec-lint 통과(신규 검사 4종) ·
> **변이 테스트 8종 전부 적색**: 파싱 되돌림(3) · 로그 플래그화(3) · 부분응답 가드 제거(1) ·
> 논문 행 마커 추가(4) · data-pmid 밀어내기(4) · 스윕 느슨화(1) · 가이드 마커 앞당김(2) ·
> lint 규칙(1).
> - **러너 종단 실측**: `selection-experiment` mode=rerank 를 이 브랜치로 dispatch
>   (run `31312734522` **success**) — 재순위 스텝 **61초** 소요 + 사용량 장부에 LLM 호출 적재.
>   바뀐 코드 경로가 러너에서 실제로 LLM 을 태운다는 확인이다.
>   **단, 이 워크플로는 `RERANK_POOL` 을 주입하지 않아 원래도 20이었다** — 데일리 경로의
>   최종 합격 판정은 **내일 데일리 로그의 `rerank_applied=true`** 다. 과잉 주장 금지.
>
> **■ ★ PeterJ 선정 품질 피드백 (2026-08-09, 세션 후반)**
> "논문 셀렉션 퀄리티가 마음에 안 든다" → 무엇이 거슬리는지 물었고 **둘을 지목**했다:
> - **2-2 저널 등급이 이상하다** — 간호지·범용지가 대표지로 올라온다 → **P0-3**
> - **2-3 후보가 너무 좁다** — 늘 비슷한 주제(패혈증 등)만 돈다 → **P0-2** (+ P1-1)
> - 진행 방식은 **1-1(내일 데일리 결과를 먼저 본다)** 선택 — 재순위가 4주 만에 처음 도는 날이라.
>
> **★ 다음 세션이 오해하면 안 되는 것**: **재순위는 2-2·2-3 을 못 고친다.** 재순위는 상위
> 20편을 재정렬할 뿐이라, 그 20편이 간호지로 오염돼 있고 전부 패혈증이면 **나쁜 목록 안에서
> 제일 나은 걸 고르는** 것에 그친다. 내일 관찰로 답이 나오는 것은 **2-1(침상가치)뿐**이고,
> PeterJ 가 지목한 둘은 그 위쪽 단계(수집·1층 저널 축) 문제다. "재순위 살렸으니 나아지겠지"로
> 넘기지 말 것.
>
> **■ 1층 감점 누락 실측 (어제 픽을 스코어러에 직접 넣어봄)**
> `"intensive care telemedicine program on weaning…"` → **rawScore 9.66 · 감점 0.0**.
> `deprioritize.nonacute_method` 에 `remote monitoring`·`telemonitoring` 은 있는데
> **`telemedicine`·`tele-icu` 가 없다.** 1층이 못 걸렀고 2층은 죽어 있어서 그대로 나갔다.
> config 한 줄이라 폰에서도 고칠 수 있다(P0-3 과 함께 처리 권장).
>
> **■ ★ 다음 세션이 할 것**
> ① **다음 데일리 로그에서 `rerank_applied=true`·`rerank_pool_size=20` 확인** — 이게 P0-1 의
>    진짜 합격선이다. 안 찍혔으면 되돌리지 말고 `fallback_reason` 을 읽어라.
> ② **P0-2(쿼리 교정) + P0-3(저널 exact·간호지 low·표본 축 삭제)** 을 함께.
> ③ (미실행) `lowConfidence` 를 대시보드·텔레그램에 표기 — **REPORT_SPEC §2 개정 +
>    spec-lint 앵커 갱신이 선행**돼야 CI 를 통과한다. 데이터는 이미 파일에 쌓인다.
> ④ 구글 토큰 재발급 → PR #64 머지(아카이브 2026-07-08부터 사망, `archive-gate` 도 여기 있다).
>
> **[2026-08-08 — 현황 파악 + 배포 페이지 2분할(§4-H) 프로덕션 반영·배포 완료]**
> - **성격**: 세션 전반부는 현황 진단, 후반부는 스펙 §5.5-B(페이지 2분할) 구현·배포.
>   **선정 로직은 한 줄도 안 건드렸다.** 변경은 발행 표현 계층에 한정.
>
> **■ 진단 — 데일리 코어는 정상, 고장은 구글 아카이브 한 곳**
> - 데일리 30일 연속 success. 어제(run `31222508020`) 1편 선정 → 텔레그램 → Pages 검증까지 초록.
> - **★ Phase 2 Drive 아카이브가 2026-07-08부터 31일째 죽어 있다 — `invalid_grant`.**
>   PeterJ 가 언급한 구글 구독 문제와 **다른 건이다**(근거 셋): ⓐ 시점이 안 맞는다(며칠 전이
>   아니라 한 달) ⓑ `invalid_grant` 는 **토큰 갱신 단계** 오류라 업로드를 시도조차 못 한다
>   ⓒ `analysis_archive.json` 의 `driveState` 에 8월 폴더·Doc 이 아예 없고 `fulltextDone` 이
>   7/06~7/08 3건에서 멈췄다. 실제 원인 = OAuth 동의화면이 "테스트"라 **refresh token 7일 만료**.
>   - **한 달간 안 보인 이유**: 그때 코드가 안쪽 실패를 삼키고 `📚 Drive 아카이브 완료` 를 찍었다.
>     8월 들어 월 폴더가 바뀌며 바깥 catch 로 떨어져서야 `::warning::` 이 보이기 시작했다.
>   - **PR #64 가 이미 이걸 진단해 뒀다**(열린 채 대기). 토큰 재발급이 선행돼야 머지 가능.
>   - **순서 권고**: 구독 해결 → 토큰 재발급. 토큰만 고쳐도 용량이 막혀 있으면 업로드에서 또 걸린다.
> - **F1(LLM 재순위 미작동) 여전히 미수정** — `daily-review.yml:85` 그대로. 어제 로그
>   `LLM 실행 경로: 구독×1`(재순위가 돌면 2회)로 재확인.
> - **트랙 비교 실험**: 7/12~7/30 **19일치 수집 완료**. 종료일이 지나 워크플로가 매일 0초
>   no-op 으로 헛돌고 있고, **결과 분석·Arm3 투입은 미실시**.
>
> **■ 구현 — 배포 페이지 2분할 (PR #75 · #76, 둘 다 머지 · 배포 완료)**
> ```
> index.html        ① 논문 (데일리 코어)
> guidelines.html   ② 가이드라인 및 기타  ├ 📋 가이드라인  └ 🔖 기타 자료
> ```
> - **★ 설계 = 합쳤다가 가른다.** `publish()` 는 읽을 때 `mergePages(index, guidelines)` 로
>   단일 본문을 만들어 **기존 증분 로직에 종전과 동일한 입력**을 주고(무변경), 끝에서
>   `splitPages()` 로 두 파일을 기록한다. 로직을 두 벌로 만들지 않는 것이 요점.
>   부수효과로 **마이그레이션이 자동**이고, 배포 HTML 이 입력이라 상태 파일에 없는
>   과거 저널명(38건 중 9건)도 따라온다 — 스펙이 지목한 실측 제약이 해소됐다.
> - **대등한 병렬 페이지**: 같은 히어로 + 같은 탭 바(`.pgnav`), 현재 페이지만 활성.
>   디자인은 **타워 톤**(TH·TP·MP 공통 언어 — 웜뉴트럴 지면 + 무지개 라디얼, 글래스 카드,
>   웜 잉크, 알약 배지)을 `<style id="tower-tone">` 오버레이로 원본 CSS 뒤에 얹는다.
> - **정본 = `src/utils/pageSplit.js` 하나.** 미리보기용으로 만들었던 `scripts/split-pages.mjs`
>   는 삭제했다(같은 로직 두 벌 = 드리프트 위험).
> - 규격은 **REPORT_SPEC §4-H** 에 못 박았고 spec-lint 검사 **9종**이 지킨다.
>
> **■ ★ 다음 세션이 반드시 알아야 할 계약 (어기면 데일리가 조용히 깨진다)**
> - **`data-pmid` 는 `<tr ` 다음 첫 속성**이어야 한다 — 행 dedup 과 curation 삭제 패치가
>   `<tr data-pmid="…"[^>]*>` 로 잡는다.
> - **논문 행에는 종류 마커를 붙이지 않는다.** 같은 날 재실행 교체 정규식이
>   `<tr data-pmid="[^"]*"><td class="c-date">…` 라, 속성이 하나라도 늘면 매치가 깨져
>   **행이 매일 중복 누적된다.** 논문은 "`data-guideline` 없음"으로 판별. 가이드·기타만
>   `data-kind` 를 `data-pmid` **뒤에** 단다. (구현 중 실제로 밟았다.)
>
> **■ 함께 고친 결함 + 별건 실버그**
> - 참고자료 섹션 헤더 `📋 가이드라인` 하드코딩 → `🔖 기타 자료`(HANDOFF 8/07 의 미처리 ⓐ 해소)
> - 표 행 종류 마커 부재 → `data-kind` · 큐레이션 JS 가 표 1개만 처리 → 전부 순회(v4→v5)
> - **★ 별건**: `GitHubPublisher` 생성자가 `this.logger` 를 안 넣어 undefined 였다. 그래서
>   **git push 실패 폴백이 첫 줄 `logger.warn` 에서 TypeError 로 죽어 한 번도 실행될 수
>   없었다**(상태 JSON 업로드 안전망 포함). dry-run 에서 실측 발견 → 기본 로거 주입.
>
> **■ 코드리뷰(high) 6건 — 전부 수정·회귀 테스트**
> 머지 직전 리뷰가 잡았고, 둘은 머지했으면 데일리에서 바로 발화했다:
> ① **2회차 발행부터 guidelines 통계가 index 것으로 되돌아감** — 지난 실행이 심은 `<nav>` 가
>   통계 교체 정규식을 깨뜨렸다. 종전 왕복 테스트가 **개수만 세어** 못 잡았다(이제 문구를 본다).
> ② `ARCHIVE_STATUS` 마커 부재 시 폴백 `indexOf('</div>')` 가 표 **안쪽** div 를 잡아 표가
>   두 페이지에 통째로 복제 → 컨테이너를 균형 계산으로 닫는다.
> ③ 상태 마커 버전 하드코딩(v1) ④ `curate-remove` 가 `index.html` 만 패치해 **가이드라인
>   삭제가 조용히 무효** ⑤ 행 병합 문자열 치환에서 제목의 `$&`·`` $` `` 해석
>   (이 테스트의 **픽스처 자체가 같은 함정에 걸려 4행→7행**이 됐다) ⑥ on-demand 가 가이드
>   발행 후 사이트 루트로 안내 → `guidelines.html` 로.
>
> **■ 검증 (증거)**
> `test:unit` **160 → 180 pass** · spec-lint 통과(§4-H 9종 신설) · **변이 테스트 6건 전부 적색** ·
> 실제 `index.html` **4회 왕복**에서 카드 42·행 42·통계 문구·nav 개수 불변 · `publish()`
> dry-run 2회 행 중복 0 · `curate-remove` 실동작으로 가이드 카드+행 제거(index 무변경) ·
> `/preview` 폰 390px·태블릿 800px PeterJ 승인 2회.
>
> **■ 남은 것 (다음 세션)**
> ① **구글 토큰 재발급**(구독 해결 후) → PR #64 머지 → 아카이브 복구.
>    현재 문서는 데스크탑 실행 전제(`docs/desktop-day-guide.md`) — **폰만으로 되는 경로는 미조사.**
> ② **F1 재순위 복구**(스펙 P0-1, ~40줄) ③ **트랙 비교 19일치 분석** + 헛도는 워크플로 정리
> ④ 선정 개편 스펙 P0 착수 ⑤ 아카이브 하루 지연 버그(브랜치 `daily-report-feedback-7tr5no`)
> ⑥ 원격 브랜치 30개 미정리
>
> **[2026-08-07 — 페이월 문헌 본문 입력 통로 신설 + curation 실버그 1건 · 선정 개편 무관]**
> - **발단**: PeterJ가 NEJM Clinical Practice **"Syncope"**(Kenny RA, PMID **42555934**,
>   DOI 10.1056/NEJMcp2517255) 캡처를 주며 "on-demand로 돌려 넣어달라". 처음 `kind=paper`로
>   돌렸으나 PeterJ가 **"PICO가 안 맞는다, 요약분석 개념"**이라고 정정 → `kind=reference`로 전환.
>   (교훈: **서술형 종설은 reference 모드가 맞다** — 그 모드 프롬프트가 PICO를 명시적으로 금지한다.)
> - **문제**: NEJM은 페이월이라 러너가 원문을 못 읽는다(`fetchSourceText` 403, LLM 웹검색도 막힘).
>   첫 reference 카드가 **초록 수준으로 얇았고**, 카드 스스로 "본문 미열람, 수치·역치 확인 안 됨"이라 적었다.
> - **① `sourceText` 입력 통로 (PR #72, 머지)**: on-demand 선택 입력 → `OD_SOURCE_TEXT` →
>   `applyUserText()`가 `enriched.fullText` 자리에 얹는다. `src/utils/userSuppliedText.js` 신규
>   (100자 미만 무시 · 60000자 상한 · `fullTextSource='user-supplied'` · `fullTextLength` 갱신).
>   - **캐시 함정**: `GuidelineAnalyzerAgent._cacheKey`에 본문 지문을 안 넣으면 같은 PMID를
>     초록으로 먼저 돌린 뒤 본문을 넣어도 **얇은 첫 결과가 재사용**된다 → 사용자 본문이 있을 때만
>     `_ut<sha12>` 접미사. **본문 없는 기존 경로 키는 종전과 동일(데일리 코어 무영향).**
>   - 공개 repo라 dispatch 입력값이 Actions 화면에 남는다는 점은 주석·입력 설명에 적어뒀다.
>     PeterJ 판단으로 이번엔 전문 수준 정리본을 그대로 넣었다.
> - **② curation 실버그 (PR #73, 머지)**: **숨김 기록이 같은 PMID의 다른 트랙 카드 표 행을 영구히
>   지운다.** `publish()`가 매 발행마다 `_applyCuration`을 재적용하는데 `removeSectionFromHtml`이
>   섹션 제거 성공 여부와 무관하게 pmid 행을 지웠다. 섹션 키는 `SECTION:…`인데 **행 키는 pmid 하나뿐**이라
>   `GSECTION`(가이드/참고자료) 카드의 새 행까지 같이 사라진다. **실측**: PICO 카드를 curate-remove로
>   지운 뒤 같은 PMID를 참고자료로 재발행 → 카드는 뜨는데 누적 표에만 행이 없었다.
>   수정 = 이번 호출에서 섹션을 실제로 지웠을 때만 행을 지운다.
> - **검증**: `test:unit` **149 → 160 pass**(신규 11) · spec-lint 통과 · **변이 테스트 2회**
>   (캐시키 접미사 제거 시 2건 적색 / curation 가드를 상수 true로 죽이면 1건 적색) · 실측 재발행 후
>   카드 1개 + 누적 표 행 복구 확인.
> - **남은 것(미처리)**: ⓐ **접힌 섹션 헤더가 참고자료에도 `📋 가이드라인`으로 뜬다** —
>   `GitHubPublisher._buildGuidelineSection`이 라벨을 하드코딩(카드 안쪽 배지는 `🔖 참고자료`로 정상).
>   대시보드 표시 변경이라 **/preview 승인 후** 고칠 것. ⓑ 마지막 카드 `출처 성격` ⑤에 깨진 어절
>   ("실린더블루더 회사명") 1곳 — LLM 생성 잡음, 재실행하면 사라질 가능성.
> - **세션 제약 메모**: 이 세션에서 **eutils(PubMed)·pubmed.ncbi.nlm.nih.gov·github.io가 프록시 차단**.
>   PMID 조회는 DOI를 러너에서 해석시키거나 상태 파일로 확인해야 한다.
>
> **[2026-08-06 — 선정 품질 진단(F1~F8) → 클코덱스 설계토론 수렴 → 합의 스펙 draft · 프로덕션 코드 무변경]**
> - **성격**: 진단·설계 단계 + on-demand 소품 2건. **선정 관련 프로덕션 코드·config는 한 줄도 안 건드렸다.**
>   작업 브랜치 `claude/paper-selection-quality-2221ez-2u0ckp`(원 브랜치 `…-2221ez`를 ff 흡수).
> - **먼저 읽을 것**: ① **합의 스펙 `docs/superpowers/specs/2026-08-06-selection-guideline-redesign-design.md`**
>   (구현 착수 지점 = 이 문서) ② 토론 원본 `docs/reviews/2026-08-06-1421-selection-quality-debate.md`(진단 F1~F8 + R0/R1/심판 요지).
>
> **■ 진단 (이전 세션 · 요약 — 정본은 토론 문서 §1)**
> - **★ F1 = 최대 발견: LLM 재순위(3층)가 프로덕션에서 한 번도 돈 적 없다.** `daily-review.yml:85`가
>   `vars.RERANK_POOL` 미설정 → **빈 문자열** 주입 → `Number(env ?? 20)`에서 `??`가 빈 문자열을 통과시켜
>   `Number('')=0` → `poolSize=max(1,0)=1` → `_rerankSelect`가 `pool.length<=n`에서 즉시 반환.
>   실측 run `31053207293` ANALYZING **0.1초**. 로그가 플래그만 보고 `(LLM reranked)`를 찍어 **4주간 은폐**.
> - **F2** 저널 맨몸 부분일치(`"critical care"`가 7종 승격, `"jacc"`가 JACCP 오매칭) — 라이브 상위 20 중 11편.
>   **F3** 주제 포화(제목 2히트면 만점) + 검색 MeSH 동어반복. **F4** 설계 축 무력(0.86점 차 vs 저널 4.2점 스윙).
>   **F5** 표본 추출이 쓰레기 숫자(`N≈1704632`). **F6** 최신성 사실상 상수 + `JournalIssue.PubDate` 오독.
>   **F7** 수집 실효창이 180일이 아니라 **~2주**. **F8**(이번 세션 추가) 가이드라인 선정도 **같은 논문
>   스코어러**를 써서 F2~F6이 그대로 전이 — IDSA 웹 공개본이 `journal="idsociety.org"` → default 0.8,
>   ESICM은 flagship 3.2. **게재 매체 형식만으로 2.4점 역차별.**
>
> **■ 설계토론 (이번 세션 · Fable ↔ gpt-5.6-sol, R0 → R1 → 심판) — converged = true**
> - **codex 인증 복구.** 원인이 둘이었다: ① `env-bootstrap.sh`(global-config)가 세션에서 실행되지 않아
>   `auth.json` 미시딩 ② **재저장된 `CODEX_AUTH_B64`에 base64 패딩(`=`) 누락**(len 5751, %4=3).
>   `base64 -d`가 exit 1이라 부트스트랩의 `&&` 가드가 끊겨 **방금 만든 auth.json을 `rm -f`로 지운다** —
>   부트스트랩이 정상 실행됐어도 계속 실패했을 함정. 내용은 무손실(패딩 보정본과 바이트 일치).
>   **미수리 — 근본 해결은 ⓐ env 값 끝에 `=` 추가 ⓑ 부트스트랩이 패딩 보정. 둘 다 config 변경이라 미착수.**
> - **심판이 판정 중 PubMed 라이브 실측 7건을 수행했고, 양측 R1의 전제가 둘 다 반증됐다:**
>   - **`"sepsis"[MeSH]` 독립항 하나가 현행 풀 403편 중 307편(76%)을 만든다.** 제거 시 패혈증 76% → **6.9%**.
>     확정 ③은 쿼리 1줄로 충족 → **lane 할당 불필요**(Fable R1이 lane으로 갈아탄 근거가 사라진다).
>   - **★ 현행 쿼리 MeSH가 "학문 분야" 용어라 실제 EM/CCM 문헌의 약 11%만 본다**(96 vs 확장 851).
>     **sepsis 항만 빼면 풀이 403 → 96으로 붕괴** — Fable R0 0층안을 그대로 시행했다면 후보 고갈로
>     품질이 더 나빠졌을 것. **양측 누구도 MeSH 선택 자체를 검토하지 않았다. P0에서 가장 중요한 단일 수정.**
>   - **무필터 저명저널 스트림은 180일 9,853건** → retmax 80이면 실효 **1.5일**. 양측 안 모두 확정 ④를
>     배달 못 함 → **월 6분할 층화 추출 + 설계 PT 필터**로 대체(Fable N1 진단이 옳았고 처방만 교체).
> - **R1이 병렬이라 서로의 R1을 못 봤고, 수집 구조에서 교차 양보가 일어났다** — codex는 lane을 버리고
>   이중 스트림으로, Fable은 이중 스트림을 버리고 lane으로. **아무도 자기 안을 안 들고** 심판에 넘어갔다.
>   codex는 **자기가 신설 제안한 `actionability` 축도 자진 철회**했다.
> - **주요 판정**: 수집=이중 스트림 · 저널 축=**Fable 티어 -1.0~4.0 유지**(codex 안은 설계를 저널 위로
>   올려 확정 우선순위 ①주제 ②저널을 뒤집는다) · 후보 20 주제 상한 **5/20**(30% *미만* 이라 6은 위반) ·
>   가이드 상태 **1파일, 기존 파일명 재사용**(퍼블리셔 파일 목록 0곳 수정) · 가이드 게이트 **needsReview** ·
>   논문 캐치업 큐 불필요.
> - **심판 추가 지적 중 중요**: 주제 탈포화 체감가중 합이 0.75면 `rel01`이 1.0에 못 닿아 주제 실질 상한이
>   3.0으로 내려앉고 **저널(4.0) > 주제**로 역전된다 → `[0.50, 0.25, 0.15, 0.10]`(4히트=1.00)로 교정.
>
> **■ PeterJ 확정 (전부 스펙 §1·§8에 기록)**
> ① 서술형 리뷰 = **flagship(최상위 종합지)만 예외 허용** ② 간호·보건서비스지 **low -1.0**
> ③ 패혈증 **30% 미만** ④ 따라잡기 **허용**(놓친 대작부터 소진) ⑤ 소아 가이드라인 **감점 -2.0만**(배제 안 함)
> ⑥ 가이드 문서 유형 **우선 미포함**(백필 dry-run에서 queued<20이면 재논의) ⑦ v2 경계선 **구/신 구간 통계 분리까지**
> ⑧ 가이드 발행 시 **텔레그램 전용 알림 발송** ⑨ 콘텐츠 **3분류 유지 + 페이지 2분할 + 섹션 분리**
> ⑩ 누적 표도 **과거 행 포함 페이지별 분할**
> - **⑦ 주의**: v1/v2는 **점수 스케일이 다르다**(v1 최대 11.0 / v2 10.0) → **평균 점수 비교 불가**,
>   구성비 지표(저널 티어·설계 분포·단일 주제 점유율·간호지 픽 수·재순위 적용률)로만 낸다. n 항상 병기.
>   v1 구간 통계는 과거 38편의 **설계 라벨이 어디에도 없어** PubMed 1회 백필 필요(~50줄).
> - **⑩ 주의**: 상태 파일만으로는 표 재생성 불가 — `selected_papers.json`이 `{pmid,title,date}`뿐이라
>   **저널명이 없다**(38건 중 저널 보유는 analysis_archive 29건). 현재 `index.html` 표 행에는 38건 전부
>   저널이 있으므로 **일회성 HTML 파싱 마이그레이션**으로 옮긴다. 가르는 키는 이미 있다(`data-guideline="1"`).
>   **후속 필수: `appendState`에 `journal` 필드 추가** — 안 하면 다음 재생성에서 같은 소실 반복.
> - **⑧ 주의**: `REPORT_SPEC §2`가 메시지를 5줄로 못 박고 `spec-lint.mjs:74-82`가 강제한다.
>   §2에 가이드 포맷 절 추가 + lint 앵커 갱신이 **선행**돼야 CI를 통과한다.
>
> **■ 구현한 것 (선정 개편과 무관한 별건 · 승인 게이트 밖)**
> - **on-demand 위젯 URL 갭 해소 (v3→v4)**: 대시보드 "직접 입력"이 `/^\d{5,9}$/`·DOI만 받아 **URL을
>   거부**하던 문제. `classify()` 신설로 http(s) 수용. 위젯 인라인 JS를 테스트가 **실제로 추출해 실행**한다.
> - **`kind=reference` 범용 참고자료 모드 신설**: 공식 가이드라인도 논문도 아닌, PeterJ가 직접 판단해
>   넣는 자료. URL·PMID·DOI 전부 수용. 카드는 가이드라인과 골격 공유하되 "이전 판 대비 변경점" 자리에
>   **"출처 성격"**(동료심사 여부·1차/2차·근거 인용·기준 시점·이해관계)이 들어간다. 확인 안 되는 것은
>   "확인되지 않음"으로 적게 해 **추정으로 권위를 부여하지 않는다.** 배지 `🔖 참고자료`.
>   `GuidelineAnalyzerAgent.analyze(doc, { mode })`로 분기 — **기본값 `'guideline'`이라 데일리 코어 무변경.**
>   - **함정 2개 처리**: ⓐ 캐시키에 mode를 안 넣으면 같은 URL을 두 모드로 돌릴 때 첫 결과가 재사용된다
>     → `${mode}_v5_…` ⓑ `on-demand.yml`의 상태 커밋 목록에 `selected_references.json`이 빠져 있어
>     러너가 만들어도 매번 사라질 뻔했다 → 목록·`.gitignore`·spec-lint 3곳에 추가.
> - **검증**: `test:unit` **120 → 149 pass** · spec-lint 통과 · 수정 파일 `node --check` · `/preview` 폰 렌더 확인.
>
> **■ 남은 것 (다음 세션)**
> ① **스펙 확정 → P0-1 착수**(F1 재순위 복구 ~40줄, 소프트 폴백이라 코어 안전)
> ② `CODEX_AUTH_B64` 패딩 근본 수리(위 ⓐ/ⓑ) ③ **(기존) 아카이브 하루 지연 버그** — 브랜치
> `claude/daily-report-feedback-7tr5no`에 3주 전 코드로 방치, 현행 main 기준 재구현 권장
> ④ **(기존) PR #64는 `GOOGLE_REFRESH_TOKEN` 재발급 전 머지 금지** — 데일리가 매일 `invalid_grant` 경고 중
> ⑤ 전역 지침 "선택지 1개당 코드블럭 1개" 규칙을 global-config `claude/option-codeblock-rule` 브랜치에
> 올려뒀다 — **PR·머지·전역 배포 미실행**
>
> **[2026-08-04 — PubMed 미등재 가이드라인 URL 경로 + 알림 채널 텔레그램 단일화]**
> - **발단**: PeterJ "2026 IDSA gram negative 가이드라인 TR에 추가로 돌려줘".
>   실측 결과 **그 문서는 PubMed에 없다** — `gram-negative[Title] AND guidance[Title]` 전수 6건,
>   `Tamma PD[Author] AND (guidance|guideline*)[Title]` 전수 18건 모두 확인, 최신 등재본은
>   **2024판 PMID 39108079 / DOI 10.1093/cid/ciae403**. on-demand는 PMID/DOI만 받으므로 못 태웠다.
> - **① URL 지정 경로 신설 (PR #65, 머지)**: `target`이 `http(s)://`면 **가이드라인 전용 웹 출처 모드**.
>   - `src/utils/externalGuideline.js`(신규) — URL 판별·`sourceId`(`web:<host><path>`)·본문 확보(소프트)·합성 객체.
>   - `GuidelineAnalyzerAgent` 프롬프트에 **Source URL 명시**(LLM이 원문을 직접 읽게) + 캐시키 `pmid||sourceId`.
>   - `GitHubPublisher`: PMID 없는 가이드 카드/표 행이 죽은 `#` 대신 **원문(발행기관) 링크**,
>     섹션 키·행 키·중복 제거를 `sourceId`/`sourceUrl`로 폴백. **PMID 경로는 무변경**(회귀 테스트 고정).
>   - on-demand.yml 선택 입력 `title`·`org`·`pubdate` 추가.
>   - **실측**: run `30895778410` success — `📄 원문 텍스트: 60000자 확보` → 발행.
>     **세션에서는 idsociety.org가 프록시 정책상 403이지만 Actions 러너는 열려 있다**(중요).
>   - 산출물: IDSA 2026 AMR 그람음성 가이던스 카드(핵심 권고 7 · 변경점 12 · 임상 임팩트)를
>     라이브 대시보드에 게시. 문서 버전은 파이프라인이 공홈에서 읽은 값 = `2026 (v5.0, current as of
>     March 1, 2026; published July 30, 2026)`.
> - **② 알림 채널 텔레그램 단일화 (PR #66, 머지)**: 같은 런에서 카카오가
>   `invalid_grant / expired_or_invalid_refresh_token (KOE322)`로 실패 — 토큰 만료.
>   PeterJ 판단: 재발급 대신 **텔레그램으로 정리**(텔레그램 생존은 smoke run `30955539644`로 실측).
>   - `src/utils/reportMessage.js`(신규) = **§2 메시지 텍스트 정본**을 채널에서 분리. 텍스트 무변경.
>   - 발송 지점 5곳 전환 — 데일리 성공·실패, verify-pages 실패, materialize 실패,
>     notebooklm 리마인더, **on-demand**(그동안 카카오 단독이라 알림이 아예 없던 구멍).
>   - `KakaoNotifier.js` 삭제 + 워크플로우 4개 `KAKAO_*` env 제거, spec-lint 앵커 이전.
>   - 병합본 통로 재점검 run `30956404066` success.
> - **검증**: spec-lint 통과 · `test:unit` 120→**132** · 수정 파일 `node --check` · 모바일 390px 렌더 확인.
> - **남은 것**: 저장소 Secrets의 `KAKAO_*` 3개는 아무도 안 읽음(방치 무해, 지우려면 PeterJ가 Settings에서).
>   PubMed에 2026판이 등재되면 `GuidelineAnalyzerAgent`의 주간 게이트가 **같은 지침을 또 뽑을 수 있다**
>   (웹 카드와 PMID 카드는 중복 제거 키가 다름) — 그때 `selected_guidelines.json`에 PMID를 넣거나
>   수동 삭제로 처리.
>
> **[2026-07-25 — 타워 사용량 장부 연결 + 브랜치 판정 + 미머지 버그 발굴]**
> - **작업 성격**: 관제(Usage & Billing) 인프라 연결 + 저장소 위생. **데일리 산출물·포맷 변경 없음.**
> - **사용량 장부 연결 (PR #50·#51, 머지됨)**: 이 repo의 실행 토큰·비용을 타워(global-config
>   비공개)의 `data/usage/YYYY-MM.jsonl`에 `(auth, 모델)`별 1줄로 적재한다.
>   - 원래 타워 가이드는 `claude-code-action` 출력 파싱 전제였는데 **이 repo엔 그 액션이 없다**.
>     다만 이미 `claude -p --output-format json`으로 부르고 있어 응답에 `usage`·`total_cost_usd`·
>     `modelUsage`가 들어온다(CLI 2.1.220 실측). **`.result`만 쓰고 버리던 값을 주워 담은 것**.
>   - `src/utils/LLMClient.js` `llmTelemetry`에 `(auth, 모델)`별 누적 추가. **`totals`는 `reset()`이
>     건드리지 않는다** — 세션 한도(429) 재시도 때 런마다 `reset()`이 불리는데 여기서 지우면
>     한도에 걸릴 만큼 태운 토큰이 통째로 빠진다. **`label()` 출력은 불변**(카톡 문구·job summary 보존, 테스트로 고정).
>   - 종료코드가 0이 아닌 CLI 호출도 stdout 결과 JSON에서 사용량을 건진다(그 날이야말로 기록이 필요).
>   - `src/utils/usageDump.js` + 공용 액션 `.github/actions/append-usage`. **토큰 태우는 워크플로우
>     6개 전부** 연결: daily-review · **compare-tracks(schedule 자동!)** · on-demand ·
>     selection-experiment · materialize · video-sample. 비소비 4개(ci·curate-remove·
>     notebooklm-sync·verify-pages)는 연결 안 함.
>   - 적재 스텝은 **`if: always()` + `continue-on-error` + `timeout-minutes: 5`**. 타임아웃이 필수인
>     이유: `continue-on-error`는 "실패"만 덮고 **"멈춤"은 못 덮는다**. 클론이 행이면 잡이 240분 뒤
>     취소되고, 그러면 `needs: review`인 **`verify-pages`(Pages 배포 안전망)가 통째로 안 돈다**.
>   - 검증: `test:unit` **120/120**(신규 13) · `spec-lint` 통과 · **변이 테스트**(`recordCliResult`
>     호출 제거 시 배선 테스트 3건 적색) · 종단 dry-run · 통로 실측(프로브 run 30145017192).
>   - 독립 코드리뷰 1회 **머지 부적합** 판정 → Important 4·Minor 5 반영 후 머지. 핵심 지적 셋은
>     **append-only 장부에 영구히 잘못된 데이터**를 남기는 것이었다(모델별 원자료 소실 /
>     실패 호출 사용량 폐기 / API 비용 0을 `exact`로 기록).
> - **⚠️ 다음 세션이 처리할 것 — 미머지 버그**: 대시보드 **"아카이브 저장 현황"(§4-E) 패널이
>   지금도 하루씩 늦게** 뜬다. 2026-07-09 PeterJ 피드백으로 수정(`refreshArchiveStatus()` 재주입
>   + 테스트 97줄)까지 만들어졌으나 **머지되지 않고 브랜치에 방치**됐다.
>   - 2026-07-25 실측: main `github-actions-daily.mjs`가 `runWithRetry`(→publish, 65줄) →
>     `ArchiveAgent`(139줄) 순서 그대로이고, `refreshArchiveStatus`는 main에 **0회**.
>     `scripts/on-demand.mjs`도 동일(publish 85줄 → ArchiveAgent 91줄).
>   - 브랜치 `claude/daily-report-feedback-7tr5no`(계획 문서 포함). **3주 전 코드라 그대로 얹지 말고
>     현행 main 기준 재구현 권장** — 그 사이 `GitHubPublisher.js`가 많이 바뀌었다.
> - **브랜치 정리 (판정 완료, 삭제는 미실행)**: 23개 중 **20개 삭제 안전**(머지된 PR 있음 →
>   `refs/pull/N/head`로 영구 복구 가능 / 또는 main과 내용 동일), **3개 살아있음**:
>   ① `paper-selection-mobile-cowork-r7jwjh` — `docs/cowork-paper-selection-prompts.md` 182줄,
>   **main에 없는 유일본**. 코워크 자동화 운용 결정 시 필요 → main으로 건져올 것.
>   ② `daily-report-feedback-7tr5no` — 위 미머지 버그 수정.
>   ③ `code-review-optimization-foai3i` — 2026-07-02, 12파일 124줄. **PR이 없어 지우면 영구 소실**,
>   3주간 main이 크게 바뀌어 그대로 얹으면 위험. 대조 후 판단 필요.
>   - **세션에서 브랜치 삭제 불가**: `git push --delete`는 프록시 403, GitHub MCP에 삭제 도구 없음.
>     PeterJ가 `/branches` 화면에서 수동으로 하거나, 자동삭제 설정에 맡긴다.
> - **완료·정리**: repo Settings에 **`Automatically delete head branches` 활성화**(앞으로 머지되는
>   브랜치는 자동 정리). **구 GitHub 토큰 폐기 확인** — `Settings → Tokens (classic)` 목록이 비어
>   있음(MP의 P-d 대기 항목이었음). 단 `archive/` 밑 3개 파일에 **죽은 `ghp_` 문자열이 남아 있다**
>   — 보안 위험은 없고 스캐너가 계속 잡는 위생 문제(`archive/`는 레거시라 통째 정리도 선택지).
> - MP는 **v23**으로 갱신(위 항목들 6분류 반영).

> **[2026-07-23 — 데일리 401 인증 장애 수정 (subprocess는 정상, 인증이 원인)]**
> - **증상**: 2026-07-20~22 데일리가 매일 소프트 실패("claude CLI 오류(일시적일 수 있음) —
>   3회 재시도 후에도 실패") + 카톡 실패알림. 브랜치명 `subprocess-issue`는 오해였음.
> - **근본 원인(Actions 로그 실측)**: subprocess(claude CLI)는 정상 작동. 실제는 인증 401 —
>   `api_error_status:401 / "Failed to authenticate. API Error: 401 API key is invalid."`
>   PeterJ가 과금 때문에 **`ANTHROPIC_API_KEY`를 비활성화**했는데, 그 죽은 키가 spawn 시
>   `process.env`로 CLI에 새어들어가 **CLI가 구독 OAuth 토큰 대신 그 키를 우선 사용** → 401.
>   (마지막 성공 07-19, 키 비활성화 후 07-20부터 실패로 타임라인 일치.)
> - **수정(PR — LLMClient.js·retryPipeline.js)**: ① `_spawnClaude`가 자식 CLI env에서
>   `ANTHROPIC_API_KEY`만 제거 → 구독 경로 보장(Node 폴백 `_callAnthropicAPI`은 격리 무관,
>   키 재활성화 시 자동 복귀). ② `classifyFailure`가 401/인증 실패를 **결정적(비재시도)**로
>   분류 → 2.5시간 헛재시도 제거 + "인증 실패 — 재발급 필요"로 정확한 카톡 안내. 회귀 3건 추가.
> - **검증(실측)**: 브랜치에서 데일리 수동 dispatch(run 29985296543) → `구독×2`(401 없음)·
>   1편 선정·카톡 정상 발송·96.7초 완료. **구독 토큰은 멀쩡 → PeterJ 시크릿 조작 불필요.**
> - **남은 별개 이슈(팔로업)**: 같은 런에서 Phase 2 아카이브가 `invalid_grant`(Google
>   `GOOGLE_REFRESH_TOKEN` 만료)로 소프트 실패 — **코어 무영향**. 이번 401과 무관. Google 재인증은
>   데스크탑 조작 필요(스텝바이스텝 안내 대상). 미해결.
>
> **[2026-07-12 — CC 글로벌 툴체인 확장 (EMR_Assist_v1 세션에서 작업, trend-review 반영)]**
> - **확장 플러그인 세팅 도입**: 딥리서치(적대검증 완료, `docs/reviews/2026-07-12-cc-ecosystem-deep-research.md`)
>   근거로 A그룹 상시(typescript-lsp·superpowers-chrome) + B그룹 온디맨드(pumasi·insane-search·
>   security-guidance·double-shot-latte) 체계 확정. `.claude/env-bootstrap.sh`가 A그룹 자동설치+
>   마켓플레이스 등록, `.claude/global-CLAUDE.md`에 B그룹 발동 조건표(클로드가 상황 판단해 토글).
>   **새 세션 A그룹 3종 enabled 실측 확인.** B그룹은 설계상 미설치(마켓만 등록)가 정상.
> - **codex-debate 설계토론 모드** 추가("클코덱스 설계토론") — SKILL.md + 스펙 §12.
> - **클코 구조도 v4** (`docs/claude-stack-map.html`) — 확장 플러그인 A/B 반영. 마스터플랜 방식 누적.
> - 적용: PeterJ가 Default 환경 setup script 재저장(캐시 재빌드)로 반영 완료. 이후 새 세션 자동.
> - **다음**: B그룹 첫 사용 시 실측(insane-search 도달률 before/after, pumasi 산출물 verify 통과).
>   분기 1회 "Not used recently" 정리(구조도 갱신과 병합). context7 등 외부 API형은 배포 단계에서 도메인 허용 검토.
> 최종 갱신: **2026-07-11 (KST)** · **2주 트랙 비교 실험(Arm1 vs Arm2) 구현·main 병합 완료** — brainstorming→spec→plan→서브에이전트 8-task TDD, 최종리뷰 READY TO MERGE. 데일리 코어 무접촉(별도 워크플로우, `experiments/`만 커밋). **시작은 PeterJ가 Variables 2개 설정**. 상세는 **§10 [2026-07-11] 블록**.
> 최종 갱신(이전): 2026-07-10 선정 3층 개편 프로덕션 반영 · 2026-07-09 진단·설계 · 2026-07-07 세션 크래시 복원.
> D1~D7(GCP·OAuth·YouTube 채널·인증·TTS 키·Secrets 4종) 완료, **D8 검증만 남음**(§8·§10).
> Fable 안전 라우팅이 세션 중 재차 발동 → Opus로 튕김 → **새 세션 + 이 파일로 복원**해 이어감.
> **[복원 2026-07-07 12:xx KST]** 직전 세션이 12:03 KST(커밋 `1a7e300`) 이후 API 오류로 끊김.
> 미병합 3파일(CLAUDE.md·HANDOFF.md·notebooklm-register.py)을 `session-history-loss-error-182sbo`
> 브랜치에서 복원. 유실분 재작업: ① 전역 `.claude/global-CLAUDE.md`에 "사용자 액션 안내" 규칙
> 신설 + 프로젝트/전역 양쪽에 **"안내 전 최신 UI(모바일/데스크탑 폼) 구성 확인"** 조항 추가,
> ② NotebookLM `NOTEBOOKLM_AUTH_STATE` 재발급 + register.py `async with` 버그 수정 →
> sync 재검증 **성공**(run 28839729336, Doc 2건 등록 완료). 데일리 상태파일은 main 최신 유지.
>
> **[2026-07-07 낮~오후 추가 완료 — 이 세션, 상세 개정은 추후]**
> - PR **#36** 병합: 복구 3파일 + NotebookLM async fix(월 cron 자동등록 실동작 조건 충족) + 전역 "최신 UI" 규칙.
> - PR **#37** 병합: 대시보드 **아카이브 저장 현황 섹션**(누적 표 아래, 접힘, "나만 보기"=tr_pat 게이트,
>   건별 본문출처/PDF/전문Doc 메타데이터만). REPORT_SPEC §4-E. 테스트 65건.
> - PR **#38** 병합: `.mcp.json`(`codex mcp-server`) — 클코 세션에서 **Codex 사용**.
> - **Codex MCP 셋업 완료·실검증**(새 세션 `/mcp`에 codex 도구 로드 확인). 데스크탑 Codex 로그인 →
>   `CODEX_AUTH_B64`(Default 환경 env) + setup script 설치/복원 + OpenAI 네트워크 허용.
>   문서 **`docs/codex-mcp-setup.md`**(토큰 갱신 §3). 전역 자동 규칙(모든 repo `.mcp.json` 자동)
>   `.claude/global-CLAUDE.md` "Codex MCP" 항.
>
> **[2026-07-07 저녁 추가 완료 — 이 세션]**
> - PR **#41** 병합: **codex-debate 스킬**("클코덱스 토론 시작") — codex(gpt-5.5)↔Opus 변증
>   코드리뷰 + 중립 심판 수렴 + 승인 게이트. 글로벌+로컬 단일원본(§5).
> - PR **#42** 병합: 그 스킬로 **전체 코드 토론 → 확정 8건 수정**(major 2·minor 6). 오탐 1건(F3) 기각.
>   회귀 테스트 6건 추가(test:unit 65→71). 근거 리포트 `docs/reviews/2026-07-07-2209-full-codebase-debate.md`.
> - `CODEX_AUTH_B64`가 빈 `~/.codex/auth.json`으로 시작해 401 → 스킬 프리플라이트가 멱등 시딩(재발 방지).

## 0. 한 줄 요약
`trend-review`(EM/CCM 데일리 논문 리뷰 파이프라인)를 **4-Phase 구조로 확장**했고,
Phase 2·3 코드 + On-demand 수동 디깅 + 카드뉴스까지 **main에 병합 완료**. 남은 건 코드가 아니라
**외부 설정(데스크탑 데이)**과 **샘플 승인**뿐. 병합 후 첫 자동 데일리(2026-07-06) 정상 작동 확인.

## 1. 먼저 읽을 파일 (맥락 복원용, 순서대로)
1. `REPORT_SPEC.md` — 단일 기준 문서(SSOT). §1(선정)·§1-B(On-demand)·§2(카톡)·§4-E(아카이브)·§4-F(영상).
2. `docs/superpowers/specs/2026-07-05-phase2-notebooklm-phase3-youtube-design.md` — 확장 설계 근거.
3. `docs/superpowers/plans/2026-07-05-phase2-notebooklm.md`, `...phase3-youtube.md` — 실행 계획(코드는 이미 반영됨. 문서 상단 경고대로 폐기된 초안 코드블록 존재 — `src/`가 정본).
4. `docs/desktop-day-guide.md` — **내일 PeterJ가 데스크탑에서 할 1회성 설정 8단계.**
5. **TR master plan** — **정본(SSOT) = `docs/master-plan.html`** (git). 현재 **v25**.
   Artifact(뷰) = https://claude.ai/code/artifact/757a28f8-bef7-4d5d-bc38-0dbccf747a5f
   **★ 이름·운영 규칙(PeterJ 확정 2026-07-07 — 반드시 준수)**:
   - **공식 이름 = "TR master plan"**. PeterJ가 **TR plan / 로드맵 / 마스터플랜 / 서머리 / sum** 중
     무엇으로 부르든 **전부 이 문서**를 가리킨다.
   - **★ 갱신 절차(2026-07-07 개정 — 기록 유실 방지)**: ① 저장소 원본 `docs/master-plan.html`을
     **직접 편집**(내용 갱신 + 문서 안 "버전 기록" 맨 위에 새 줄 추가, **옛 줄 삭제 금지**, 버전 라벨 올림)
     → ② **같은 아티팩트 URL로 재배포**(Artifact 도구, `url=`) → ③ **커밋·푸시**.
     — 절대 새로 만들지 말 것. 원본이 git에 있으므로 세션이 바뀌어도 그대로 읽어 편집만 한다.
     (과거엔 아티팩트만 있어 세션 간 fetch 403 → 매번 재작성·이력 유실. 이제 git 원본으로 해결.)
   - **디자인 포맷(PeterJ 확정 v18, 함부로 바꾸지 말 것)**: 파란 히어로(제목 아래 바로가기) + Phase
     1→4 파스텔 색 박스(각 카드에 6분류 개수) + 각 Phase 상세를 **6분류 세로 나열**(확정 / 진행 P-m=모바일 /
     진행 P-d=데스크탑 / 진행 C=클코 / 상의 / 특이) + 공통·인프라 블록 + 버전 기록 표. (임시 R/A/B 코드는 폐기.)
   - **작업 후 리추얼**: 규모 있는 작업을 마치면 이 문서를 갱신해 **리포트처럼 전달**.
   **정본 = `docs/master-plan.html`(git)** — Artifact는 그 렌더 뷰(세션 간 fetch 403이어도 원본 유실 없음).

## 2. 프로젝트 구조 (4-Phase, PeterJ 확정)
- **Phase 1 · Curate & Brief** (운영 중) — PubMed 6개월/최대 300편 스코어링 → 임상적용성 최고 1편 →
  Opus PICO 분석(본문>레지스트리>웹보강>초록, 환각 배제) → GitHub Pages 대시보드 + 카카오 발송.
  - **+ On-demand 리뷰(신규, 병합됨)**: 대시보드 위젯에서 키워드 검색 → 후보 클릭 → 그 논문/가이드라인
    분석. 자동 선정과 별개 경로(자체 섹션 키, "직접 지정" 배지, 하루 1편 카운트 밖).
- **Phase 2 · Archive** (코드 완료, 시크릿 대기) — OA 논문 PDF → Drive 적재 + 월별 리빙 Google Doc
  갱신(NotebookLM 자동 동기화용) + 페이월 시 근거 도시에. 하이브리드(Doc 자동 + PDF 주1회 수동 추가).
- **Phase 3 · Produce** (코드 완료, 샘플 승인 대기) — 리포트 → 영상(중간폼·숏폼) + 카드뉴스(1080×1350).
  **영어 단일 기본**(`VIDEO_LANGS=en`, 한국어는 값 하나로 확장). 수치 생성 금지·원문 그림 미사용·차트 재구성.
- **Phase 4 · Publish** (전략만 확정, 미착수) — YouTube 비공개 인큐베이터 → 품질 도달 시 공개 전환
  (과거분 재업로드) + Instagram 영어 계정. 미리보기는 Drive 적재로. 착수는 품질 도달 후.

## 3. 확정된 핵심 결정 (되묻지 말 것)
- 발신물 **영어 단일 우선**. 브리핑(카톡·대시보드)은 한국어 유지.
- YouTube/Instagram **영어 단일 계정**으로 시작(한국어 계정은 추이 보고 추가).
- 발신 전략: **유튜브 비공개 + 인스타는 품질 도달 후 개시**(인스타는 게시물/프로계정 비공개가 불가함을 확인).
- NotebookLM 아카이브(2026-07-06 개정 확정): **비공개 아카이브층은 수집 범위 확대** —
  a 분석 Doc + b′ 전문 Doc(OA PDF 텍스트 추출 append) + c 페이월 시 권위 웹 레퍼런스 본문 자동 수집.
  (구 "타인 저작물 파일 수집 금지"는 비공개층에 한해 해제 — 사적 이용 복제 범위, 입수는 합법 경로만.)
  **공개 발신물(영상·카드)은 재구성 원칙 유지**(원문 그림·표 미사용, 수치는 리포트 값만, 출처 명시).
  소스 등록(월별 새 Doc 연결)도 **notebooklm-py(비공식)로 완전 자동화** — 소프트 실패 +
  실패 시 카톡 알림·수동 폴백(월 1회 리마인더). 계정 리스크는 PeterJ가 인지·수용함.
- 자막: captions API 대신 **번인**(force-ssl 스코프 회피). SRT는 보존.
- 영상 업로드 **privacyStatus 'private' 고정**(spec-lint 강제). `ENABLE_VIDEO=true` 전엔 비활성.
- On-demand 입구: **대시보드 검색 위젯** + PubMed esearch/esummary 브라우저 직접 호출. PAT는 사용자
  브라우저 localStorage에만(저장소·페이지 소스에 없음). 백업: Actions 수동 실행.

## 4. 안전장치 = 데일리 코어 무영향 (설계 불변식)
- Phase 2/3/On-demand는 전부 **소프트 실패 + 게이트** 뒤. 시크릿 없으면 해당 단계만 조용히 스킵.
- 데일리 자동 발행 경로는 병합 전과 **바이트 동일**(위젯 추가 제외) — 병렬 리뷰로 실증.
- **증거**: 병합 후 첫 자동 데일리 `46f2dad`(2026-07-06)가 정상 작동 — 대시보드 갱신, 위젯 생존,
  분석일수 6으로 정상 증가.

## 5. 완료 상태
- 병합 완료 PR: **#24**(확장 전체) · **#25**(리뷰 5건) · **#27**(Fable 재검토 실버그 6건, §8) ·
  **#28**(모델 전환 대비 하드닝 — `ci.yml` PR 게이트 + `video-sample.yml` + 세션 리추얼) ·
  **#30**(아카이브 pmid 실버그) · **#31**(러너 ffmpeg 설치 + 부분 산출물 업로드) ·
  **#34**(R3 아카이브 자동화 — 전문 Doc·웹 레퍼런스 수집·NotebookLM 등록 자동화 + 로드맵/정책 문서).
- 단위 테스트 **35건 통과**(D8에서 아카이브 pmid 회귀 2건 추가), `npm run spec-lint` 통과.
  **PR CI 게이트 가동 중**(모든 PR에서 spec-lint+테스트 자동 강제 — 병합 전 초록 확인).
- /code-review high 1회(10) + 병합 후 병렬 재리뷰(5) + Fable 재검토(6) 반영. 데일리 회귀 0.
- **데스크탑 데이 실동작 완료(2026-07-06 오전, 이 세션)**: GCP 프로젝트 `trend-review-501602`,
  API 3종(Drive·YouTube Data v3·Cloud TTS) 활성, OAuth 동의화면 **프로덕션**(7일 만료 회피),
  데스크톱 OAuth 클라이언트, YouTube 브랜드 채널 **`TrendReviewEMCCM`**(@TrendReviewEMCCM,
  개인계정 njell85 관리), refresh token 발급(개인계정 컨텍스트로 승인 — Drive 우선), TTS 키
  발급. **GitHub Secrets 4종 등록 완료**: `GOOGLE_CLIENT_ID/SECRET/REFRESH_TOKEN/TTS_API_KEY`.
  `GOOGLE_DRIVE_FOLDER_ID`는 미등록(앱 자동 생성).
- **D8 Phase 2 검증 완료(2026-07-06 오후, 이 세션)**: on-demand 워크플로우로 SOHO 트라이얼
  (NEJM, PMID 41841715, DOI 10.1056/NEJMoa2516087)을 직접 지정 분석 → run `28769877446`
  **success**. 로그 실증: `Google 인증: env(Secrets) 경로`(Secrets 4종 실작동) · OA PDF 없음
  (NEJM 페이월, 정상 스킵) · **리빙 Doc 갱신 완료: 2026-07** · 카카오 발송 완료 · 4-B 레지스트리
  보강(NCT04468126). Drive에 앱 자동 생성 확인: rootFolder `17BmQVj…` / `2026-07` 폴더
  `1t3xruJ…` / Doc `15hUHhHz…`(`analysis_archive.json` driveState에 기록·커밋).
- **D8에서 실버그 1건 발견·수정(PR #30으로 병합 완료)**:
  아카이브 항목 pmid가 `''`로 저장 — FilterAnalyzer 성공경로가 `{...data, paper}`를 반환하는데
  LLM 툴 출력 `data.pmid`가 빈 문자열이면 `analysis.pmid ?? paper.pmid`가 폴백 못함. 데일리
  아카이브 가동 시 ① `upsertEntry` 키(date+'') 충돌로 같은 날 항목 유실 ② `pdfFiles['']`
  고정으로 OA 두 편째 오탐 스킵. 데일리 코어(카톡·대시보드는 `paper.pmid` 직접 읽음) 무영향.
  `entryPmidOf()`(paper.pmid 우선·빈 문자열은 `||` 통과)로 3개 소비점 통일 + 회귀 2건.
- 신규 파일: `src/agents/ArchiveAgent.js` `src/agents/VideoAgent.js`,
  `src/utils/{googleAuth,docBuilder,ChartRenderer,videoScript,videoRender,tts,cardNews}.js`,
  `scripts/{google-auth-setup,on-demand,video-sample}.mjs`,
  `.github/workflows/{on-demand,ci,video-sample}.yml`, `test/*.test.mjs`(7개), `docs/desktop-day-guide.md`.
- **codex-debate 스킬 완료(2026-07-07, 이 세션)**: PeterJ가 **"클코덱스 토론 시작 [대상]"**
  이라고 하면 codex(gpt-5.5)↔Opus가 대상을 독립 리뷰 후 **변증법적으로 수렴**(신규 반박 소진 or
  최대 4라운드)시키고 **중립 심판 서브에이전트**가 최종 판정·수정방안을 낸다. **수정은 승인 게이트 후**.
  · SSOT = `.claude/skills/codex-debate/{SKILL.md,codex-review.sh,report-template.md}` +
    `.claude/agents/{code-reviewer,review-judge}.md`. `env-bootstrap.sh`가 세션 시작 시 `~/.claude/`로
    복사(로컬 없으면 GitHub main 다운로드) → **전 프로젝트 글로벌**. 리포트 = `docs/reviews/`.
  · **유지보수 규칙: 저장소 원본만 수정. `~/.claude/` 사본은 세션마다 덮어써지는 파생물 — 직접 편집 금지.**
  · codex/`CODEX_AUTH_B64` 없는 환경(데스크탑 등)은 곱게 실패 + Opus 단독 폴백 안내.
  · 설계 SSOT = `docs/superpowers/specs/2026-07-07-codex-debate-design.md`, 계획 =
    `docs/superpowers/plans/2026-07-07-codex-debate.md`. E2E 검증 산출물 =
    `docs/reviews/2026-07-07-2146-dates-debate.md`(R1 수렴, src 무변경으로 게이트 준수 실증).
- **전체 코드 클코덱스 토론 → 8건 수정 완료(PR #42 병합, 2026-07-07 저녁)**: 전체 프로덕션 코드
  대상 codex↔Opus 2라운드 변증 수렴. 리포트 `docs/reviews/2026-07-07-2209-full-codebase-debate.md`.
  확정 8건 전부 수정: **F5**(FilterAnalyzerAgent — PICO 전건 실패 예외 전파, fallback 카드
  제외목록 배제), **F1**(GitHubPublisher — push 실패 폴백이 상태 JSON도 upsert, `_putFileViaApi`),
  **F9**(폴백 원격 sha 재조회+경고), **F2**(DataCollector — api_key 로그 마스킹 `scrubUrl`),
  **F4**(docBuilder — 월간 Doc P `pico.patient→population`), **F6**(retryPipeline — `delayMs>=0`
  게이트), **F7**(orchestrator — 제외 PMID dedup), **F8**(KakaoNotifier — access token 실행 내 캐시).
  오탐 **F3**(fetch 무한 hang — undici 기본 타임아웃 존재)은 변증으로 기각·미수정. 회귀 테스트 6건
  추가(`test/{retryPipeline,picoFailure}.test.mjs` + docBuilder P), test:unit **71 pass**·spec-lint 0·dry-run 정상.
  데일리 코어 불변식 무영향.
- **2주 트랙 비교 실험 구현 완료(2026-07-11, main 병합)**: Arm1(현행 파이프라인 오늘 픽 재사용) vs
  Arm2(Opus 웹서치 자체선정 → PMID 검증 → 동일 `_analyzeSinglePaper` PICO)를 매일 나란히 누적.
  신규: `src/experiments/{trackCompare,compareRender}.js`, `scripts/compare-tracks.mjs`,
  `.github/workflows/compare-tracks.yml`, `test/{trackCompare,compareRender}.test.mjs`(신규 24 테스트, test:unit **100 pass**·spec-lint 0).
  데일리 코어 무접촉(`analysis_archive.json` 읽기만, `experiments/`만 커밋, 별도 워크플로우). 전 구간 소프트 실패.
  게시 = `experiments/compare.html`(같은 Pages 별도 URL). 서브에이전트 8-task TDD, 최종 whole-branch 리뷰 READY TO MERGE.
  스펙 `docs/superpowers/specs/2026-07-11-track-comparison-experiment-design.md`, 계획 `.../plans/2026-07-11-track-comparison-experiment.md`.
  **시작 대기**: PeterJ가 Variables `ENABLE_TRACK_COMPARE=true`·`TRACK_COMPARE_END=<시작+14일>` 설정 → 수동 dispatch 스모크 → 매일 08:00 KST 자동. Arm3(ChatGPT)는 2주 뒤 리스트 복붙 병합.

## 6. 남은 일 (우선순위) — 상세 착수 절차는 §10
0. ~~데스크탑 데이 D1~D7~~ **완료**(§5). 남은 건 D8 검증(§10-1) — 데스크탑 불요, 제가 트리거.
1. **D8 Phase 2 검증** (on-demand 워크플로우, PeterJ가 PMID 제공) — §10-1.
2. **NotebookLM 노트북 연결**(M1) + **On-demand 검색 폰 확인**(M2): 키워드 검색이 뜨는지
   (=PubMed CORS). 안 되면 대안(검색을 워크플로우로) — 미구현, 필요 시 착수.
3. **영상·카드 샘플 승인**(M3): `video-sample.yml` workflow_dispatch → Artifacts 다운로드 →
   시청 → 만족 시 Variables `ENABLE_VIDEO=true`. (수동 폴백: `node scripts/video-sample.mjs`)
4. **Phase 4 착수**(품질 도달 후): 공개 개시 기준·인스타 소프트런칭·한국어 계정 추가 시점 결정.

## 7. 열린 결정 (급하지 않음)
- ~~수동 지정분도 영상·카드까지 만들지~~ → **P2 선별 승격으로 확정**(2026-07-06, §10-P2):
  데일리/수동 불문 "자료화" 버튼 누른 것만 영상·카드 + 비공개 업로드.
- 카드뉴스 최종 사양(장수·정사각 vs 세로).
- Phase 4: 공개 개시 판단 기준 / 전체 자동 영상화 전환 시점(안정화 후, 설정값 하나로).
- **entry.fullText가 공개 repo에 커밋됨**(analysis_archive.json, #24부터 — OA 본문 최대 1만 자).
  §3 비공개층 원칙과 긴장: 유지(분석 Doc 재생성·R5 대본 컨텍스트에 사용) vs 전문 Doc append 후
  제거(공개 재배포 노출 축소). **PeterJ 결정 필요** — R3 리뷰에서 표면화(2026-07-06).
- 후속 정리 후보(P3): ① ArchiveAgent의 Drive find-or-create 5중복 → 헬퍼 통합
  ② verify-pages 잡의 불필요 npm ci 제거 ③ docBuilder.esc↔GitHubPublisher.esc 중복 통합
  ④ chromium launch 3중복(videoRender·cardNews·preview) 통합(R5 때 겸사) ⑤ 전문 Doc
  append의 export+재업로드 O(n²) → Docs API batchUpdate 전환(월말 Doc 수 MB 시).

## 8. 진행 중이던 것 → 완료 (Fable 재검토, 2026-07-06)
- Fable 세션에서 **전체 재검토 완료**: VideoAgent·ArchiveAgent·on-demand 위젯/스크립트·
  tts·videoRender·cardNews·googleAuth·docBuilder·ChartRenderer 전부 정독. 실버그 6건
  발견·수정 → **PR #27 병합**. 핵심: ① drive.file 스코프는 수동 생성 폴더 접근 불가
  (가이드 6-b 함정 — 자동 생성 폴백으로 해소), ② Drive 실패 시 아카이브 항목 영구 결번
  (선저장으로 해소), ③ 위젯이 배포 페이지에서 영구 동결(버전 마커+교체로 해소),
  ④ on-demand.yml 셸 인젝션, ⑤ 영상 재실행 시 LLM·TTS 재지출 + 거짓 "일부 실패" 경고,
  ⑥ TTS 키 URL 노출면. ffmpeg 인자·경로, PAT 저장 방식, docBuilder/카드 이스케이프,
  KakaoNotifier·FilterAnalyzer 필드 정합은 **문제 없음 확인**.
- 계획(4-Phase) 비판 검토 결론: 구조는 건전(소프트 실패 격리·게이트). 남은 약점은
  ① 검증이 데스크탑 데이 하루에 몰림(§6-1 그대로 진행하되 8번 검증을 순서대로),
  ② on-demand 발행엔 Pages 배포 검증(verify-pages)이 없음 — 위젯 안내대로 "수 분 후
  새로고침"이 안 되면 Actions 로그 확인, ③ VIDEO_LANGS=en이어도 대본은 ko·en 둘 다
  생성(LLM 토큰 소폭 낭비 — 언어 확장 대비 의도적 트레이드오프, 유지).
- 미검증 잔여(코드로 확정 불가): 위젯의 PubMed CORS(폰 확인, §6-2), NotebookLM
  자동 동기화 실동작(§6-1 데스크탑 데이 8번).

## 10. ★ 다음 세션 착수점 (여기서 이어서 시작)

> **[2026-07-11] 트랙 비교 실험(Arm1 vs Arm2) 구현 완료 — 시작 대기**
> 2주 무인 A/B: Arm1(프로덕션 픽 재사용) vs Arm2(Opus 웹서치 자체선정+동일 PICO).
> 코드·워크플로우 main 병합됨. **시작하려면 PeterJ가 Variables 2개 설정**:
> `ENABLE_TRACK_COMPARE=true`, `TRACK_COMPARE_END=<시작+14일, 예 2026-07-25>` →
> compare-tracks 워크플로우 수동 dispatch로 스모크 → 이후 매일 08:00 KST 자동.
> 결과: https://njell85-spec.github.io/trend-review/experiments/compare.html
> Arm3(ChatGPT)는 2주 뒤 PeterJ가 리스트 복붙 → arm3-list.json 병합·재렌더.
> 스펙: docs/superpowers/specs/2026-07-11-track-comparison-experiment-design.md

> **[2026-07-10 세션 마무리 — 다음 세션은 여기부터]**
> **논문 선정 개편(Phase A) 구현·프로덕션 반영 완료. 지금은 "며칠 데일리 트렌드 관찰" 대기.** 마스터플랜 **v20**.
>
> **한 일 (전부 main 병합 + rerank 데일리 활성):**
> - **3층 선정 파이프라인 완성**: 결정적(주제+저명저널) → 상위 K편(RERANK_POOL 기본 20) →
>   **Opus rerank(침상 임상가치)** → 1편 → 기존 PICO. rerank는 **소프트**(실패/AUP거부/빈결과 시
>   결정적 순위 유지) + 게이트 `ENABLE_RERANK`(daily-review.yml 기본 on, `vars.ENABLE_RERANK=false`로 끔).
> - **PeterJ 선정 기준 확정(2026-07-10)**: ①관심주제 부합 ②저명저널. 둘 다 메타로 계산 가능 →
>   결정적 스코어러가 주제·저널을 지배적으로(각 0~4), 설계·최신성·표본은 보조(~3), **관심 0매칭이면
>   배제(topicGatePenalty)**. "연구 성격"(이송역학·원격모니터링·증례·리뷰) 변별만 LLM rerank 몫.
> - **파일**: `config/interests.json`(관심주제 9그룹+trauma+방법론/이송/원격/역학 감점+scoring),
>   `config/journals.json`(신설, 분야 Q1 저널 등급 — EM/CCM 저명지 정당대우, Sci Reports/Medicine/BMC
>   등 감점; **폰에서 숫자만 고쳐 튜닝**), `MetadataScorer`(재설계+증례 -1.5),
>   `FilterAnalyzerAgent._rerankSelect`(LLM rerank), `daily-review.yml`(ENABLE_RERANK on),
>   `test/metadataScorer.test.mjs`(회귀 6건, 총 77 pass).
> - **실측 검증(Actions, 브랜치 ref)**: 오늘 300편 → 결정 1위 Cefazolin/NEJM, rerank 최종 1위도
>   **Cefazolin**(300편 LLM 풀스크린 1위와 수렴). 실패픽(07-09 인지재활·07-10 family syndrome) 제거.
>   결정 #3 미세순환 기전연구(8.7)→rerank #15, 리뷰·관찰 3~4점 강등, RCT·실무개입 상위 독점. 429 0건.
> - **실험 도구 상시화**: `selection-experiment.yml`(수동) — `EXP_LLM=0`(결정 재랭킹), `EXP_MODE=rerank`
>   (결정 top-K→LLM 재순위), 기본(recall 진단). 재검증은 브랜치/main ref로 dispatch.
>
> **다음 세션/PeterJ 대기 (여기부터):**
> 1. **며칠 데일리 픽 트렌드 관찰** → PeterJ 피드백. 조정은 대부분 **`config/*.json` 숫자 수정**으로
>    (세션 없이 폰에서). 코드 변경 필요한 것: RERANK_POOL 크기, rerank 프롬프트 문구, 감점 강도 등.
> 2. **관심 키워드는 아직 초안** — PeterJ가 추후 추가/배제/가중 조정 예정(그때 config 반영).
> 3. **남은 큰 작업(미착수)**: Phase B = 주1회 **가이드라인 선정**(`GuidelineAnalyzerAgent`·주간 게이트)
>    실동작 관측 후 개편. R5 영상·카드 품질(HANDOFF P1)도 여전히 대기.
> ※ GPT 교차검증(원안 L4)은 보류 — 결정적+rerank로 충분한지 트렌드 보고 판단.

> **[2026-07-09 세션 — 논문 선정 진단·설계]**
> **주제: 논문 선정 품질 개편(Phase A) — 설계·진단 단계. 프로덕션 코드 미변경.** 마스터플랜 **v19**.
> PeterJ 문제제기: "논문 선정 퀄이 낮다." 원안 = 메타 기준 촘촘화 + 10편 스크리닝 → Opus가 10편
> 검토·1편 선정 → Opus 분석 → GPT 교차검증 → 리포트.
>
> **확인된 사실 (커밋·실측 근거):**
> - 현행 선정에는 **LLM 판단이 0**. `MetadataScorer`(결정적 휴리스틱)가 300편 채점 → rawScore
>   최고 1편 **기계 선정**(`FilterAnalyzerAgent._selectTopPapers` `.slice`). Opus는 **이미 뽑힌**
>   1편 PICO에만 관여 → "임상적으로 이게 최선인가"를 아무도 안 읽음 = **저품질의 구조적 원인**.
> - **"300편 배치가 AUP로 거부됐다"는 확정 사실 아님.** 커밋 실측(2026-06-29~07-01): 진단이 4번
>   뒤집힘(harness 문서 B3 "오진→땜질→표류"). 배치 폐기 커밋 `82fb2d0`는 사유로 AUP를 들었으나
>   **직전** 근본원인 규명 `b8faf6a`(#2)은 AUP가 아니라 **429 세션 한도**였다("not a GitHub…as an
>   earlier alert had guessed"). AUP 오탐 신호는 실재했으나(`c33e08d`) 429와 **분리 검증 안 된 채**
>   "배치 불가"로 묶여 폐기됨. → 원 병목은 **429(300편 토큰 과다)** 가능성 큼.
> - **실측(이 세션): 실제 논문 13편을 폐기된 배치 채점 경로(`_scoringTool`)로 claude CLI(구독)에
>   돌림 → 13/13 성공·59초·AUP 거부/429 없음.** 채점 품질도 정확히 빠진 그 판단(QI·AI·원격모니터링
>   논문을 침상 임상가치로 하향, PE RCT 상향). → **"LLM은 선정에 못 쓴다" 전제 붕괴.**
>   ※ PubMed은 이 세션 환경에서 **완전 차단**(`http=000`, §11 명시) — 신선 수집·대규모 실험은 Actions에서.
>
> **확정 방향 (PeterJ 합의):**
> - **retrieve-then-rerank**: 결정적 프리필터(싼 고recall) → 상위 **K편만** Opus 정독·선정(고정밀).
>   300편 전량 LLM 스크리닝은 **비권장**(비용·429↑, 이득은 상위 변별에 집중, 하위는 메타가 이미 처리).
> - **K는 감이 아니라 실측(recall@K)으로 확정** — "결정적 top-K가 LLM이 전량에서 고를 1편을 담나".
> - **메타 기준 촘촘화 = 실험과 한 몸.** 실험이 "결정적이 오판해 떨군 좋은 논문 목록"을 주고 그게
>   튜닝 타깃(감으로 조이지 않음). 즉 원안 1·2번은 분리 작업이 아니라 하나.
> - **GPT 교차검증 = 2단계 옵션**(우선 Claude 단독으로 선정 품질부터, 효과 확인 후 OpenAI 키·비용
>   결정). `openai` provider는 이미 코드에 있음(`LLMClient`). 자동 데일리엔 `OPENAI_API_KEY` **미설정**.
>
> **다음 세션 착수점 (구체):**
> 1. **recall@K 실험 워크플로우 작성**(임시·브랜치 한정·**데일리 코어 무영향**) — **Actions에서 실행**.
>    실제 300편 수집 → LLM 청크(30~50편) 풀스크린(부산물: "청크 풀스크린 429 여부" 확인) →
>    **recall@10/20/50 표 + 오판 논문 목록** 산출.
> 2. **Ground truth = (B) 가벼운 버전**(PeterJ 승인 대기): 실험이 **LLM top-5**를 먼저 뽑아 오면
>    PeterJ가 폰에서 "이 정도면 신뢰" 확인 → 그다음 recall@K. (LLM 재순위가 설계 심장 → 1회 눈 검증.)
> 3. 실험 결과로 **K·메타 튜닝 확정** → 설계 spec(`docs/superpowers/specs/`) → 계획 → 구현.
> **Phase B(그다음): 주1회 가이드라인 선정**(`GuidelineAnalyzerAgent`·주간 게이트) 실동작 관측 후 개편.

> **[2026-07-07 세션 마무리]**
> R1~R4 완료. 오늘 **#36~#39 병합**: ① 세션 복구 ② NotebookLM async fix(월 1회 cron 자동등록
> **부활**, 폴백 아님) ③ 대시보드 **아카이브 저장현황 섹션**(#37, `src/utils/archiveStatus.js`)
> ④ **Codex를 Claude Code에서 사용**(MCP 연동·실검증·전역 자동, #38·#39).
> **다음 큰 작업 = R5 영상·카드 품질 개선**(아래 P1 절차). 착수 전 PeterJ 폰에서 **R5 불만 항목 청취**(B3).
> Codex 사용 가능 — 막히면 "codex 문서 불러와"(→ `docs/codex-mcp-setup.md`, 토큰 갱신 §3).
> **마스터플랜 최신 = v16**(§1-5, 같은 URL). 모든 작업 main 병합·CI 초록·working tree clean 상태로 종료.

**상태**: **D1~D8 + A1·A2 완료**(§5·아래 A). **샘플 1차 검토 완료(2026-07-06, PeterJ):
생성 자체는 성공했으나 디자인·내용·자막·구성 전반 품질 미달로 승인 보류** —
`ENABLE_VIDEO`는 계속 미설정(기본 비활성). PR #30·#31·#32 병합 완료.

### ★ 확정 로드맵 순서 (PeterJ 확정 2026-07-06 저녁 — P1·P2 우선순위 재배열)
R1 **on-demand 실증**(PeterJ: PAT 발급·위젯 클릭 → 세션: run 확인) → R2 **NotebookLM 연결**(B1)
→ R3 **아카이브 자동화 구현** ~~(코드)~~ **구현 완료(2026-07-06 저녁 세션, PR 대기)** —
b′ 전문 Doc(`fulltextDoc.js`+ArchiveAgent append-only) + c 웹 레퍼런스 수집(`webRefText.js`) +
`notebooklm-sync.yml`(월 1일 notebooklm-py 등록 + 카톡 리마인더 폴백) + REPORT_SPEC §4-E 개정.
계획: `docs/superpowers/plans/2026-07-06-r3-archive-automation.md`. 테스트 42건 통과.
**잔여**: ~~PeterJ 셋업(아래 B5)~~ 완료 → 07-07 데일리 후 dispatch 실검증만 → R4 **큐레이션 버튼 2종**(P2)
→ R5 **영상·카드 품질 개선**(P1). ※ R5 전에 자료화 버튼 본격 사용은 자제(저품질 영상 누적+비용)
— R4 완료 후 동작 확인 1~2건만.
- **R4 경과(2026-07-06 저녁)**: 이전 세션이 R4를 구현 완료했으나 **push 전 세션 에러로
  컨테이너와 함께 유실**(로컬 커밋 5개 — 원격 미존재 확인). 교훈: 미리보기 승인 대기 중에도
  세션 지정 브랜치에 push는 해둘 것(승인 전 병합만 안 하면 /preview 규칙 충족).
  현 세션에서 PeterJ 추가 요구 반영해 재착수: **자료화 여부 상태 표시** 추가, 배치는
  **카드+표 양쪽 모두**로 확정(PeterJ 2026-07-06 밤). **본구현 완료 + 실렌더 미리보기
  승인 + 서브에이전트 리뷰 6건(C1 치명 포함) 반영 완료** — 계획: `docs/superpowers/
  plans/2026-07-06-r4-curation-buttons.md`, 스펙: REPORT_SPEC §4-G. 테스트 58건.
  **PR #35 병합 완료(2026-07-06 밤, PeterJ 직접 머지) + 라이브 배포 반영(CURATION_BLOCK
  v4)**. 07-07 데일리가 병합 후 정상 실행(run success) — 새 `_applyCuration` 경로
  통과에도 데일리 코어 회귀 0(불변식 유지 실증). PeterJ 실사용 피드백 대기 →
  포맷 수정사항 나오면 반영. ※ 자료화 버튼 본격 사용은 R5(품질) 후 — 지금은 1~2건 확인만.

### P1 · 영상·카드 품질 개선 (승인 게이트 재도전) — 로드맵상 R5
- **품질 레버 노트(2026-07-06 확인)**: 현재 대본 생성 입력은 리포트 필드(PICO·keyFindings 등)만
  — `buildScriptMessages()`가 아카이브 항목의 fullText·dossier를 안 씀. R5에서 이를 대본
  프롬프트의 **추가 컨텍스트**로 넣으면 내용 풍부화 가능("새 수치 생성 금지" 규칙은 그대로).
- **R5 필수 요건(PeterJ 2026-07-06)**: 레퍼런스 전 채널 병기(REPORT_SPEC §4-F) — 영상 설명·
  마지막 슬라이드·카드 마지막 장에 참조 링크(references) 표기 구현.
- **작업 성격: 템플릿·렌더링 코드 개선**(§11 지침 안에서 가능) — 대상 파일:
  `src/utils/videoRender.js`(슬라이드 HTML/CSS 템플릿·ffmpeg 자막 번인 스타일),
  `src/utils/cardNews.js`(카드 레이아웃), `src/utils/videoScript.js`(대본 생성 프롬프트의
  **구성 지시부** — 슬라이드 수·문장 길이·구조. 단 "새 수치 생성 금지" 문구는 spec-lint
  강제라 유지), `src/utils/ChartRenderer.js`(차트 스타일).
- **절차(2026-07-06 개정 — 2단계 미리보기 루프)**: ① PeterJ에게 구체 불만 항목 청취
  (디자인/내용/자막/구성 중 무엇이 어떻게 — 항목당 2~4개 보기 선택형 권장) →
  ② 개선 계획 짧게 제시·합의 → **②-b 더미(플레이스홀더) 데이터로 슬라이드·카드 PNG를
  세션에서 직접 렌더해 폰으로 선승인**(슬라이드는 chromium HTML 스크린샷 방식이고 원격
  세션에 Chromium 사전 설치 — PR·CI·LLM·TTS 없이 몇 분 내 반복, 더미 텍스트라 §11 준수) →
  ③ 세션 지정 브랜치에 작은 커밋 + spec-lint/테스트 → ④ PR CI 초록 → 병합 →
  ⑤ `video-sample.yml` 재트리거 → Artifacts 링크 전달 → ⑥ PeterJ 시청 → 피드백 반복.
  **승인 전 `ENABLE_VIDEO` 설정 금지.**
- 1차 샘플 실물: A2 링크(아래) — 개선 전 기준점으로 참고.

### P2 · 대시보드 큐레이션 버튼 2종 (PeterJ 확정 2026-07-06) — 로드맵상 R4 (P1보다 먼저)
- **운영 플로우(확정)**: 데일리 + 필요 시 On-demand로 페이지 구성 → PeterJ가 페이지에서
  ① **삭제 버튼**(별로/번잡한 항목 정리), ② **자료화 버튼**(누른 것만 카드뉴스·영상 생성 +
  YouTube **비공개** 업로드). Phase 2(Drive Doc·NotebookLM)는 지금처럼 **전량 자동 누적** 유지.
- **경계(합의)**: 삭제 = 대시보드 표시 제거만(Drive Doc·제외목록 유지 — 재선정 방지).
  자료화 = 생성+비공개 업로드까지 한 번에(privacyStatus private 고정이 안전망).
  전역 자동 영상화(ENABLE_VIDEO 상시)는 안정화 후 옵션으로 보류 — **지금은 선별 승격으로
  품질 컨펌**. 자료화 버튼은 나중에 자동 모드에서도 "예외 승격" 용도로 존치.
- **구현 방식**: 기존 검증된 프레임 재사용 — 버튼 → PAT(localStorage)로 workflow_dispatch →
  Actions가 수정·커밋. 삭제는 섹션 키 단위 HTML 블록 제거 + 상태파일 숨김 목록 기록.
  주의: 데일리와 커밋 경합(concurrency 그룹+재시도), 삭제 확인 단계 1회.
- **선행 조건**: R3(아카이브 자동화) 완료 후 착수(로드맵 재배열로 P1 승인보다 먼저).
  REPORT_SPEC §4-F 운영 모드 문구 갱신 동반(spec-lint 고정 문구 2종은 불변).

### A. 새 세션 Fable이 무인으로 할 수 있는 것
- ~~A1 · 아카이브 pmid 실버그 PR 병합~~ **완료** — PR #30 병합(squash `8866b46`).
- ~~A2 · 영상/카드 샘플 생성~~ **완료** — 1차 run `28770767478` 실패(ffprobe ENOENT,
  러너에 ffmpeg 기본 미포함) → **PR #31**(ffmpeg 설치 스텝 + Upload `if: always()`) 병합
  (`240fb36`) → 재실행 run `28772142066` **success**. Artifacts `video-samples-2`
  (9파일 · 9MB · 7일 보관, ~07-13 만료):
  https://github.com/njell85-spec/trend-review/actions/runs/28772142066/artifacts/8101326827
  시청·승인(B3)은 PeterJ 몫.
- **A3 · 데일리/아카이브 관찰**: 다음 자동 데일리(07-07 06:30 KST) 실행 결과를 job summary/
  로그로 확인해 회귀 0 + 아카이브 단계 실동작 보고. (env 주입 여부는 **정적 확인 완료** —
  daily-review.yml 83~87행에 GOOGLE_CLIENT_ID/SECRET/REFRESH_TOKEN/TTS_API_KEY +
  GOOGLE_DRIVE_FOLDER_ID 이미 주입돼 있어 후속 코드 작업 불필요. 남은 건 로그 관찰뿐.)

### B. PeterJ가 폰으로 해야 하는 것 (자동 불가 — Google 로그인·시청·승인)
- ~~B1 · M1 NotebookLM 연결~~ **완료(2026-07-06 저녁)**: 노트북 `Trend-review` 생성,
  분석 Doc 소스 연결, 질문 1건에 인용 마커 달린 응답 확인(R2 완료).
- ~~B2 · M2 위젯 폰 확인~~ **완료(2026-07-06 저녁)**: Fine-grained PAT 발급
  (Actions R/W 한정, **No expiration** — PeterJ 위험 수용, 유출 시 revoke+재발급이 대응책)
  → 폰 브라우저 2개(삼성인터넷·크롬) 등록, 태블릿은 추후. 위젯 클릭 →
  on-demand run `28788944742` dispatch 실증(R1 완료).
- **B3 · M3 샘플 승인**: ~~1차 시청 완료~~ → **보류**(품질 미달, P1로 개선 후 재도전).
  개선판 재생성 때마다 시청 → 만족 시에만 Variables `ENABLE_VIDEO=true`. 승인은 사람 판단 게이트.
- **B4 · M4 관찰**: 이상 없으면 7일 무개입 관찰.
- ~~B5 · NotebookLM 자동 등록 셋업(R3 잔여)~~ **셋업 완료(2026-07-06 저녁, 데스크탑)**:
  notebooklm-py 설치·`notebooklm login` 성공(Windows, Python 3.12.10 신규 설치·
  playwright chromium 별도 다운로드 필요했음) → Secret `NOTEBOOKLM_AUTH_STATE` +
  Variables `NOTEBOOKLM_NOTEBOOK_ID` 등록.
  - **실검증 결과(2026-07-07 낮 복원 세션) — 자동 등록 부활 ✅**: PeterJ가
    `NOTEBOOKLM_AUTH_STATE` 재발급 + register.py `async with` 버그 수정(아래) 후
    run `28839729336`에서 분석 Doc(`15hUHhHz…`)·전문 Doc(`1t1XkK4D…`) **2건 모두
    `등록 완료`**, 카톡 리마인더 폴백은 **skip**(불필요). 즉 자동 동기화 경로 실동작.
  - **직전 "실패"의 진짜 원인 = 인증 만료 아님, 코드 버그**: main에도 있던 선재 버그로
    `client = await NotebookLMClient.from_storage(...)`가 HTTP 커널을 초기화 안 해
    `add_url`에서 `RuntimeError: Client not initialized`로 죽었다(진단의 "만료됨 2개"는
    비핵심 쿠키 오탐 — `from_storage`는 재발급분을 정상 통과). `async with … as client:`로
    수정(복구 브랜치 커밋 `b481c03`).
  - **미결(권장) — main 병합 필요**: 이 fix는 현재 `claude/recover-previous-session-t0l4tb`
    에만 있음. **main에 병합해야 매월 1일 cron 자동 등록이 실제 동작**한다(안 하면 cron은
    여전히 버그 → 리마인더 폴백으로만). 운영 모드 = **자동 등록 복귀**(실패 시 카톡 리마인더 폴백 유지).

### 주의 (자동 세션·사람 공통)
- §3 확정 결정 되묻지 말 것. §4 데일리 코어 무영향 유지. 대시보드/알림 포맷 변경 시 push 전 /preview.
- YouTube 업로드는 승인 계정이 개인계정이라, 나중에 영상 켰을 때 403(channelNotFound) 나면
  `google-auth-setup.mjs` 재실행해 **브랜드 채널 컨텍스트로 재승인**(가이드 문제해결 참고).
- **Fable 안전 라우팅 주의**(§0·§7): 과거 이 프로젝트 작업 중 Fable→Opus 강제 전환이 있었다.
  새 Fable 세션이 중간에 튕기면 이 파일 하나로 복원해 이어가면 된다(§1 순서).

## 11. ★ 새 세션 운영 지침 — Fable 안전 라우팅 회피 (중요)
이 저장소는 의료(EM/CCM) 도메인이라, **세션이 직접 임상 내용을 생성·해석하면** Fable의
의료/이중용도 안전 계층이 자극돼 세션이 튕길 수 있다(과거 반복 발생, §0·§7). 회피 원칙:

- **세션 = 인프라 오케스트레이션 전용.** 세션이 하는 일은 워크플로우 트리거(GitHub MCP),
  PR 생성·CI 확인·병합, 파일 커밋/푸시, 로그·job summary 확인, 상태 파일 점검뿐이다.
- **임상 내용은 세션이 만지지 않는다.** 논문 초록 요약, 치료효과·사망률·용량 등 수치 해석,
  "어떤 치료가 낫다"류 판단·권고는 **전부 자동 파이프라인(claude CLI/API)** 이 담당한다.
  세션은 그 산출물(리포트 JSON·대시보드·아카이브)을 **내용을 읽어 해석하지 말고 기계적으로
  전달·발행**만 한다. 논문은 식별자(PMID/DOI)로만 참조한다.
- **PubMed 실조회를 세션에서 하지 않는다.** 검증용 논문이 필요하면 지어내지 말고 PeterJ에게
  PMID/DOI를 받는다(이 원격 환경은 어차피 PubMed 직접 접근이 막혀 있음).
- 튕겨도 손실 없음: 세션 작업은 전부 커밋으로 남고, 이 파일 하나로 복원해 이어가면 된다(§1).

## 9. 프로젝트 규칙 (CLAUDE.md 요지)
- 호칭 **PeterJ**, **존댓말**. 결론부터, 확인/추측 구분.
- 작업 마무리 시 commit+push. 리포트·발송·대시보드 변경 전 `REPORT_SPEC.md` 필독.
- 대시보드/알림 메시지 포맷 변경은 push 전 **/preview 스킬로 미리보기 승인**.
- 커밋 전 `npm run spec-lint` 통과. 규모 있는 변경은 `/code-review`.
- 병합된 PR은 재사용 금지 — 후속 작업은 main에서 브랜치 새로 파서.
