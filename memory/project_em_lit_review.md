---
name: project-em-lit-review
description: Emergency medicine literature review multi-agent system built in Trend directory
metadata:
  type: project
---

Built a Node.js multi-agent EM/CCM literature review system at `c:\Users\njell\Desktop\Test\Trend`.

**Why:** User requested a production-grade multi-agent system with PubMed + Claude API integration, MCP server bindings, circuit breaker pattern, and HTML dashboard output.

**How to apply:** If the user revisits this project, the system is complete and ready to run once Node.js is installed and `.env` is configured with `ANTHROPIC_API_KEY`.

Architecture: LitReviewOrchestrator → DataCollectorAgent (PubMed) + ValidationAgent (2-pass) + FilterAnalyzerAgent (Claude tool use) + ReportGeneratorAgent (HTML+JSON).
Key pattern: Claude tool use with `submit_paper_scores` and `submit_pico_analysis` tools for structured JSON output.

**확정 운영 방침 (1번 방안 — REPORT_SPEC.md가 단일 기준):**
- 검색 윈도우 **최근 6개월(180일)**, 스크리닝 **최대 300편**, **하루 1편 선정**, 선정 1편의 심층분석은 **Claude Opus(`claude-opus-4-8`)**.
- 카카오/이메일/웹 리포트 모두 "최근6개월 300편 스크리닝 → 1편 선정"으로 표기. 🥇 하나만, "Top 3 / 최근 30일 / 40~50편" 표현 금지.
- Opus는 `FilterAnalyzerAgent.picoModel`로 지정되며 `LLMClient`가 `claude` CLI에 `--model`로 전달해야 실제 적용됨(이게 빠져 과거에 미반영됨).
- 데일리 리포트 작성 전 반드시 `REPORT_SPEC.md`를 확인할 것.

**스코어링 아키텍처 결정 (2026-07-01, PeterJ 확정 — "메타 가중치 1편/일"):**
- **스크리닝/스코어링 = 결정적 메타데이터 스코어러(`src/utils/MetadataScorer.js`)**. LLM 안 씀.
  - 이유: Claude Code CLI(구독)의 안전필터가 "의학 초록 300편 배치 채점"을 **거부(AUP refusal)** → 무료·무인 Actions 자동화에서 LLM 배치 스코어링 불가. (모델 문제 아님, 내용 기준 거부라 Sonnet도 동일.)
  - 가중 요소: 저널 등급 · 연구 설계(PubMed `PublicationType`) · 표본수(초록 N 추출) · 최신성 · EM/CCM 도메인 적합도. 감점: 사설/논평/동물·시험관/프로토콜.
  - 산출 계약: `{ pmid, score(1–10), rationale(한국어), studyType }` — 기존 LLM 스코어러와 동일 형태라 다운스트림 무변경.
  - `DataCollectorAgent`가 `publicationTypes`를 파싱해서 넘겨줌(연구 설계는 PubMed 사실 기반, 환각 없음).
- **Opus는 선정된 1편의 PICO 심층분석에만 사용**(`FilterAnalyzerAgent.analyzePico`). 단일 논문 정식 분석이라 배치 거부 위험이 낮음(단, Actions CLI에서 단건도 거부될지는 미확정 리스크).
- 하루 2편(이원화) 방안은 **기각**: 안 읽고 쌓임(3편→1편 회귀한 교훈) + 무료 LLM 배치 채점 불가로 토큰 절약 근거가 무의미.

**2축 스코어링 (2026-07-01):** 질(Quality: 설계·저널·표본·최신성) × 적합도(Relevance: `config/interests.json` 관심 프로파일). 적합도가 질을 최대 +30% 증폭 → 관심 밖 논문(예: 종양 RCT)은 자동 후순위. `rawScore`로 동점 정렬. 관심 그룹 상위 가중: 소생·심혈관 / 패혈증·쇼크 / 호흡·ARDS.

**가이드라인 캐치업 트랙 (2026-07-01 확정):** 논문과 별개. **주 1회 1편(없으면 skip), 신규 나오면 추가**. `DataCollectorAgent.collectGuidelines()`(PublicationType=Guideline) → `GuidelineAnalyzerAgent`가 적합도 상위 미노출 1편을 Opus로 "핵심 권고 + 이전 판 대비 변경점 + 임상 임팩트"(PICO 아님) 분석. `output/selected_guidelines.json`로 주기 게이트. 전 과정 non-fatal(데일리 논문에 영향 없음).
