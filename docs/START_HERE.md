# Start here — project context for any tool

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
6. **Current release work:** [release candidate/source audit](reviews/2026-10-19/release-selection-audit.md),
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
