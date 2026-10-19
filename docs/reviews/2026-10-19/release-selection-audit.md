# Release selection audit — 2026-10-19

Candidate snapshot: `39363ae92a3d3fa72830077823a79165fa518748` (106 papers,
76 guidelines, 63 reviews). Implementation base: integration commit `b24377b`.
The earlier 105/75/62 counts describe an older snapshot.
This is a bounded candidate/source audit, not an overall recall
measurement, complete historical replay, clinical gold standard or holdout.

## Proven defects and implemented fixes

1. **Review type filtering preceded reranking and covered only the raw head.**
   `_stageReview` previously removed non-narrative items from the front of the
   stored array, then ranked the rest. A higher-ranked guideline later in the
   array could be analyzed without passing that check. On the pinned snapshot,
   the raw head is narrative PMID 42508832; 32 type-ineligible documents appear
   among 195 status-eligible candidates. Examples: dexmedetomidine guideline
   35587274 at rank 10; ARDS 41773929 at rank 25 (already guideline-published);
   PADIS 39982143 at rank 63. The exact list is in the adjacent JSON.

   `src/utils/reviewRank.js` now applies document eligibility to every candidate,
   shared by preview and selection. `_stageReview` no longer permanently rejects
   entries based on their original array position. Held entries and historical
   rejection records remain intact; explicit promotion/manual approval bypass
   the type filter. Existing fit scoring and negative-fit policy are unchanged.
   On this retained snapshot the eligible count becomes 163, not a recall score.

