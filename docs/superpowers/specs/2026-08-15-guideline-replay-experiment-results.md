# 가이드라인 개편 — 30일 창 3개 재생 실험 결과

> 실행: GitHub Actions `guideline-backfill.yml` run **31896189604** (main `7d46c3ae`), LLM 0.
> 설계는 같은 폴더 `...-replay-experiment-design.md`(Fable 판정). 그 설계가 정한 것만 결론으로 삼는다.

## 결과표

| 창 | 기간 | 후보 | queued | needsReview | rejected | 초집합 위반 | 앵커 재현율 | 큐 지속일 |
|---|---|---|---|---|---|---|---|---|
| W1 60-30 | 2026/06/16~07/16 | 15 | **1** | 14 | 0 | **없음** | 100% | 0.03 |
| W2 150-120 | 2026/03/18~04/17 | 31 | **0** | 28 | 1 | **없음** | 100% | 0 |
| W3 240-210 | 2025/12/18~01/17 | 20 | **5** | 15 | 0 | **없음** | 100% | 0.17 |
| 합 | 90일 | 66 | **6** | 57 | 1 | 0 | 100% | — |

정지 신호 **2건** — 둘 다 ④(needsReview 적체): W2 28건 · W3 15건.

## 판정 (설계 §2 의 세 결론만)

### ① 초집합 — **통과**

세 창 모두 위반 0. PT 쿼리가 찾은 것을 확장 경로가 **하나도 놓치지 않았다.**
앵커(`PT ∩ tier-1`) 재현율 100%. 최우선 정지 신호는 발동하지 않았다.

### ② 큐 순도 — **통과 (오탐 0/6)**

`queued` 6건 **전수** 감사. 설계 §3 대로 판정 이유를 가리고 제목만 먼저 봤다.

| PMID | 기관 | p | 무엇인가 | 판정 |
|---|---|---|---|---|
| 42409761 | sccm | 10.8 | Consensus Recommendations for Clinical Pharmacist Integration into the Acute Stroke Care Team (ACCP·NCS·SAEM·SCCM 공동 승인) | 진짜 |
| 41122862 | aha | 9.8 | Part 8: Pediatric Advanced Life Support — 2025 AHA/AAP Guidelines | 진짜 |
| 41122855 | aha | 9.8 | Part 5: Neonatal Resuscitation — 2025 AHA/AAP Guidelines | 진짜 |
| 41122852 | aha | 9.8 | Part 6: Pediatric Basic Life Support — 2025 AHA/AAP Guidelines | 진짜 |
| 41122859 | ilcor | 9.8 | Pediatric Life Support: 2025 ILCOR CoSTR | 진짜 |
| 41122837 | ilcor | 9.8 | Neonatal Life Support: 2025 ILCOR CoSTR | 진짜 |

명백한 오탐 0건 → 정지 신호 ②(≥2건) 미발동. **자동 발행 배선 자체는 막을 이유가 없다.**

> **곁가지 발견**: 42409761 은 2026-07-15 에 **논문 트랙(Arm1)이 그날의 논문으로 고른** 바로 그
> 문서다. 지침인데 논문 경로로 새어 들어갔던 것 — 개편이 이것을 제자리로 돌린다.

### ③ 미탐 — **1건 발견, 고쳤다**

`rejected` 표본 감사에서:

```
41700745  Executive summary of the Brain Trauma Foundation Guidelines for the
          Management of Penetrating Traumatic Brain Injury, Second Edition.   → rejected
```

지침의 **공식 요약본은 지침 그 자체의 일부**인데 `summary of the` 패턴에 걸렸다.
해설·요약 부류를 기각에서 **`needsReview` 격리**로 내렸다(설계 §6.5 그대로).
같은 실험을 다시 돌려 회수를 확인했다 — **W3 rejected 1 → 0, needsReview 14 → 15.**
남은 기각 1건(EUSEM-QI Delphi consensus process 연구)은 정확한 기각이다.

### ④ 큐 깊이 — **★ 정지 신호 발동. 매일화는 아직 의미가 없다**

- 90일에 자동 발행 후보 **6건** = 약 **15일에 1편**. "매일 시도"의 대부분이 skip 이 된다.
- 현행 주 1회 게이트는 90일에 약 13편이므로, **수집을 넓혔는데 발행 빈도는 오히려 준다.**
- 반대로 `needsReview` 는 90일에 **57건**(창당 14~28) 쌓이는데 **소진 경로가 없다.**

즉 병목은 "그물이 좁다"가 아니라 **"넓힌 그물이 잡은 것 대부분이 사람 판단을 기다린다"** 이다.

## 그래서 무엇을 하나

1. **자동 발행 게이트(`ENABLE_GUIDELINE_AUTOPUBLISH`)는 계속 꺼 둔다.** ②는 통과했지만
   ④가 걸렸다 — 켜도 15일에 한 편이라 얻는 것이 적고, 먼저 볼 것은 관찰 데이터다.
2. **다음 병목은 두 가지다.**
   - **검토함 소진 경로** — PeterJ 가 `needsReview` 를 훑어 승인/기각하는 입구가 필요하다.
     지금은 `guidelines.html` 에 목록만 보인다. on-demand 승인과 이어 붙이는 것이 자연스럽다.
   - **G5 기관 sources** — 후보가 아직 PubMed 에서만 온다(기관 9곳 전부 `unconfigured`).
     학회 사이트를 붙이면 후보 자체가 는다. 실물 selector 검증은 네트워크가 되는 곳에서.
3. 가중치·임계값은 **아직 건드리지 않는다.** ②가 통과했으므로 조정할 근거가 없다.

## 이 실험이 말하지 않는 것

- **"어느 쪽이 더 좋은 지침을 골랐나"는 묻지 않았다.** 사람 라벨이 없기 때문이고,
  19일 트랙 비교 실험이 정확히 그 이유로 폐기됐다.
- 감사자가 분류기를 만든 쪽과 같다. 블라인드·증거 보존으로 완충했을 뿐 순환이 0 은 아니다.
- W1(최근 창)의 후보가 15건으로 가장 적다 — MeSH·PT 지연 편향이 그대로 보인다.
  창을 셋으로 나눈 이유가 이것이고, W2·W3 이 그 편향 밖의 값을 준다.
