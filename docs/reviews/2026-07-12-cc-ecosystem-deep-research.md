# Claude Code 확장 생태계 딥리서치 — 검증 보고서 (체크포인트 겸용)

> 작성: 2026-07-12 (KST 기준 오후) · 세션: EMR_Assist_v1 productivity-optimization
> 목적: 하네스/플러그인/스킬/MCP/훅 중 "실제로 계속 쓰이는 것"을 가려 PeterJ 글로벌 세팅에
> 추가할 항목을 결정하기 위한 근거 조사. **설치 결정은 PeterJ 검토 후** (이 문서는 근거만).

## 0. 진행 상태 (끊겨도 여기서 이어가기)

- [x] 검색 5각도 (완료, 워크플로 캐시)
- [x] 소스 정독·주장 추출 (완료 — 일부 도메인 403 차단으로 접근 가능한 소스만)
- [x] 전 주장 판정 완료 — **최종: 확정 발견 12(병합) / 반박 6 / 미검증 0** (§7)
- [x] 최종 합성 완료 (103/103 에이전트, 2026-07-12 3차 재개에서 완결)
- 원자료: `data/2026-07-12-cc-ecosystem-research-raw.json`(2차분) — §7이 최종본.

## 1. 검증 통과 주장 (3표 적대검증, 표결 표시)

**C1. (3-0)** The official Anthropic marketplace (claude-plugins-official) is automatically registered when Claude Code starts, and its catalog is curated by Anthropic at Anthropic's discretion — in-app submissions go to the community marketplace instead.
- 출처: https://code.claude.com/docs/en/discover-plugins

**C2. (3-0)** Claude Code (v2.1.187+) tracks plugin usage and surfaces a 'Not used recently' group for marketplace plugins unused for at least two weeks over at least 10 sessions, explicitly to help users find plugins that still add startup and context cost so they can disable or uninstall them — direct harness-level evidence that 'installed but abandoned' plugins are a recognized problem.
- 출처: https://code.claude.com/docs/en/discover-plugins

**C3. (3-0)** Since Claude Code v2.1.143 the plugin details pane shows a per-plugin 'Context cost' token estimate before install (plus Last updated date in v2.1.144 and a full 'Will install' component inventory in v2.1.145), confirming that plugin token/context overhead is a first-class user concern Anthropic now quantifies in the UI.
- 출처: https://code.claude.com/docs/en/discover-plugins

**C4. (3-0)** The official marketplace's headline categories are: LSP code-intelligence plugins for 11 languages (e.g. typescript-lsp requiring typescript-language-server), pre-configured MCP integration plugins (github, gitlab, atlassian, asana, linear, notion, figma, vercel, firebase, supabase, slack, sentry), the security-guidance auto-review plugin, workflow plugins (commit-commands, pr-review-toolkit, agent-sdk-dev, plugin-dev), and two output styles.
- 출처: https://code.claude.com/docs/en/discover-plugins

**C5. (3-0)** The repo's core value proposition is that hooks give deterministic, rule-based control over agent behavior (e.g., PreToolUse blocking dangerous commands) instead of relying on probabilistic LLM judgment — directly relevant to 'automatic verification gate' hook patterns.
- 출처: https://github.com/disler/claude-code-hooks-mastery

**C6. (2-1)** The article ranks the official-marketplace plugin 'commit-commands' as the single most worthwhile Claude Code plugin to install first, on the grounds that it measurably removes git workflow friction (commit/push/PR creation).
- 출처: https://securityboulevard.com/2026/06/7-claude-code-plugins-from-the-marketplace-worth-your-time/

**C7. (3-0)** The official 'security-guidance' plugin performs an inline review of each change Claude makes, checking for vulnerability classes such as command injection, unsafe deserialization, and XSS, and instructs Claude to fix findings within the same session; the article calls this inline loop the highest-leverage safety net among the seven picks.
- 출처: https://securityboulevard.com/2026/06/7-claude-code-plugins-from-the-marketplace-worth-your-time/

**C8. (3-0)** The official MCP-bundling integration plugins (github, gitlab, linear, slack) impose a per-turn context cost, and each such plugin adds a credential the user must manage — a concrete downside the article flags even while recommending them for tool-centric workflows.
- 출처: https://securityboulevard.com/2026/06/7-claude-code-plugins-from-the-marketplace-worth-your-time/

