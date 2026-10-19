# Historical metadata closure — 2026-10-19

Baseline: deployed `11ae9729c0ff2133200ab3de93fe830cece1af8a`.
This correction changes nine fields across five existing records. It does not
rewrite clinical text, change publication dates, adopt a candidate, reverse a
rejection, remove an entry or produce a new publication.

## Corrections

**Ketamine co-publication (39198198 / 39207913).** The official SSAI-hosted
article identifies co-publication on PDF page 1. Page 16 additionally states
that the articles differ only in journal style/spelling and either citation is
usable. Different print years therefore do not establish a new edition.
[Official article](https://ssai.info/wp-content/uploads/acta-anaesthesiol-scand-2024-amer-ketamine-analgo-sedation-for-mechanically-ventilated-critically-ill-adults-a-rapid.pdf).

- Unpublished 39198198: `status` changes from `superseded` to `needsReview`;
  existing `lineageReview:true` remains. `lineageReason` changes from
  `candidate-not-newer` to `co-publication-not-new-edition`. False
  `supersededBy:pmid:39207913` and `supersededAt` fields are removed.
- Published 39207913: `supersedes:[pmid:39198198]` becomes an empty array.
  Its existing `card.sources` gains the other PMID with an explicit
  co-publication label, stating that this is not a newer/older edition relation.
- The unpublished article remains held. Nothing is promoted or republished.

**ARDS main guideline / executive summary (41773929 / 41773928).** The SCCM
guideline page links its executive summary under Related Resources. The main
and summary records retain their status, dates, separate identifiers and
clinical text. Their existing rendered `card.sources` lists gain reciprocal
links labelled “공식 요약” and “지침 본문.” Neither is marked superseded.
[SCCM source](https://www.sccm.org/clinical-resources/guidelines/guidelines/guidelines-for-the-administration-of-neuromuscular-blockade).

**Respiratory review provenance (36322846).** The old card claims
`coverage:full-text`, while `fullTextSource:abstract-only` records no supplied
full text. It has no generation-evidence record proving what was actually read.
Its old mirror links alone cannot establish access or article completeness.
`card.coverage` changes to **`unverified`**. Sources and every clinical/translated
section remain unchanged. No mirror was opened and no synthetic evidence receipt
was added. This is not an assertion that the preserved text contains only
abstract-derived material.

The renderer must show this exact notice for `unverified` coverage:

> 전문 확보·열람 근거를 확인할 수 없습니다. 기존 번역 내용은 보존했으며 전문 대조는 검증되지 않았습니다.

## Completed evaluations that do not justify automatic changes

**PADIS 39982143.** SCCM confirms a clinical focused update linked to the 2018
parent guideline. It belongs conceptually with guideline material, but moving it
into a publishable guideline queue would be an adoption decision. It remains in
the review reservoir, held from automatic publication by the existing document
type filter. Its original score, fit and status are preserved. The remaining
decision is whether to adopt it into the guideline track; this audit does not
infer that choice or treat the 2018 document as wholly replaced.
[SCCM source](https://www.sccm.org/clinical-resources/guidelines/guidelines/focused-update-padis-guideline).

**38748265.** The primary abstract and open article cover initial recognition
and management of hematological emergencies in the ICU, supporting relevance
despite the original “narrow topic” exclusion reason. The original model score,
reason and `needsReview` state are preserved: rewriting a historical model
reason would misrepresent that decision, and the source does not automatically
authorize promotion. The remaining choice is whether this focused review should
be included for this reader. [Abstract](https://pubmed.ncbi.nlm.nih.gov/38748265/),
[open article](https://pmc.ncbi.nlm.nih.gov/articles/PMC11164740/).

**41324946.** Its primary abstract confirms a relevant randomized VA-ECMO
trial, but the stored rejection lacks an actor/reason. Clinical relevance
cannot establish whether the user deliberately rejected it. Its paper queue
record is untouched. Reversal requires the original intent or a new explicit
choice. [Primary abstract](https://pubmed.ncbi.nlm.nih.gov/41324946/).

## Exact dashboard changes for the publisher

- The existing 2026-10-04 ketamine card (39207913) gains the labelled
  co-publication source link. It had no predecessor/successor badge to remove;
  the false replacement relationship was stored in the ledger, corrected above.
  There is no published 39198198 card to restore or create.
- Existing ARDS cards dated 2026-08-21 (41773929) and 2026-09-11 (41773928)
  each gain the corresponding source link; do not remove either card or change
  edition/status badges.
- Existing 2026-10-18 respiratory review (36322846) gains the provenance notice
  above. Preserve all existing translations and source links. Do not use the
  stock abstract-only sentence claiming only the abstract was translated.
- No new card, adoption or queue promotion for PADIS or the two held/rejected
  clinical candidates. HTML editing and renderer checks are performed separately
  from this metadata change.

## Verification

`scripts/correct-closure-metadata.mjs` defaults to dry-run; `--apply` writes only
the two owned state files using their existing schema writers. It validates the
target identities and prior evidence, refuses newly supplied coverage evidence,
and detects input changes before writing. Related-document labels use the
existing rendered `card.sources` field; no unused relationship table is added.
The explicit `unverified` coverage state is paired with renderer support.

The application changed nine fields. A second dry-run produced **zero changes**.
Focused deterministic checks passed **4/4**: idempotence, held-state preservation,
unchanged clinical content/identifiers/publication history, unchanged other
candidates, and failure on missing/duplicate identities or changed evidence.
The real ledgers retain guideline queue/published/rejected counts **656/76/131**
and review counts **334/63/3**. A full suite was not rerun for these metadata edits.
The adjacent [JSON evidence](closure-metadata.json) records exact old/new fields,
input/output hashes, primary-source locations and test-log hash.

This closes the metadata errors supported by current evidence. It does not
establish the clinical accuracy/completeness of old translations, a universal
publication-family model, exhaustive guideline coverage or the intent behind
unexplained historical rejection.
