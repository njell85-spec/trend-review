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

## 다음 (미정)
- Actions에서 **단일 논문 Opus PICO**가 CLI 안전필터에 걸리는지 실측 확인
  (배치 거부는 해소됨; 단건 거부 시 fallback 카드로 degrade — 대응책 검토 필요).
