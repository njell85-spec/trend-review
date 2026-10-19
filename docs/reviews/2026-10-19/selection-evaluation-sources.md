# Primary-source selection reference set

Frozen file: [selection-evaluation-set.json](selection-evaluation-set.json).
SHA-256: `c45145458531d357f4d20a864ca139bbd4df357addd6e2e289f932e5097e41ed`.
Declared freeze: 2026-10-19 10:25:51 UTC, before repository outcome inspection.
A pre-freeze draft was revised to separate date strata and clarify a bibliographic
date; the final file is immutable. Corrections or later verification belong here.

This convenience sample includes 12 source-first cases from 2023-01-01 through
2026-10-19: four papers, four society normative documents and four narrative reviews
across five ER/ICU topic areas. It is not an exhaustive search or a random sample.
Clinical practicality, importance, evidence, recency, family and topic are separate
judgments in the JSON. Labels mean **eligible for editorial consideration**, not
mandatory publication, validated clinical advice, or demonstrated treatment benefit.

Only **five cases are in the current acquisition windows**: one paper within 360 days,
one guideline within two years and three reviews within two years. Seven dated
references (three papers, three guidelines, one review) cannot demonstrate current
collection failures. Four previously known boundary families are separate controls.
Two cases per track were assigned to development and two to holdout before outcome
inspection. Development has four current and two dated cases; holdout has one current
and five dated cases. This age imbalance sharply limits current-acquisition conclusions.
Positive-only labels cannot estimate precision, specificity or literature recall.

## Source register

The following notes describe the evidence actually inspected. Full abstracts and
article text are not copied into public fixtures. Null abstract, MeSH or publication
type fields mean not retrieved, not absence from PubMed. Clinical rationale must not
be substituted for a retrieved abstract in counterfactual scoring.

