# On-demand 범용 참고자료 모드 (`kind=reference`) — 실행 계획

> 발단: PeterJ 2026-08-06 — "공인된 사이트는 아니지만 직접 열어보고 레퍼런스 괜찮다 판단해서
> 링크를 넣으면 동일하게 분석 리포트를 작성하는 것"이 되면 좋겠다.
>
> 현행 제약(실측): `scripts/on-demand.mjs:38` 이 URL 입력을 `kind=guideline` 에서만 받는다.
> 따라서 어떤 URL을 넣든 **가이드라인 캐치업 브리프 형식**(핵심 권고 / 이전 판 대비 변경점 /
> 임상 임팩트)으로 나온다. 가이드라인이 아닌 참고자료에는 "변경점" 축이 무의미하고,
> 무엇보다 **출처의 성격·신뢰도를 카드가 말해주지 않는다.**

## 1. 목표와 비목표

**목표**
- `kind=reference` 신설. **URL·PMID·DOI 전부** 받는다(가이드라인은 URL·PMID·DOI, 논문은 PMID·DOI).
- 가이드라인도 논문(PICO)도 아닌 **범용 요약 카드**를 낸다.
- **출처 성격을 카드가 명시한다** — 이게 이 모드의 핵심 안전장치. PeterJ가 "공인 사이트가 아닐 수
  있다"를 전제로 요청했으므로, 카드가 그 성격을 숨기면 안 된다.

**비목표(이번에 안 한다)**
- 별도 페이지 분리 — 진행 중인 선정 개편 설계토론이 `guidelines.html` 분리를 다루고 있다.
  참고자료 카드는 그 결정에 **얹혀 간다**. 지금은 기존 대시보드에 배지만 달리해 렌더한다.
- 자동 수집·큐 — 참고자료는 **PeterJ가 직접 지정할 때만** 생기는 것이다. 자동 선정 없음.

## 2. 왜 새 에이전트가 아니라 `GuidelineAnalyzerAgent` 의 모드인가

`GuidelineAnalyzerAgent` 는 캐시·CircuitBreaker·retry·웹검색 폴백(`analyze()` 130~141행)을
이미 갖고 있고, 참고자료 분석도 정확히 같은 배관이 필요하다. 새 파일로 복제하면 그 배관이
두 벌이 되어 한쪽만 고쳐지는 사고가 난다.

→ `analyze(doc, { mode })` 로 **툴 스키마와 프롬프트만** 분기한다. `_toCard` 가 `type` 을 정한다.

## 3. 카드 구조 대조

| 필드 | guideline | reference |
|---|---|---|
| 배지 | `📋 가이드라인` | `🔖 참고자료` |
| `org` | 발행 학회 | 발행 주체(학회·기관·저자·사이트) |
| `version` | 판/연도 | 발행·갱신 시점 |
| `scope_ko` | 대상 환자군 | 이 자료가 무엇이고 누가 만든 것인가 |
| `summary` | 핵심 **권고** | 핵심 **내용** |
| `keyChanges` | 이전 판 대비 변경점 | **없음** |
| `sourceNote_ko` | 없음 | **★ 신설** — 출처 성격·근거 수준·한계 |
| `practiceImpact` | 침상 임팩트 | 임상에서 어떻게 쓰는가 |

`sourceNote_ko` 가 이 모드의 존재 이유다. 동료심사 여부, 1차 자료인지 2차 해설인지,
발행 주체가 이해관계자인지, 근거가 인용으로 뒷받침되는지, 언제 기준인지를 LLM이 적게 한다.
**모르면 모른다고 적게 한다** — 없는 권위를 지어내는 것이 이 모드의 유일한 치명적 실패다.

## 4. 변경 파일

| 파일 | 변경 |
|---|---|
| `src/agents/GuidelineAnalyzerAgent.js` | `analyze(doc, {mode})` · `_tool(mode)` · `_prompt(mode)` · `_toCard` 가 `type` 분기. **`mode` 기본값 `'guideline'` → 기존 호출부 무변경**(데일리 코어 불변) |
| `scripts/on-demand.mjs` | `kind=reference` 수용. URL 게이트를 `guideline|reference` 로 확장. 상태 파일 `output/selected_references.json` |
| `.github/workflows/on-demand.yml` | `kind` choice 에 `reference` 추가. 입력 설명 문구 갱신 |
| `src/utils/GitHubPublisher.js` | `_buildGuidelineCard` 가 `type` 으로 라벨·배지 분기 + `sourceNote_ko` 블록. `publish()` 가 `reference` 도 받게. 위젯 v4(URL 입력 시 종류 선택) |
| `scripts/spec-lint.mjs` | 상태 파일 목록에 `selected_references` 추가 |
| `REPORT_SPEC.md` | §1-B 에 참고자료 모드 규정 |
| `test/` | 회귀 테스트 |

## 5. 캐시키 주의

`analyze()` 의 캐시키는 `guideline_v4_${provider}_${model}_${id}` 다. 모드를 안 넣으면
**같은 URL을 guideline 으로 한 번, reference 로 한 번 돌릴 때 첫 결과가 재사용된다.**
→ 캐시키에 mode 를 넣는다: `${mode}_v5_...`.

## 6. 불변식 (깨면 안 되는 것)

- **데일리 코어 무영향**: `_stageGuideline` 은 `analyze(g)` 를 mode 없이 부른다 → 기본값
  `'guideline'` 으로 종전과 동일. 회귀 테스트로 고정한다.
- **PMID 경로 무변경**: 논문 PICO 경로는 손대지 않는다.
- **소프트 실패**: 분석 실패 시 대시보드 미변경(현행과 동일).
- **대시보드 변경이므로 push 전 `/preview` 승인.**

## 7. 검증

1. `npm run test:unit` — 신규 회귀 포함 전부 초록
2. `npm run spec-lint` 통과
3. `node --check` 수정 파일 전부
4. `/preview` 로 폰 렌더 확인 → PeterJ 승인
5. 실제 on-demand 1회 실행으로 종단 확인(승인 후)