**C9. (3-0)** Ralph Wiggum (Ralph loop) is an official Anthropic plugin that runs Claude in an autonomous iterative loop for multi-hour coding sessions, working through tasks one at a time and committing each to git. [Quote obtained via search-indexed copy; live page returned 403 to all fetchers.]
- 출처: https://www.firecrawl.dev/blog/best-claude-code-plugins

**C10. (2-1)** Context7 is recommended as a plugin/MCP that feeds Claude current library documentation at query time, and the article claims this measurably reduces hallucinated/outdated API suggestions. (Relevant caveat for the user profile: Context7 is an external API service, so it needs network-domain allowlisting in restricted cloud sessions.)
- 출처: https://www.firecrawl.dev/blog/best-claude-code-plugins

**C11. (3-0)** After experiencing the cost firsthand (burning through €200 of credits without understanding why), the author's final workflow is to keep zero plugins enabled by default and enable them on demand via /plugin, since re-enabling takes about 30 seconds — i.e., a real user who 'installed then effectively uninstalled' the always-on plugin approach.
- 출처: https://dev.to/ohugonnot/claude-code-i-had-10-plugins-active-at-once-heres-what-it-actually-costs-2ckn


## 2. 반박되어 폐기된 주장 (⚠️ 이전 중간보고 정정 포함)

**R1.** disler/claude-code-hooks-mastery is an actively maintained, popular reference repo for Claude Code hooks: ~3.8k stars, 628 forks, created 2025-07-05, with repository activity as recent as 2026-07-11 (confirmed via GitHub API metadata).

**R2.** The repo implements all 13 Claude Code hook lifecycle events (UserPromptSubmit, PreToolUse, PostToolUse, PostToolUseFailure, Notification, Stop, SubagentStop, PreCompact, SessionStart, SessionEnd, PermissionRequest, SubagentStart, Setup), with 11 of 13 validated by automated testing.

