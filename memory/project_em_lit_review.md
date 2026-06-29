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
- 검색 윈도우 **최근 6개월(180일)**, 스크리닝 **최대 300편**, **하루 1편 선정**, 선정·분석은 **Claude Opus(`claude-opus-4-8`)**.
- 카카오/이메일/웹 리포트 모두 "최근6개월 300편 스크리닝 → 1편 선정"으로 표기. 🥇 하나만, "Top 3 / 최근 30일 / 40~50편" 표현 금지.
- Opus는 `FilterAnalyzerAgent.model`로 지정되며 `LLMClient`가 `claude` CLI에 `--model`로 전달해야 실제 적용됨(이게 빠져 과거에 미반영됨).
- 데일리 리포트 작성 전 반드시 `REPORT_SPEC.md`를 확인할 것.
