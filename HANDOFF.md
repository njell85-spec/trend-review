# 현재 인계 — trend-review

읽을 순서: **[docs/START_HERE.md](docs/START_HERE.md)** → 이 문서 →
[REPORT_SPEC.md](REPORT_SPEC.md)·[CLAUDE.md](CLAUDE.md) →
[기존 공통 누적 인계](docs/HANDOFF.md). 자동 로딩이나 추가 권한을 가정하지 않는다.
이 짧은 인계가 기존 Claude 작업과 이번 변경, 다음 담당자의 행동을 연결한다.

## 소스와 배포 기준

- 현재 구현: `87739c8e5a0f186b7adaedde4c7c1a1a668e7a99`.
- 기반 배포: `11ae9729c0ff2133200ab3de93fe830cece1af8a`,
  [이전 PR #165](https://github.com/njell85-spec/trend-review/pull/165).
- 분리 브랜치: `codex/selection-closure-20261019`. 원본 main `475cd0c` 및
  이전 후속 브랜치를 보존했다. 원본에는 pull/reset/stash/clean을 하지 않았다.
- 이번 CI·통합·Pages 검증은 [closure validation](docs/reviews/2026-10-19/closure-validation.md)에
  구분해 기록한다. 정적 배포와 다음 예약 분석 실행은 별개다.
- 운영 사이트: [논문](https://njell85-spec.github.io/trend-review/),
  [지침](https://njell85-spec.github.io/trend-review/guidelines.html),
  [리뷰](https://njell85-spec.github.io/trend-review/reviews.html). 기존 Pages `main:/` 사용.

## 완료한 수정과 검증

- 기존 3트랙·선정/발행 분리·수동 선택·이력은 유지한다. 앞선 D1 변경은 소진 후보,
  약어 경계, 지침 fit, 판본·캐시 근거, 리뷰 적격성, 논문 0건의 독립 트랙 처리다.
- 케타민 `39198198/39207913`의 거짓 신판 관계를 제거하고 공동출판 링크를 추가했다.
  미발행 후보는 계속 보류한다. ARDS `41773929/41773928`은 본문/공식 요약 관계를
  양쪽 카드에 표시했다. `36322846`은 전문 열람 근거 미확인으로 정정하고 기존
  번역을 보존한 안내를 넣었다. 장부 5건의 9필드만 바꿨다.
- 일일 성공 기록 뒤 남은 큐가 같은 날 발행될 것처럼 보이던 예고일을 수정했다.
  리뷰 `42059919`는 10월 20일로 표시된다. 수동 추가·실패·격일·순차·off를 구별한다.
- 메타데이터 4/4, 날짜 62/62, 번역 표시 30/30 통과. 독립 검수는 중복 포함
  12개 시험과 별도 72개 일정 사례에서 범위 내 P0/P1/P2를 찾지 못했다.
  spec lint·구문·diff 검사 통과. 로컬 전체시험·실제 일일 분석은 반복하지 않았다.
- [정정 근거와 남은 결정](docs/reviews/2026-10-19/closure-metadata.md),
  [날짜 계산과 한계](docs/reviews/2026-10-19/closure-dates.md),
  [시험·독립 검수·HTML 보존 증거](docs/reviews/2026-10-19/closure-validation.md).

## 다음 담당자가 이어받을 결정과 한계

1. PADIS `39982143`는 공식 부분개정 지침이다. 리뷰 자동 발행에서는 이미 제외되지만
   지침 트랙으로의 채택은 별도 결정이다. 임의 이동·승격하지 않았다.
2. `38748265`는 ICU 응급 혈액질환 관련성이 있어 “좁은 주제” 탈락 근거를 재검토할
   만하다. `41324946`는 거절 주체/이유가 없어 복구 결정을 추정할 수 없다.
   평가 결과는 정리했으며 원래 결정은 보존했다.
3. 390/800px DOM 검사와 픽셀 검증을 구별한다. 캡처 시간 초과로 픽셀 검증은 미완료다.
   새 권한·네트워크 변경으로 우회하지 않았다.
4. 일일 소비 기록은 배포 영수증이 아니다. 기존 논문/지침의 배포 실패 복구,
   과거 번역의 전문 일치·임상 정확도 검증은 이번 범위 밖이다.

보유 자료는 논문 106 / 지침 76 / 리뷰 63건이며 전체 역사 후보풀이 아니다.
전체 누락률·독립 임상 holdout 성능을 주장하지 않는다. 주제 편중 및 후보 한계는
[최초 감사](docs/reviews/2026-10-18/selection-quality.md)와
[최신 후보 대조](docs/reviews/2026-10-19/release-selection-audit.md)를 함께 읽는다.
타워 및 Drive 최종 취합은 별도 통합 담당 범위다. 공개 인계에 비공개 대화·경로·계정
지표·환자자료를 포함하지 않는다.
