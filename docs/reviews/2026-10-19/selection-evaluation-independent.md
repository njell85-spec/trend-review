# Independent selection-contract review — 2026-10-19

Base: `96600bc489c76e0657914d27dc02d9e270113cb4`.
Reviewed frozen source bundle: `31dfe4e170548f2342bdccad47cf1c3ee3779167c82994fb7cb4750cca9e7178`.
All eight recorded file hashes matched during independent verification.

**No P0/P1/P2 findings within the checked scope.** The review covered the complete
source/specification diff and new selection-contract tests, separately from the
[reference-sample evaluation](selection-evaluation.md).

- Malformed fit evidence preserves the original item and prior verdict. Numeric
  zero remains a valid judgment. Protected statuses and manual decisions retain
  their existing precedence.
- Explicit nonrandomized title evidence no longer receives the title-only RCT
  classification. Authoritative publication types retain precedence; this remains
  a bounded title heuristic, not clinical study-design adjudication.
- Fresh refill candidates reuse the existing journal and topic-cooldown selector.
  Existing valid queue entries preserve their full metadata and array order;
  oversized queues are not truncated. Consumed and occupied identifiers are
  excluded before monthly limits and again before the final fresh-candidate limit.
  New duplicate identifiers do not spend multiple queue slots.

## Executed verification

**9/9 focused tests passed**, with zero skips or cancellations: the author's five
new contract tests and four additional independent checks. The latter verified
the frozen hashes, 35 additional malformed-fit/status combinations, the actual
monthly-pool refill path, and duplicate capacity/above-floor behavior. The monthly
test used six manually ordered survivors, high-scoring occupied/consumed records,
and two fresh candidates. With the real monthly top-K function, both fresh
candidates survived and recorded history changed their order; all six prior
entries and publication/rejection history stayed unchanged. Collection and
validation were mocked. Model analysis and reranking entry points would fail if
called; the offline guard blocked external fetch and model CLI execution.

Passing log SHA-256:
`bfa8bf98451755ba21312b1800b1beeae8398efba8a75609f9ab95fba7e274ac`.

An initial harness placed temporary fixture queues beneath a directory named
`output`, triggering the existing production-write guard and four test failures.
Using separate ignored scratch storage resolved those failures without changing
source, assertions, or permissions. The full suite was not repeated.

## Limits

This review does not establish clinical precision, recall, source completeness,
or improved literature coverage. It does not duplicate the frozen holdout replay.
Monthly preselection can still discard candidates before history-aware final
ranking, and cooldown uses recorded publications rather than hypothetical queued
publications. No clinical text, production ledger, manual adoption/rejection,
publication history, permissions, or live workflow was changed by the reviewer.
CI and deployment verification belong to the release owner.

The final current handoff, START_HERE and validation entry were also read as a
fresh-context check. All 37 relative links resolve. They distinguish the current
evaluation baseline from the previous closure deployment, keep remote release
verification pending, and do not imply new permissions. The four selection/queue
ledgers and three clinical HTML pages have no changes relative to the baseline.
