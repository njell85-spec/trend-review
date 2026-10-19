# Start here — project context for any tool

현재 선정 평가 기준: **`96600bc489c76e0657914d27dc02d9e270113cb4`**.
현재 로컬 구현 소스: `5ce917257d1e42550404edea6148cfacc40cf054` — 원격 승인 검토 차단으로 미배포.
이번 소스·독립 평가·배포 상태는 [selection evaluation verification](reviews/2026-10-19/selection-evaluation-validation.md)을 따른다.
이전 메타데이터/예고일 배포는 [PR #166](https://github.com/njell85-spec/trend-review/pull/166)과 [PR #167](https://github.com/njell85-spec/trend-review/pull/167)에 보존되어 있다.

This reading order is for a person or an assistant using any editor or model.
These files are links to project context, not an automatic loading mechanism and
not an authorization to run operations. Read the actual files and check the SHA.

## Read in this order

1. **Current state and next actions:** [HANDOFF.md](../HANDOFF.md). Check the
   implementation, release and deployment SHAs before continuing old work.
2. **What the product promises:** [REPORT_SPEC.md](../REPORT_SPEC.md), especially
   §1-A selection versus publication, §1-C guideline selection, and §4 daily core
   isolation. [CLAUDE.md](../CLAUDE.md) and applicable repository skills retain
   their tool-specific rules. This guide does not weaken them.
3. **Why the earlier system looks this way:** [shared historical handoff](HANDOFF.md).
   This preserves the previous Claude work, decisions and cumulative evidence.
   Use its decision and invariants sections for background; the short root handoff
   is the current status, not the end of this long historical log.
4. **What was examined and changed:** [initial selection-quality audit](reviews/2026-10-18/selection-quality.md),
   [follow-up evidence review](reviews/2026-10-19/selection-followup.md), and
   [cache review and correction](reviews/2026-10-19/cache-review.md). Each states
   its input snapshot and limits. The retained census is not the complete
   historical candidate pool and cannot establish whole-literature recall.
5. **Which checks support which code:** [initial validation](reviews/2026-10-18/validation.md)
   and [follow-up validation](reviews/2026-10-19/validation.md). The latter separates
   author-run 971 tests from independent 18 synthetic cases and 5 regressions.
   Test counts from one SHA are not proof that a later SHA was executed.
6. **Current substantive selection evaluation:** read the
   [source-first assessment](reviews/2026-10-19/selection-evaluation.md),
   [source and split limitations](reviews/2026-10-19/selection-evaluation-sources.md),
   [bounded fixes](reviews/2026-10-19/selection-evaluation-changes.md), and
   [independent verification and release](reviews/2026-10-19/selection-evaluation-validation.md).
   Five cases are current and seven are dated references; the six-case holdout
   includes only one current case. Do not call publication coverage recall or
   controlled bug regressions proof of clinical accuracy.
7. **Previous closure:** implementation `87739c8e5a0f186b7adaedde4c7c1a1a668e7a99`,
   based on deployed `11ae9729c0ff2133200ab3de93fe830cece1af8a`.
   Read [metadata corrections and held decisions](reviews/2026-10-19/closure-metadata.md),
   [upcoming-date contract](reviews/2026-10-19/closure-dates.md),
   [independent review and release verification](reviews/2026-10-19/closure-validation.md),
   and [closure plan](superpowers/plans/2026-10-19-selection-closure.md).
   These separate justified corrections from decisions still requiring reader intent.
8. **Prior release background:** [release candidate/source audit](reviews/2026-10-19/release-selection-audit.md),
   [release validation and independent review](reviews/2026-10-19/release-validation.md),
   and [release plan](superpowers/plans/2026-10-19-selection-release.md).
   [PR #165](https://github.com/njell85-spec/trend-review/pull/165) records the exact
   merge commit and remote CI/Pages deployment evidence. Read that status together
   with the implementation SHA in the current handoff.

## Product and evidence map

- Three daily literature tracks: original research, guidelines, and narrative
  reviews. Queues decide selection; publication analyzes their next eligible item.
  Preserve explicit manual choices, track cadence, failed-publication rollback,
  and evidence limitations.
- [Collection configuration](../config/collection.json) and
  [orchestrator](../src/orchestrator/TrendReviewOrchestrator.js) connect collection,
  ranking, analysis, publication and state persistence. Read the tests around the
  changed path before treating a helper's behavior as live pipeline behavior.
- Tracked `output/selected_papers.json`, `output/selected_guidelines.json`,
  `output/queue_reviews.json` and the published HTML represent different stages.
  A missing card is not automatically a missing selection; inspect deletion,
  replacement, copublication and cross-track history first.
- Public site: [research](https://njell85-spec.github.io/trend-review/),
  [guidelines](https://njell85-spec.github.io/trend-review/guidelines.html),
  [reviews](https://njell85-spec.github.io/trend-review/reviews.html).
  The existing GitHub Pages source is `main:/`. The daily workflow also runs
  analysis and notifications; it is not a harmless deployment smoke test.

## Before resuming

Check branch, status, remote HEAD and the handoff's release evidence. Preserve
concurrent changes and the original checkout. Confirm incomplete clinical/source
evidence rather than generating replacement medical claims. Keep private
conversations, local private paths, credentials and patient information out of this
public repository. Public reports identify source documents by their public links.