**R3.** The author measured that an average-sized Claude Code plugin injects about 2,000 tokens of context into every message, so having 10 plugins enabled adds roughly 20,000 extra input tokens per exchange (at Sonnet 4.6's $3/M input pricing).

**R4.** Enabled plugins inject their content into the system prompt on every single exchange in every session, and are billed regardless of whether the plugin has actually been used recently — an unused plugin still costs tokens continuously.


## 3. (구) 미검증 주장 — 3차 재개에서 전건 판정 완료, 최종 판정은 §7 참조

**U1.** Idle MCP-server plugins impose a large fixed context cost in Claude Code: five connected-but-unused plugins inject about 55,000 tokens of tool definitions before the user types anything, which the author estimates wastes roughly $40 over a typical 20-message conversation. — https://madewithlove.com/blog/your-claude-code-is-burning-through-tokens-heres-how-to-fix-it/

**U2.** The article's prescribed remedy for extension bloat is management, not abandonment: it teaches diagnosing token consumption and cutting overhead via plugin management (disabling MCP servers), profiles, and context hygiene, rather than telling readers to stop using MCP servers entirely. — https://madewithlove.com/blog/your-claude-code-is-burning-through-tokens-heres-how-to-fix-it/

**U3.** Claude Code's /context command systematically over-reported MCP server token usage because it called Anthropic's count_tokens API for each tool separately and summed the results, so the shared system instructions/wrapper overhead was counted once per tool instead of once per request (with ~60 tools, that overhead was paid ~60 times). — https://www.async-let.com/posts/claude-code-mcp-token-reporting/

**U4.** The real context cost of the XcodeBuildMCP server is about 15k tokens, not the ~45k that Claude Code's /context reported — a roughly 3x inflation — which the author verified by measuring the MCP payload independently (~14k tokens for the tools alone). — https://www.async-let.com/posts/claude-code-mcp-token-reporting/

**U5.** The inflated /context numbers caused unwarranted community alarm about MCP servers 'eating' context windows — i.e., a substantial part of the 'MCP context bloat' criticism circulating among Claude Code users was a measurement/reporting bug, not real consumption. — https://www.async-let.com/posts/claude-code-mcp-token-reporting/

**U6.** Even with accurate reporting, MCP servers still impose a real fixed context cost: XcodeBuildMCP's tool surface is ~16k tokens and Claude Code's built-in tools add ~10k more, so a session starts ~25k tokens deep before any user work — meaning large multi-tool MCP servers remain a genuine (if smaller than feared) context tax. — https://www.async-let.com/posts/claude-code-mcp-token-reporting/

**U7.** Claude Skills are far cheaper in context tokens than MCP servers because only a short frontmatter description is loaded per skill at session start, with the full skill body loaded on demand — so having many skills installed costs only dozens of tokens each. — https://simonwillison.net/2025/Oct/16/claude-skills/

**U8.** Popular MCP servers impose a heavy fixed context cost; specifically, GitHub's official MCP server alone consumes tens of thousands of context tokens before any work happens, which crowds out the model's working context. — https://simonwillison.net/2025/Oct/16/claude-skills/

**U9.** Most MCP use cases can be replaced by CLI tools or plain Markdown instructions (skills), since LLM harnesses with terminal access can discover tool usage via --help without pre-loaded tool schemas. — https://simonwillison.net/2025/Oct/16/claude-skills/

**U10.** With all of the author's MCP servers enabled, MCP tool definitions alone consumed ~82k tokens (41%) of Claude Code's 200k context window before any conversation started, leaving only ~6% free space on an empty session. — https://scottspence.com/posts/optimising-mcp-server-context-usage-in-claude-code

## 4. 종합 판단 (검증 결과가 기존 결론을 바꾼 부분)

1. **"플러그인 상시 비용" 담론은 절반만 사실**: "평균 2K/개, 매 교환 주입, 5개=55K" 류의
   구체 수치 주장은 검증에서 **반박·미검증**으로 떨어졌다(R3·R4·U1). 다만 공식 문서가
   플러그인별 "Context cost(턴마다 추가되는 토큰)" 표시(v2.1.143+)와 "Not used recently"
   정리 기능(v2.1.187+)을 도입했다는 사실은 3-0 확정(C2·C3) — 즉 **비용은 실재하되 크기는
   플러그인마다 다르며, 설치 전 공식 Context cost 표시로 개별 확인하는 것이 정답**.
2. **린 셋업 원칙은 유지**: "기본 0개 활성, 필요할 때 /plugin으로 켠다"는 실사용자 전환
   사례가 3-0 확정(C11). → 상시 활성은 최소로, 상황성 플러그인은 온디맨드.
3. **훅 = 결정론적 제어**라는 가치명제 3-0 확정(C5). 단 disler repo의 스타 수·기능 범위
   주장은 반박(R1·R2) — 참고는 하되 수치 인용 금지.
4. **security-guidance**: "변경 즉시 인라인 보안 리뷰 + 같은 세션 내 수정 지시" 동작 3-0
   확정(C7). **commit-commands**: "가장 먼저 깔 플러그인" 평가 2-1 확정(C6) — 단 PeterJ는
   git 규율 훅 보유로 중복.
5. **MCP 번들형 플러그인은 "관리해야 할 자격증명+턴당 비용"**(C8, 3-0) — 다다익선 금지
   재확인. Context7 효용 주장은 2-1(C10) + 네트워크 차단 실측 → 조건부 유지.
6. MCP 토큰 비용의 세부(과대보고 논쟁, 스킬이 더 싸다 등)는 **전부 미검증**(U1~U10) —
   방향은 그럴듯하나 수치 인용은 보류.

## 5. 설치 결정 매트릭스 (PeterJ 검토용 — 결정 전 미설치)

| 후보 | 분류 | 근거 등급 | 비용/리스크 | 권고 |
|---|---|---|---|---|
| 편집 직후 typecheck 훅(자작) | 훅 | C5(3-0)+로컬 실측 | 상주 토큰 0, 훅 지연 수초 | **1순위** |
| superpowers-chrome | 플러그인(스킬형) | 로컬 실측(카탈로그·Chromium)+제작자 신뢰 | MCP 상주 없음(스킬 모드) | **1순위** (/preview 기반) |
| typescript-lsp | 플러그인(LSP) | C4(3-0, 공식 카탈로그) | typescript-language-server 필요 | **1순위** |
| security-guidance | 플러그인(훅형) | C7(3-0) | 소폭 Context cost — 설치 전 표시 확인 | **1순위** (PHI 인접) |
| double-shot-latte | 플러그인(훅형) | 소스 직접 검증(승인게이트 통과 안 함) | Stop마다 judge 호출 1회 | 2순위 — 시험 채택 |
| claude-md-management | 플러그인(스킬형) | 카탈로그 실측만 | 낮음 | 2순위 |
| context7 | 플러그인(MCP형) | C10(2-1)+차단 실측 | 네트워크 허용 선행 + 턴당 비용(C8) | 조건부 |
| commit-commands | 플러그인(커맨드) | C6(2-1) | 기존 git 훅과 중복 | 스킵 |
| ralph-wiggum | 플러그인(루프) | C9(3-0) | 내장 /loop·Workflow와 중복 | 스킵 |
| remember/episodic-memory | 플러그인(MCP) | 카탈로그 실측만 | 휘발성 컨테이너에서 인덱스 소실 | 스킵 |

## 6. 부록 — 이 세션 로컬 실측 (재검증 불필요)

- 공식 마켓플레이스 2곳 등록 성공, `claude-plugins-official` 255종(카테고리: development 109 ·
  productivity 45 · database 34 · monitoring 17 · security 13 …).
- 네트워크: npm ✅ · mcp.context7.com ❌ · api.vercel.com ❌ (프록시 CONNECT 403).
- obra 마켓플레이스 추가 플러그인: superpowers-chrome(3.0.1) · double-shot-latte(1.2.0) ·
  episodic-memory · claude-session-driver · superpowers-lab 등.
- double-shot-latte 소스 검증: Stop 훅 + Claude judge, "사용자 결정 요청 시 정지 허용" 명시.
- Chromium/Playwright 사전 설치 확인(클라우드 컨테이너).


## 7. 최종 완결 요지 (2026-07-12, 103/103 에이전트 · 미검증 0)

**§4 대비 갱신·확정된 것**:

1. **MCP 비용 논쟁 최종 정리(3-0)**: `/context`가 MCP 사용량을 ~3배 과다보고하던 버그가
   실재했고 2026-01에 수정됨. **그러나 버그를 걷어내도 고정비는 실재** — GitHub 공식 MCP
   단독 실측 수만 토큰(3중 독립 실측), 다중 MCP 활성 시 빈 세션에서 수십 % 소모 사례.
   MCP tool search(지연 로딩)가 이를 대폭 완화. "비판이 대부분 버그 탓"이라는 확장 해석은
   0-3 기각 — **비용은 과장됐을 뿐 실재했다**.
2. **"5개=55K"·"평균 2K/개, 매 교환 주입" 수치 담론은 최종 반박**(반박 6건에 포함).
3. **실사용자의 정답은 '온디맨드 관리'(3-0)**: 기본 활성 0개 + 필요 시 /plugin 토글
   (disabled = 토큰 비용 0) + 'Not used recently' 정기 정리 + /clear 위생.
4. **스킬 > MCP 비용 구조(2-1, medium)**: 스킬은 frontmatter만 상시 로드. Willison 테제
   ("터미널 있는 하네스에선 CLI·스킬이 대부분의 MCP를 대체") 교차 지지 —
   "신규 MCP 대신 자작 스킬 우선" 원칙 채택 근거.
5. **훅 = 결정론적 게이트 가치 확정(3-0)** — 단 결정론적인 건 실행이지 패턴 매칭의
   완전성이 아님(우회 가능성 유의).
6. **security-guidance 3층 메커니즘 공식 문서로 확정(3-0)** — 네트워크 불필요·로컬 동작,
   제한 네트워크 클라우드 세션에 최적. 합성 순위 1위.
7. 합성 에이전트의 순위는 ① security-guidance ② typescript-lsp ③ commit-commands
   ④ 온디맨드 규율 ⑤ 자작 스킬 우선이었으나, **commit-commands는 PeterJ의 기존 git 규율
   훅과 중복 + "프록시 뒤 push 실패" caveat(2-1)가 그의 환경에 직접 해당**되어
   본 보고서 매트릭스(§5)에서는 스킵 유지 — 이 불일치는 명시해 둠.

**§5 결정 매트릭스에 미치는 영향**: 순위 변동 없음(1순위 4종 그대로). context7 "조건부"
근거 보강(호스팅형 외부 API + 효용 주장 벤치마크 부재 2-1). 원칙 항목 추가 —
"새 도구 욕구가 생기면 MCP보다 자작 스킬을 먼저 검토"(F9), "분기 1회 Not used recently
정리"(F10, 클코 구조도 갱신 주기와 병합 가능).
