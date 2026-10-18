# 후속 검증 근거

기준 PR SHA `5dc5d166b9a45be9c2d0841913a53c8c9664aece`.
최종 코드 SHA `2f20d6cc6b1125aeb70a19de24e4a219a9aea7de`.
이전 코드 `f35563c`/인계 `bc3837b`에 대한 독립 검수 P2를 저자가 재현·수정했다.
Windows / Node v24.16.0, 기존 로컬 의존성 사용. 새 유료 모델 호출 없음.

| 검사 | 실제 결과 |
|---|---|
| 첫 집중시험 | 98/98 통과, 41.967초 |
| 제외 사유/수동 승격 보완 후 집중시험 | 101/101 통과, 1.978초 |
| 이전 코드 전체시험 | 966/966 통과, 실패/취소/skip 0, 68.954초 |
| P2 수정 전 최소 회귀 | 15개 중 10통과/5실패: 결함이 드러나는지 확인한 의도된 적색 시험 |
| P2 최종 집중시험 | 110/110 통과, 실패 0, 0.634초 |
| P2 최종 전체시험 | 971/971 통과, 실패/취소/skip 0, 71.632초 |
| spec-lint | 6그룹, 대상 80파일, 경고 0 |
| 변경 JS/감사 스크립트 구문 | 통과 |
| git diff --check | 통과 |
| 장부·발행 HTML·설정 | 변경 없음 |
| 모바일 실물·신규 원격 CI | 미실행; 로컬 전용 범위 |
| 별도 타입/build | package.json에 해당 스크립트 없음 |

첫 집중 집합은 daily-stage를 포함한다. 두 번째는 region-filter를 포함하므로 시간과
개수를 단순 비교하지 않는다. 마지막 수동 승격의 음성 fit 보호 보완은 전체시험에 포함됐다.
최종 변경 후 전체시험은 한 번만 실행했다. 실패한 시험을 성공으로 바꿔 적은 것은 없다.
이 문장의 “한 번”은 각 단계의 최종 코드 기준이다. 966개 시험 후 독립 검수에서 새 결함이
확인되어 수정했고, 그 뒤 최종 전체 971개를 한 번 실행했다. 추가 독립 재검수는 미실행이다.
편집 도구의 문맥/형식 불일치 두 번은 파일 변경 없이 실패해 올바른 패치로 재적용했다.

회귀 검사 9개 추가: 공동출판 인쇄연도, 부분 개정 양방향, 제목 복수연도,
적합도/계보 상태 분리, 실제 단계에서 보류 유지, 수동 승격, 무근거 전문 주장·캐시·재시도,
웹 출처와 coverage의 신뢰 정책 일치, 개별 정책 제외 사유 저장.
구형 시험 2개의 “전문” fixture는 실제 본문을 공급하도록 고쳤다.
지역 필터 시험은 실제 모델이 호출되지 않도록 fit을 껐다.

P2 보완에는 캐시 회귀 4개와 동일 DOI 경계 1개를 추가했다(총 971개).
모든 모드의 본문·출처 지문, 종합 문헌 입력, raw 구형 값/정책/생성 근거 불일치,
같은 입력의 캐시 적중과 생성 근거 보존을 검사한다. 실제 캐시 삭제는 하지 않았다.
사용자 본문 시험의 기존 v5 키 고정 기대값은 승인된 근거 정책 변경에 맞춰 갱신했다.

```sh
node --import ./output/offline-test-guard.mjs --test --test-reporter=tap test/analysisEvidenceCache.test.mjs test/guidelineLineage.test.mjs test/reviewTranslation.test.mjs test/userSuppliedText.test.mjs test/referenceMode.test.mjs test/guidelineAugment.test.mjs test/synthesisCard.test.mjs
node --import ./output/offline-test-guard.mjs --test --test-reporter=tap test/guidelineLineage.test.mjs test/guidelineFit.test.mjs test/guidelineRegionFilter.test.mjs test/reviewTranslation.test.mjs test/guidelineAugment.test.mjs test/sourceTrust.test.mjs
node --import ./output/offline-test-guard.mjs --test --test-reporter=tap test/*.test.mjs
npm run spec-lint
node --check src/utils/guidelineLineage.js
node --check src/utils/guidelineFit.js
node --check src/agents/GuidelineAnalyzerAgent.js
node --check src/orchestrator/TrendReviewOrchestrator.js
node --check scripts/audit-selection-followup.mjs
node scripts/audit-selection-followup.mjs
git diff --check
```

기존 로컬 preload는 외부 fetch 및 claude/codex spawn을 거부하고 각 시험의 명시적 mock을
허용한다. 실제 운영 엔트리포인트나 임상 파이프라인은 실행하지 않았다. 테스트 TEMP/TMP는
작업 폴더 안 임시 경로로 설정했고 완료 후 정리했다. 원시 로그는 로컬 ignored output의
`deep-followup-focused.log`, `deep-followup-focused-final.log`, `deep-followup-unit.log`,
`deep-followup-spec.log`에 남는다. [기계 판독 검증 요약](validation.json)은 로그 해시를 담는다.
P2 단계 로그는 `cache-review-red.log`, `cache-review-focused-final.log`,
`cache-review-unit-final.log`, `cache-review-spec-final.log`이며 모두 로컬 ignored output이다.
초기 집중 명령에 존재하지 않는 `synthesis.test.mjs` 경로를 넣어 종합 검사가 포함되지 않았다.
정확한 `synthesisCard.test.mjs`를 포함해 최종 110개 집중시험과 전체시험을 실행했다.
[합성 재현 JSON](cache-review-evidence.json)은 새 PMC 525자 공급 시 새 호출 1회·내용 변경,
같은 입력 재사용 시 추가 호출 0회와 생성 근거 보존을 기록한다.

오프라인 감사는 입력 장부를 읽고 결과만 stdout으로 낸다. 현재 장부 객체의 판본 판정 재생은
역사 실행 전체의 재연이 아니다. 원문/공식 페이지 열람은 보고서의 개별 출처에 한정된다.
PADIS 출판사 원문은 접근 제한(402)으로 읽지 못했고 SCCM 공식 설명을 사용했다.
일부 PubMed/웹 검색은 불완전한 응답으로 증거에 채택하지 않았다. 접근제한 우회는 하지 않았다.

독립 검수자는 이전 코드 `f35563c`/인계 `bc3837b`의 신규 9/9·spec-lint·보존 상태와 P2
반례를 확인했다. 저자는 그 결과를 읽고 현재 체크아웃에서 재현한 뒤 수정했다.
수정 후 독립 재검수는 아직 없다. 이전 PR의 독립 검수/CI를 이번 코드의 검수로
확대 해석하지 않는다. 새로운 전문 표시는 입력 존재를 검증할 뿐, 공급된 본문의 완전성이나
웹에서 실제 읽었는지까지 검증하지 않는다. 기존 잘못된 카드/관계는 자동 수정하지 않았다.