| Case | Primary sources | Verification and limits |
|---|---|---|
| P1 / 38869091 | [PubMed](https://pubmed.ncbi.nlm.nih.gov/38869091/), [journal DOI](https://doi.org/10.1056/NEJMoa2313680) | Primary PREOXI trial. Bibliographic metadata/source excerpts; no full risk-of-bias appraisal. |
| P2 / 39565030 | [PubMed](https://pubmed.ncbi.nlm.nih.gov/39565030/), [journal DOI](https://doi.org/10.1056/NEJMoa2404991) | Primary BALANCE trial. Online 2024-11-20, print 2025-03-13; noninferiority does not remove population exclusions. |
| P3 / 38869931 | [PubMed](https://pubmed.ncbi.nlm.nih.gov/38869931/), [journal DOI](https://doi.org/10.1056/NEJMoa2404360) | Primary HEMOTION trial. Nonsignificant neurologic-outcome difference does not establish equivalence. |
| P4 / 41159835 | [PubMed](https://pubmed.ncbi.nlm.nih.gov/41159835/), [journal DOI](https://doi.org/10.1001/jama.2025.20402) | Primary ANDROMEDA-SHOCK-2 trial. Post-freeze primary-page check confirms print 2025-12-09 and online 2025-10-29; frozen labels/windows unchanged. Composite benefit is not a mortality claim. |
| G1 / 39052901 | [PubMed](https://pubmed.ncbi.nlm.nih.gov/39052901/), [journal DOI](https://doi.org/10.2337/dci24-0032) | Multisociety adult DKA/HHS consensus. Parallel versions require family comparison before adoption; not primary trial evidence. |
| G2 / 38316735 | [PubMed](https://pubmed.ncbi.nlm.nih.gov/38316735/), [journal DOI](https://doi.org/10.1007/s12028-023-01907-x) | NCS normative guideline. June 1 is an issue-month placeholder, not a verified day; online 2024-02-05. |
| G3 / 42570093 | [PubMed](https://pubmed.ncbi.nlm.nih.gov/42570093/), [journal DOI](https://doi.org/10.1093/cid/ciag481) | Official IDSA expert guidance. Journal full text confirms 2026-08-08, evidence through 2026-03-01, explicit replacement of earlier editions, US scope and no GRADE methodology. |
| G4 / 37012484 | [PubMed](https://pubmed.ncbi.nlm.nih.gov/37012484/), [journal DOI](https://doi.org/10.1007/s00134-023-07033-8) | Normative severe-CAP guideline. June 1 is an issue-month placeholder. Correction PMID 37195462 accompanies the main document; not an independent recommendation. |
| R1 / 39904062 | [PubMed](https://pubmed.ncbi.nlm.nih.gov/39904062/), [journal DOI](https://doi.org/10.1016/j.ajem.2025.01.054) | Title/journal/dates verified; full abstract/direct publisher access unavailable. Practicality is cautiously inferred from title. Diagnosis companion PMID 39892181 is not automatically a duplicate. |
| R2 / 39467606 | [PubMed](https://pubmed.ncbi.nlm.nih.gov/39467606/), [journal DOI](https://doi.org/10.1136/bmj-2023-076612) | PubMed abstract confirms a broad ARDS clinical review. BMJ direct page returned 403. Mentioning updated guidelines does not make a review a guideline. |
| R3 / 42475841 | [PubMed](https://pubmed.ncbi.nlm.nih.gov/42475841/), [journal DOI](https://doi.org/10.1016/j.ajem.2026.07.017) | Title/journal/DOI, July 11 online and October issue dates verified. Complete abstract unavailable. October 1 is an issue-month placeholder; practicality is inferred from title. |
| R4 / 39367501 | [PubMed](https://pubmed.ncbi.nlm.nih.gov/39367501/), [journal DOI](https://doi.org/10.1186/s13054-024-05101-z) | Post-freeze Critical Care primary-page check confirms 2024-10-04 and narrative-review scope. Narrow ICU dosing relevance is distinct from the limited, heterogeneous PK evidence. No label/window change. |

Additional primary pages checked: [JAMA trial](https://jamanetwork.com/journals/jama/fullarticle/2840823),
[IDSA 2026 journal guidance](https://academic.oup.com/cid/advance-article/doi/10.1093/cid/ciag481/8756906),
[Critical Care dosing review](https://link.springer.com/article/10.1186/s13054-024-05101-z),
and [severe-CAP correction](https://pubmed.ncbi.nlm.nih.gov/37195462/).
Broad queries sometimes returned irrelevant results; those were not used as evidence.
Blocked publisher/PubMed/PMC responses were not bypassed through authentication.

## Known controls

- [PADIS 39982143](https://www.sccm.org/clinical-resources/guidelines/guidelines/focused-update-padis-guideline):
  official guideline already retained in the review reservoir; not a search miss.
- [Ketamine 39198198](https://pubmed.ncbi.nlm.nih.gov/39198198/) /
  [39207913](https://pubmed.ncbi.nlm.nih.gov/39207913/): co-publication family,
  as documented in [the prior primary-source correction](closure-metadata.md).
- [ARDS main 41773929](https://pubmed.ncbi.nlm.nih.gov/41773929/) /
  [summary 41773928](https://pubmed.ncbi.nlm.nih.gov/41773928/): one recommendation
  family with different document roles. Existing publication history is preserved.
- [Hematologic emergencies 38748265](https://pubmed.ncbi.nlm.nih.gov/38748265/):
  narrow ICU clinical usefulness warrants reader judgment, not automatic adoption.

[The retained-stage trace](selection-evaluation-trace.json) and this source register
contain holdout identities. They must be withheld from the implementation author until
the source patch is frozen. The [development companion](selection-evaluation-development.json)
contains only the six development cases. After the source patch bundle
`31dfe4e170548f2342bdccad47cf1c3ee3779167c82994fb7cb4750cca9e7178` was frozen,
the holdout was released to independent evaluation. No sample cases or labels changed.

Date precision clarification: R1's April 1, like G2/G4 June 1 and R3 October 1,
represents an issue month rather than a verified exact day. This does not change
their window strata. Post-freeze verification of P4's online date and R4's exact
publication date is documented above without changing the frozen file.
