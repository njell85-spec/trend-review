# Backlog

## ✅ 디자인 개선 (PeterJ 요청 2026-06-29) — 완료 2026-06-30
1. ✅ **발행 연-월 표기**: 카드 메타에 `저널 · YYYY.MM` (`GitHubPublisher._fmtDate`).
2. ✅ **제목 한글/영문 동일 폰트 크기**: `.ttl`/`.ttle` 둘 다 16px.
3. ✅ **누적 리스트 표 + 읽음 체크박스**: 페이지 하단 "📚 누적 아카이브"
   (선정일·저널·논문·읽음). 체크 상태는 **localStorage(`tr_read_v1`, PMID 키)** 에 저장,
   읽음 행은 줄긋기 처리. `GitHubPublisher._tableRows` + `publish()` 누적 삽입.

## 다음 (미정)
- (없음 — 추가 요청 시 여기에 적립)