2. **A title topic was mistaken for document identity.**
   PMID 41841954, *The Effective Management of Shock: Moving From Physiology to
   Guidelines to Personalized Medicine*, is indexed as Review; its abstract
   describes a historical perspective, with Practice Guidelines **as Topic**.
   The old unrestricted `guidelines?` keyword rejects it. The title grammar now
   recognizes guideline-document forms, including institutional coauthorship,
   while admitting this verified review. All 32 type-ineligible candidates above
   remain excluded from automatic review selection. This grammar is still a
   title heuristic, not exhaustive document classification. [Primary abstract](https://pubmed.ncbi.nlm.nih.gov/41841954/).

3. **An empty paper track aborted independent tracks.**
   `run()` returned before guideline/review processing after either empty
   collection or all candidates failing validation. Both branches now reuse
   `_runWithoutPapers`, retaining their warning. Mock integration checks exercise
   both conditions, publish success/failure, review rollback and absence of a
   second collection/refill or paper analysis. This does not establish the
   underlying cause of the historical 9/18 empty search response.

## Primary-source checks and remaining data work

- **PADIS 39982143:** SCCM identifies it as its clinical focused update, with five
  statements and a link to the 2018 parent guideline. Its placement in the review
  reservoir is not evidence of total search omission. The current guideline
  ledger has no entry. Route with verified SCCM metadata in a separate data
  correction; do not declare the complete 2018 document superseded. This patch
  holds it from automatic review publication and does not migrate it.
  [SCCM source](https://www.sccm.org/clinical-resources/guidelines/guidelines/focused-update-padis-guideline).
- **Ketamine 39198198/39207913:** the official SSAI-hosted paper explicitly states
  co-publication on page 1. The retained `supersededBy`/`supersedes` relation is
  incorrect; different print years do not prove a new edition. Future automatic
  recurrence was already guarded. Remove the false replacement relation and
  add a sourced co-publication relationship in separate data work, without
  generating a second clinical update. No ledger was edited here.
  [Official full text, p. 1](https://ssai.info/wp-content/uploads/acta-anaesthesiol-scand-2024-amer-ketamine-analgo-sedation-for-mechanically-ventilated-critically-ill-adults-a-rapid.pdf).
- **ARDS 41773929/41773928:** SCCM links the full guideline and executive summary
  as related resources. Preserve both identifiers, add a main-document/summary
  relation, and avoid counting them as independent editions. No automatic
  deletion or merge was performed. [SCCM source](https://www.sccm.org/clinical-resources/guidelines/guidelines/guidelines-for-the-administration-of-neuromuscular-blockade).
- **36322846:** the old review card still combines `coverage=full-text` with
  `fullTextSource=abstract-only`. Stored mirror links do not establish what was
  actually read. No unverified mirror was opened, and no translation was
  reconstructed. Prior-card correction remains separate from prospective guards.

## Selected and held candidates

- **38748265 merits re-review:** its retained fit is 5/keep:false and the only
  reason is that emergency chemotherapy in the ICU is a narrow topic. The
  abstract and open article cover initial recognition/management of leukostasis,
  tumor lysis, DIC and related emergencies; this is relevant to the stated
  adult ICU audience. The fit prompt itself allows narrow clinical topics at
  6–8. This supports reconsideration of the reason, not automatic promotion or a
  claim that every niche paper should be selected. [Abstract](https://pubmed.ncbi.nlm.nih.gov/38748265/),
  [open article](https://pmc.ncbi.nlm.nih.gov/articles/PMC11164740/).
- **41324946 is a relevant rejected paper, but rejection intent is unknown.**
  The primary abstract describes a 205-patient multicentre randomized trial in
  severe cardiogenic shock on VA-ECMO. The queue has score 9.7 and a rejection
  date, without a reason. It may reflect an explicit user removal; do not undo
  that on a relevance judgment. The missing rationale limits auditability.
  [Primary abstract](https://pubmed.ncbi.nlm.nih.gov/41324946/).
- **39178492 and 39437797 are policy-boundary candidates, not proven bugs.**
  The retained guideline records identify practice guidelines but no approved
  organization, no matched topic, and scores below the review threshold. ESPEN
  and ASH are outside the configured organization list. Changing that list is
  an explicit scope decision. Conversely, 39361081 is already present in the
  guideline queue despite being held in the review queue; it is not absent.
- **Latest paper 42637214:** the primary abstract confirms the displayed
  1,644 enrolled, 416 survivors, 354/307 follow-ups and 30.5%/33.6% cognitive
  impairment. It is observational survivor follow-up, relevant to post-arrest
  care. Its ledger records deterministic selection from a pool of one, with
  low confidence; that does not show comparative clinical superiority over
  unavailable candidates. The abstract does not substantiate a treatment effect.
  [Primary abstract](https://pubmed.ncbi.nlm.nih.gov/42637214/).

Paper topic metadata now identifies cardiac/resuscitation in 31 of 58 tagged
papers, with 48 untagged. Reviews have 25/63 in that group, with one untagged.
Concentration is observed; candidate-pool inadequacy prevents attributing it to
weights or estimating important omissions. No weights were changed.

## Verification and limits

- Focused review selection/filter/fit/stage/queue tests: **54/54 passed**.
- Paper queue/integration tests: **13/13 passed**.
- Final guideline-title boundary and review integration tests after the additional
  coauthor-title boundary: **13/13 passed** (overlaps the first set).
- `spec-lint`: 6 groups, 80 files, zero warnings. Orchestrator syntax and diff
  whitespace checks passed. Full 971-test suite was not repeated by this worker.
- Initial focused attempts failed on Windows sandbox TEMP atomic rename with
  EPERM. Workspace TEMP/TMP reruns passed; no permissions were relaxed. Tests
  used the existing offline guard and mocked analysis; no paid model, live
  publication, external notification or production state mutation was invoked.
- Adjacent JSON records pinned input hashes, candidate evidence and passing-log
  hashes. Candidate inspection and code authorship are not independent review
  of this new patch; a separate reviewer must evaluate it.
- Source checks are limited to the linked primary pages/abstracts and identified
  passages. No claim of complete full-text clinical accuracy, exhaustive search,
  current guideline completeness or improved clinical precision is made.
