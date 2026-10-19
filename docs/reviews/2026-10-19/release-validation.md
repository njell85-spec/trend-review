# Release validation

Implementation commit: `4e32bb111d5d8dee5c5a95f31baa9afff548e759`.
Daily-state integration: `b24377bd1d1d0a9088df76640b98a8c2143dae11`, incorporating
remote `39363ae92a3d3fa72830077823a79165fa518748` without rewriting the original
checkout. The original main remains at `475cd0c`, clean and 46 commits behind at
the preservation check. Prior unpublished follow-up `4fe3d88` is an ancestor.

## New implementation checks

| Check | Actual result |
|---|---|
| Author review selection/filter/fit/stage/queue | 54/54 passed |
| Author paper queue and empty-track integration | 13/13 passed |
| Final title-boundary integration | 13/13 passed, overlapping prior set |
| Independent new-path review | 5/5 passed; no confirmed P0/P1/P2 blocker |
| Spec lint | 6 groups, 80 files, zero warnings |
| Syntax and diff whitespace | Passed |
| Full suite repeated locally | Not run; new release CI must cover the release head |
| Paid model/live pipeline/notifications | Not invoked |

The independent five tests cover four `reviewEligibility` cases and the new
empty-paper integration case (both empty conditions, publication success/failure,
rollback and no extra refill/analysis). External fetch and model CLI were blocked,
with analysis mocked. Both authorship and independent runs initially encountered
Windows sandbox temporary-directory rename EPERM; workspace TEMP/TMP passed
without permission changes. A later source edit only corrected a stale comment.

The independent reviewer also inspected cache/source-evidence integration and
compared daily state against `b24377b`. Earlier author 971/971 and independent
18 synthetic cases plus 5 regressions apply to code `2f20d6c`, as documented in
[the earlier validation](validation.md); they are not presented as full execution
of this release. [Audit JSON](release-selection-audit.json) records new passing
log hashes and pinned input hashes.

## Publication and rendering boundaries

- All operational ledgers and `index.html` / `reviews.html` are unchanged from
  remote `39363ae`. `guidelines.html` retains only the previously reviewed empty
  synthesis PubMed-link correction. Existing cards, table rows and clinical text
  are preserved.
- The existing renderer was applied to each upcoming block only, with date
  `2026-10-19`. Every byte outside those blocks was compared, as were all section
  and table identifiers (140 / 149 / 124). The regenerated seven-day previews
  have no normalized Git diff: affected review candidates are deeper in the queue.
- Public-site DOM checks at 390px and 800px found no horizontal page overflow
  on the three current pages. At 390px the newest paper card was also expanded.
  Screenshot capture timed out, and the connected browser could not reach the
  temporary local preview server. The server was stopped and the viewport reset.
  This is DOM/layout evidence, not a completed pixel-level mobile visual review.
- The existing GitHub Pages source is `main:/`, with no hosting or permission
  change. Deployment destination: [Trend Review](https://njell85-spec.github.io/trend-review/).
  [PR #165](https://github.com/njell85-spec/trend-review/pull/165) is the release
  record for the exact merged SHA, release CI and Pages build links. Its completion
  evidence must be checked before treating a branch push as deployment success.
- A Pages deployment checks static delivery. It does not execute the next
  scheduled clinical analysis. Do not manually invoke the daily workflow merely
  to verify deployment: it can call models and send notifications.

## Remaining limits

The title grammar is a heuristic. Kept/held counts are not clinical accuracy or
recall. Historical copublication/summary relationships, PADIS routing, missing
rejection reasons, and prior coverage conflicts remain explicit data-review
items in [the release audit](release-selection-audit.md). No missing clinical
text was invented, and no patient information or private conversation was used.
