# Selection contract corrections — 2026-10-19

The source patch was developed after the evaluation split was frozen. Only the six development records were read. Their editorial-consideration labels were not converted into score weights, title exceptions, or automatic approvals. Holdout results belong to the independent evaluation.

## Changes and bounded evidence

| Defect | Before | After |
|---|---|---|
| Missing/malformed model fit | `null`, blank strings, booleans, and arrays could be coerced into numeric fit, including a zero that moved an otherwise queued item into `needsReview`. | Only finite numbers and nonblank numeric strings are accepted. Invalid evidence leaves the item and any prior verdict unchanged. Genuine numeric zero remains a negative judgment. |
| Negated randomization in title-only evidence | “Nonrandomized comparison in septic shock” received the same title-based RCT classification and 7.00 raw score as “Randomized comparison in septic shock” in the controlled fixture. | The nonrandomized fixture is `Other`, raw score 5.95 (design contribution 0.75 versus 1.80). Randomized titles retain the RCT score. Authoritative publication types still take precedence; weights are unchanged. |
| Refill diverged from existing deterministic selection policy | Fresh candidates were sorted on unadjusted metadata scores, and the generic merge could reorder a manually arranged existing queue. | Fresh candidates use the existing selection function and saved topic history. In the fixture, recent-topic score 8 becomes 6 and follows the different-topic score 7. Existing manual and queued entries stay ahead in exactly their prior order, with full metadata preserved. |

Consumed and already queued identifiers are removed before monthly pooling in the refill path and before the final fresh-candidate limit. New candidates fill only the remaining capacity to 14. Existing queues larger than 14 are not truncated. Repeating the save with a full queue is idempotent. Journal exclusions retain the existing `topN` fallback threshold; cooldown disabling also retains its existing behavior.

New queue entries record `lowConfidence: true` and `selectionEvidence` with the deterministic method, adjusted raw score, cooldown penalty, and `llmCalled: false`. This is selection provenance, not a statistical confidence estimate. Existing entries are not relabeled.

## Verification

68 focused tests passed across `selectionQualityContract`, `trackQueue`, `selectionAuditRegression`, `paperQueueSelection`, `guidelineFit`, and `metadataScorer`. The five new contract tests cover malformed-fit boundaries, negated title evidence, the actual refill method reading temporary saved history, manual metadata/order, consumed identifiers, capacity, idempotence, oversized queues, and existing journal/cooldown policies. Collection and validation are mocked in the refill test; model entry points fail if invoked, and an offline guard blocks external fetch and model CLI execution. `git diff --check` passed.

The first test invocation failed because its selected temporary directory had not been created. After creating that directory, the same focused test set passed. This was an environment setup failure, not a product assertion failure. No production queue, selection history, HTML, or clinical report was modified by these checks. The full suite was not repeated.

## Remaining coverage limits

The fixes do not establish general clinical-selection accuracy. Optional clinical LLM reranking remains in the older collection/selection fallback path and is not invoked by ordinary deterministic refill. No model verdict was regenerated, and prior rejections or manual decisions were not revised.

Collection windows, acquisition coverage, metadata completeness, journal/topic weights, and monthly preselection remain existing policy. A candidate dropped by monthly screening before the final history-aware ranking cannot be recovered by this patch. Cooldown uses actual recorded topic history, not hypothetical future publications from the queue; it does not guarantee alternation across every queued day. The development set includes dated references and incomplete source metadata, so a metadata-only counterfactual must not be presented as historical observed rank or current automatic admission.
