# Trend Review — 데일리 리포트 규격 (Single Source of Truth)

> 매일 파이프라인 실행 및 카카오톡/이메일 리포트 작성 시 **반드시 이 규격을 따른다.**
> "또 반영이 안 됐다"는 문제를 막기 위한 단일 기준 문서.

## 1. 스크리닝·선정 방침 (확정안 = 1번 방안)

| 항목 | 값 | 코드 위치 |
|------|-----|-----------|
| 검색 윈도우 | **최근 6개월 (180일)** | `searchDays: 180` (orchestrator 호출부) |
| 스크리닝 규모 | **최대 300편** | `MAX_PAPERS=300` / `DataCollectorAgent.maxPapers` |
| 일일 선정 수 | **하루 1편** | `topN: 1` / `TOP_N=1` |
| 선정·분석 모델 | **Claude Opus (`claude-opus-4-8`)** | `FilterAnalyzerAgent.model` + `LLMClient --model` |
| 중복 방지 | 기존 선정 PMID 제외 | `output/selected_papers.json` |

- 검색 → 스크리닝(최대 300편 스코어링) → **임상 적용성 최고 1편 선정** → 전문 PICO 분석.
- 절대 "Top 3 / 최근 30일 / 40~50편" 같은 옛 표현을 쓰지 않는다.

## 2. 카카오톡 리포트 포맷 (PlayMCP MemoChat)

```
[Trend Review] 논문분석완료🏥
{YYYY-MM-DD} · 최근6개월 300편 스크리닝 → 1편 선정

🥇{논문 제목}({저널 약어})
#{PMID}
📊njell85-spec.github.io/trend-review/
```

- 메달은 **🥇 하나만** (하루 1편). 🥈🥉 사용 금지.
- 헤더 둘째 줄은 항상 `최근6개월 300편 스크리닝 → 1편 선정`.
- 점수/근거가 필요하면 제목 줄 아래 한 줄로 `[{score}점·{evidenceLevel}]` 추가 가능.

## 3. 이메일 리포트 (`NotificationAgent`)

- 부제: "최근 6개월(180일) … · Claude Opus"
- 본문: "PubMed 최근 6개월 논문 **최대 300편**을 스크리닝하여 … **오늘의 1편**을 선정"
- PICO 카드: **1편만** 렌더 (`slice(0, 1)`).

## 4. 웹 대시보드 (`GitHubPublisher` → index.html)

- 헤더 부제: `… · PubMed 180-day window · 1 paper/day`
- Papers 통계: 실제 논문 카드 수 기준(하루 1편 → Days == Papers).
- 푸터: `… · PubMed 최근 6개월 · 1편/일`
- 전 섹션 동일 타이포그래피(폰트 크기 스케일 `text-[12~18px]`) 유지 — 단일 빌더(`_buildTodaySection`)만 사용.

## 5. 변경 이력

- 2026-06-29: 1번 방안(6개월/300편/1편·Opus) 전 채널 일괄 반영.
  Opus 모델이 실제 CLI 호출까지 전달되도록 `LLMClient`에 `--model` 추가.
