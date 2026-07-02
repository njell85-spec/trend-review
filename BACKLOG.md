# Backlog

## ✅ 디자인 개선 (PeterJ 요청 2026-06-29) — 완료 2026-06-30
1. ✅ **발행 연-월 표기**: 카드 메타에 `저널 · YYYY.MM` (`GitHubPublisher._fmtDate`).
2. ✅ **제목 한글/영문 동일 폰트 크기**: `.ttl`/`.ttle` 둘 다 16px.
3. ✅ **누적 리스트 표 + 읽음 체크박스**: 페이지 하단 "📚 누적 아카이브"
   (선정일·저널·논문·읽음). 체크 상태는 **localStorage(`tr_read_v1`, PMID 키)** 에 저장,
   읽음 행은 줄긋기 처리. `GitHubPublisher._tableRows` + `publish()` 누적 삽입.

## ✅ 스코어링 아키텍처 확정 (PeterJ 2026-07-01) — 완료
- **결정: 메타 가중치 1편/일** (하루 2편 이원화 기각).
- `src/utils/MetadataScorer.js` 신규: 저널 등급·연구 설계·표본수·최신성·EM/CCM 적합도
  가중 합산으로 1–10 결정적 채점 (LLM 미사용 → 무료·무인 Actions에서 AUP 거부 회피).
- `DataCollectorAgent`: PubMed `PublicationType` 파싱 추가(연구 설계 사실 기반).
- `FilterAnalyzerAgent.scorePapers`: LLM 배치 채점 → `MetadataScorer`로 교체.
  Opus는 선정 1편의 PICO 심층분석에만 사용.

## ✅ 2축 스코어링 + 관심 프로파일 (PeterJ 2026-07-01) — 완료
- 질(Quality) × 적합도(Relevance) 2축. 적합도가 질을 최대 +30% 증폭 → "좋은 논문 + 나에게 적절한".
- `config/interests.json`: PeterJ 편집 가능한 가중 관심 그룹(소생·심혈관/패혈증·쇼크/호흡·ARDS 상위).
- `rawScore` 풀 정밀도로 동점 안정 정렬. 카드에 `질 X · 적합도 Y` 칩.

## ✅ 가이드라인 캐치업 트랙 (PeterJ 2026-07-01) — 완료
- 배치: 주 1회 1편(없으면 건너뜀), 신규 나오면 추가 (하이브리드).
- `DataCollectorAgent.collectGuidelines()`: PublicationType=Guideline + EM/CCM 도메인 쿼리.
- `GuidelineAnalyzerAgent`: 적합도 상위 미노출 1편 선정 → Opus로 핵심 권고·이전 판 대비 변경점·임상 임팩트 (PICO 아님).
- `GitHubPublisher._buildGuidelineCard`: teal 계열 별도 카드 + 아카이브 표 📋 행.
- 오케스트레이터: `output/selected_guidelines.json`로 주기 게이트/중복 방지. 전 과정 non-fatal.

## 다음 (미정)
- Actions에서 **단일 논문 Opus PICO / 가이드라인 Opus 분석**이 CLI 안전필터에 걸리는지 실측
  (배치 거부는 해소; 단건 거부 시 조용히 fallback/skip — 대응책 필요 시 검토).
- 관심 프로파일 가중치는 운영하며 PeterJ 피드백으로 재조정.
