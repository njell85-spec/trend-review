# Substantive selection evaluation

Baseline: `96600bc489c76e0657914d27dc02d9e270113cb4`.
[Source protocol and limitations](selection-evaluation-sources.md),
[frozen judgments](selection-evaluation-set.json),
[retained-stage trace](selection-evaluation-trace.json).

The small source-first set supports keeping clinical usefulness as the first
selection criterion. It does **not** establish that the system misses a specified
fraction of important literature, nor justify changing the acquisition window,
journal list or historic adoption decisions by itself. Concrete decision value,
evidence uncertainty and document family need separate assessment; a prestigious
journal or broad topic match is insufficient.

## Denominators and observed stages

Twelve new source-first cases span four papers, four guidelines and four narrative
reviews, across five clinical areas. Only five are in the present acquisition
windows; seven are deliberately dated references. Four known boundary families
are separate, excluded controls.

| Stratum | Paper | Guideline | Narrative review | Total |
|---|---:|---:|---:|---:|
| Current window | 1 | 1 | 3 | 5 |
| Dated reference | 3 | 3 | 1 | 7 |
| Development | 2 | 2 | 2 | 6 |
| Holdout | 2 | 2 | 2 | 6 |

Development contains four current cases; holdout only one. All labels are positive
editorial-consideration judgments. This is not a balanced test of current discovery,
specificity, calibration, or clinical safety.

At baseline, **2/5 current cases have retained publication evidence** and **3/5
have unknown acquisition** in the inspected data. None of the seven dated cases
has a matching retained ledger record. These are descriptive observations, not
recall estimates. No current sample case is proven to have been acquired and then
incorrectly rejected by a selection filter.

Exact PMID tracing examined top-level `output/*.json` and `experiments/*.json`,
the three published HTML files, and the relevant ingestion/filter/rank code.
Downstream presence proves that an item was retained; absence cannot establish
whether it was never searched, unavailable in an earlier snapshot, excluded,
removed before retention, or outside a configured window. The retained census is
dated 2026-08-16; it is not the complete historical raw candidate pool.

| Cases | Acquisition/retention | Filter and rank evidence | Publication |
|---|---|---|---|
| P4 / 41159835 | Selected-paper ledger plus analysis archive | `llm_reranked`, pool size 32 retained; exact competing pool/rank unavailable | Research HTML, 2026-08-16 |
| R2 / 39467606 | Historical census review axes and review published ledger | Base score 8; stored fit 9/keep true; exact historical competing rank unavailable | Review HTML, 2026-09-08 |
| G3, R1, R3 | No exact PMID in inspected retained records | Historical filter/rank unknown | No matching HTML reference |
| P1–P3, G1–G2, G4, R4 | No exact PMID in inspected retained records; outside current acquisition windows | Historical filter/rank unknown | No matching HTML reference |

The trace records a separate title-only document-type check. It does not recreate
historical scoring, claim source-derived MeSH or publication types, or invent a
rank for an absent candidate. Source metadata missing from the fixture stays null.

## Clinical value and policy decisions

**Keep the priority on a concrete ER/ICU decision.** Airway preparation, early
shock resuscitation, antibiotic duration, transfusion thresholds in brain injury
and DKA/HHS management have direct clinical uses. A null trial result can still be
important; a guideline's relevance does not imply high-certainty evidence.
The selected shock trial's stored clinical question and main outcome distinction
agree with the primary source's composite/organ-support emphasis. This limited
check is not a complete factual audit of the clinical card.

**Journal scope is an explicit tradeoff.** Current AJEM sepsis-management and
physiologically difficult-airway reviews are clinically plausible refreshers.
Their absence is compatible with the documented six-journal default in
[scripts/build-review-queue.mjs](../../../scripts/build-review-queue.mjs), lines 11–15.
The census definitions in
[scripts/guideline-census.mjs](../../../scripts/guideline-census.mjs), lines 39–45,
exclude AJEM even from the wider set. The live review stage reads the existing
reservoir; it does not perform a fresh broad review search. This limits scope
before ranking. Expanding it would change an existing reader preference and
requires a deliberate policy decision; these two examples do not prove a
historical search malfunction.

