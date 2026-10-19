# Selection evaluation verification

Baseline: `96600bc489c76e0657914d27dc02d9e270113cb4`.
Branch: `codex/selection-evaluation-20261019`.
Local implementation: `5ce917257d1e42550404edea6148cfacc40cf054`.
Evaluation/documentation commit: `a4d426d61fad692cb00312e039b816042020617e`.

## Freeze and evaluation order

The 12-case source-first set was frozen before repository-outcome lookup and
implementation. Its SHA256 is
`c45145458531d357f4d20a864ca139bbd4df357addd6e2e289f932e5097e41ed`.
Only the six development records were disclosed to the implementation author.
The source patch was frozen before the evaluator and independent reviewer began
post-change checks; its file-bundle SHA256 is
`31dfe4e170548f2342bdccad47cf1c3ee3779167c82994fb7cb4750cca9e7178`.
The holdout comprises one current and five dated references, all positive
editorial-consideration labels. This is not a clinical accuracy benchmark.

## Author verification

68/68 focused tests passed across `selectionQualityContract`, `trackQueue`,
`selectionAuditRegression`, `paperQueueSelection`, `guidelineFit`, and
`metadataScorer`. The new contract tests invoke actual refill with mocked
collection/validation, saved temporary history, and model entry points that fail
if called. An offline guard blocks external fetch and model CLI execution.
The initial attempt failed because the selected temporary directory did not
exist; creating it resolved the setup failure. No product assertion failure was
hidden. `git diff --check` passed.

The tests demonstrate invalid-value handling, negated title evidence, saved-topic
cooldown, manual array order/full metadata, consumed and occupied IDs, capacity,
idempotence, oversized-queue preservation, and the existing journal fallback.
The [change report](selection-evaluation-changes.md) separates controlled numeric
before/after results from historical clinical performance.

## Independent evaluation

The [independent review](selection-evaluation-independent.md) found no P0/P1/P2
defect within the checked scope. Its 9/9 passing tests comprise five overlapping
author contract tests and four additional independent checks; these must not be
added to 68 as 77 unique tests. They include 35 malformed-fit/status combinations
and the actual unstubbed monthly top-K path with saved history, occupied IDs and
manual queue order. An initial harness triggered the production-write guard;
separate ignored scratch storage resolved it without source or permission changes.

The [frozen-input replay](selection-evaluation-replay.json) compared the baseline
and fixed source at a fixed date with identical title/journal/date inputs. Missing
abstracts, publication types and MeSH stayed empty; clinical rationale was never
substituted for source metadata. All 12 metadata/title outcomes were unchanged,
including all six holdouts; four guideline rule scores were also unchanged.
The separately labeled synthetic null-fit control changed from an unsupported
hold to preserving the existing queue record. It is outside the clinical sample.
Thus this exercise establishes bounded logic corrections, **not measured clinical
selection improvement**. Historical competing pools and selection ranks remain
unavailable. No sample case was replaced after observing its outcome.

The immutable set and all eight source-bundle file hashes matched after review.
The four selection/queue ledgers and three HTML pages match the baseline.
Specification lint passed all six groups/80 files with zero warnings. The project
has no separate typecheck/build script; relevant JavaScript modules were executed
by the focused tests. No production daily, collection or clinical-analysis
workflow ran, and the prior full suite was not repeated locally.

## Release

**Local completion only; not deployed.** Remote branch push was blocked by
automatic approval review. A read-only remote lookup confirmed that the branch
had not been created. One retry after checking the later task record was also
rejected before execution. No further retry, workaround, PR publication, merge,
new remote CI, Pages deployment or live daily run occurred for this patch.
Resolve explicit publication authorization before resuming; inspect remote state
and then run the existing PR/CI/Pages process. Do not cite the previous release's
988-test CI or deployment as verification of this new source.

The preserved local branch contains the source and evaluation commits above.
It changes selection code, tests and evidence documents without changing clinical
HTML or production ledgers. Runtime selection on a subsequent real daily run
is intentionally not exercised here. Existing main remains the baseline SHA.

The current handoff and START_HERE were independently read as a new-context
entry; all 37 relative links resolved and no authority expansion was found.
The shared historical handoff and original checkout remain preserved.
