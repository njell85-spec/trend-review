# Closure validation — 2026-10-19

Implementation: `87739c8e5a0f186b7adaedde4c7c1a1a668e7a99`.
Base: deployed `11ae9729c0ff2133200ab3de93fe830cece1af8a`.

## Changes and executed checks

- [Historical metadata](closure-metadata.md): nine field corrections in five
  existing records, with **4/4** focused tests. A second dry-run makes zero edits.
- [Upcoming dates](closure-dates.md): **62/62** focused tests, including seven
  new tests. PMID 42059919 moves from October 19 to October 20 after the recorded
  daily publication. Manual extras, failed runs and the original window remain distinct.
- Historical `unverified` coverage rendering: **30/30** review-translation
  tests, including a new test for the evidence-gap notice and preserved text.
  New model output enums are unchanged; this state records a retrospective conflict.
- Syntax checks and `git diff --check` passed. Spec lint passed: six groups,
  80 files, zero warnings. No separate type or build command is defined.

The focused tests used an offline guard blocking external fetch and model CLI
execution. No real daily collection, analysis, publication notification or paid
model call was run. A full local suite was not repeated.

## Independent review

A reviewer separate from both patch authors found **no P0/P1/P2** within this
scope. It independently passed 12 focused tests (overlapping author sets)
and 72 additional scheduling scenarios across year boundaries, tracks, modes,
sequential settings and outcomes. It checked exact nine-field ledger changes,
idempotence and unchanged unrelated records/history/clinical content.

The reviewer compared all three HTML pages with base 11ae972. After normalizing
CRLF to LF, every existing byte is preserved outside upcoming blocks and exactly
three added related-document links plus one coverage notice. All cards and table
identifiers remain. The ketamine card had no false edition badge; only the ledger
relation was removed and the source link added.

| Page | Final normalized HTML SHA-256 |
| --- | --- |
| index.html | `179142341ef62ed84b4dc17e54d82035ebefa326f54db3a163b14632acd9e6cc` |
| guidelines.html | `cffb30c794702570a2519eaf45a3d98226bdfdd849b4646af4da229b50437eb0` |
| reviews.html | `be323cd7f0a5aafc11345a23e1d4c8f2ab5c3a8c7832bc53e4ebd80609f02640` |

## Failed attempts and limits

- An initial date test asserted whole-document byte idempotence despite existing
  renderer separator differences. The corrected block/body test passed.
- The independent disk test initially used a missing temporary directory; its
  focused rerun passed. Initial HTML comparison needed Git line-ending normalization.
- The targeted HTML helper initially expected `gl-body`, while the review uses
  `pc-body`. It stopped before editing that review. Corrected execution and full
  baseline-preservation comparison passed.
- A fresh public-page browser tab at 390×844 timed out on screenshot capture.
  This is not pixel validation. Earlier 390/800px DOM checks found no horizontal
  overflow; final deployment DOM evidence is recorded with the release.
  Local preview connectivity also remains unavailable.
- Daily consumption markers precede deployment. Paper/guideline durable rollback
  remains an existing limitation. Retained translations have not received clinical
  or source-completeness validation. The historical notice is supported in the
  website renderer; arbitrary old digest regeneration was not exercised.

## Release evidence

The implementation SHA above is fixed. Remote CI, merge and GitHub Pages runs
are separate checks and will be linked after execution; local checks do not
imply deployment. The [handoff](../../../HANDOFF.md) distinguishes source,
integration and documentation revisions.