**The current IDSA AMR guidance deserves visibility for consideration**, subject
to US/local microbiology and formulary differences. Its absence from retained data
is unknown acquisition. Its title vocabulary may expose a gap in queries or
topic matching, but complete source PT/MeSH, historical search results and the
raw selection pool were not recovered. Do not convert this conditional concern
into a claimed acquisition failure or automatic adoption. A newer guidance edition
should be compared with its older family before being treated as independent news.

**Narrow topics can be useful.** The dated ECMO antimicrobial-dosing review and
known hematologic-emergency control have concrete ICU decisions despite narrower
audiences. Low frequency, low evidence certainty and low clinical usefulness are
different properties. Keep the held records and reader controls. No historical
approval, rejection, status, clinical text or publication history was changed.

**Do not tune recency or hard topic quotas from this sample.** Older sources can
be valuable references while legitimately outside automatic collection windows.
Family controls also show why card counts differ from independent recommendation
counts: co-publications and executive summaries need explicit relationships.

## Existing topic concentration

These are counts of existing top-level `topic` fields, without relabeling titles.

| Ledger | Total | Topic present | Topic missing | Cardiac/resuscitation among labeled |
|---|---:|---:|---:|---:|
| Selected papers | 106 | 58 | 48 | 31/58 (53.4%) |
| Published reviews | 63 | 62 | 1 | 25/62 (40.3%) |
| Published guidelines | 76 | 0 | 76 | Not measurable using this field |

Other labeled paper topics: respiratory/airway 17, sepsis/shock 9, infection 1.
Other labeled reviews: respiratory/airway 14, sepsis/shock 7, neuro 7, infection 5,
trauma 2, vascular/GI/other 1, general ER/ICU 1. Forty-eight untagged papers prevent
a claim that cardiac articles are a majority of all 106 selected papers. Guideline
concentration cannot be inferred from a completely absent comparable field.
These labels are system metadata, not an independent clinical taxonomy.

The observed concentration warrants monitoring and complete topic coverage before
retuning weights. It does not establish editorial over-selection without knowing
candidate supply, practical importance, manual decisions and publication cadence.

## Known controls and implementation boundary

PADIS remains retained in the review reservoir, with positive fit, but is excluded
from automatic review publication by document type. It is not a search miss.
The ketamine co-publication remains held for lineage review while its counterpart
is published. The ARDS main/summary family is already published, and its duplicate
review-reservoir entry is ineligible there. The narrow hematologic-emergency review
remains held. Current helper eligibility was checked without changing any record.

This report describes baseline evidence and policy/value tradeoffs. Demonstrated
logic corrections and their exact tests belong in
[selection-evaluation-changes.md](selection-evaluation-changes.md); post-freeze
holdout results and release checks belong in
[selection-evaluation-validation.md](selection-evaluation-validation.md).
A change in a local deterministic score is not proof of improved real-world recall.

## Post-freeze deterministic replay

After the source patch was frozen as bundle
`31dfe4e170548f2342bdccad47cf1c3ee3779167c82994fb7cb4750cca9e7178`,
the holdout was released for independent evaluation. Baseline source from
`96600bc` was extracted into a temporary directory outside the repository and
compared with the frozen patch using identical bibliographic inputs and a fixed
2026-10-19 clock. Network access was blocked. Missing abstract, MeSH and publication
types remained empty; no rationale was substituted as source evidence.

[Replay evidence](selection-evaluation-replay.json) records **12/12 unchanged**
metadata scores and title-type checks, including **6/6 unchanged holdouts**.
Guideline rule scores were also unchanged for all four guideline cases. This is
neither a failed regression nor demonstrated clinical improvement: these real
source cases do not exercise the corrected malformed-fit, negated-title or refill
integration conditions. The limited inputs are not full PubMed scoring or an
observed historical rank.

A separately labeled synthetic null-fit control changed from `needsReview` to
preserved `queued`, confirming that missing evidence no longer becomes a negative
fit judgment. It is excluded from the 12-case clinical denominator. Independent
code review and the author's focused contract tests cover the other corrected
conditions. No case was replaced and no selection rule was tuned after holdout
inspection. The frozen sample and all source-patch hashes matched their recorded
values at replay time.

Validation for these evidence files: JSON parses; 12 unique new IDs; four cases
per track; six cases per split; five current and seven dated cases; four separate
known-control families; immutable freeze hash verified. No collection, model
analysis, queue mutation, paid call or full test-suite rerun was performed.
