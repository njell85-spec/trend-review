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
