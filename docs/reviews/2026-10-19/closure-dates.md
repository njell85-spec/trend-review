# Upcoming dates after daily publication

Base: deployed main `11ae9729c0ff2133200ab3de93fe830cece1af8a`.

## Reproduction and correction

The review state records PMID `41841954` as successfully published on
`2026-10-19`. Rendering the remaining ranked queue from that date previously
assigned its head, PMID `42059919`, to `2026-10-19` again. With the correction it
appears on `2026-10-20`, followed by PMID `42555934` on `2026-10-21`.

`src/utils/upcomingSchedule.js` now reads the explicit successful daily run
marker while calculating dates. Paper and review queues provide
`lastRun.date`; guideline state provides the date on the published entry matched
by `lastRun.publishedId`. Observation, failed runs, unresolvable identifiers,
invalid dates, promotions and `updatedAt` do not establish a consumed daily slot.
The calculation does not modify any queue, history or control state.

The original `from`/`days` window stays fixed: a seven-day window beginning
October 19 ends October 25, and a consumed first day leaves six daily slots.
Off, alternate and sequential modes still use `trackRunsOn`. Reviews retain
their runtime minimum interval, including the two-day gap in alternate mode
after a mode change. Weekly compatibility yields at most one eligible slot in
the same window.

No publisher changes were necessary: its existing disk renderer already passes
the full track state to `buildUpcoming`. No ledger, HTML, clinical text,
notification, workflow, credential or permission changes belong to this patch.

## Manual publications and evidence limits

On-demand publication appends or consumes history without advancing `lastRun`.
The preview therefore preserves the existing distinction between a manual extra
and the scheduled daily slot. A manual item alone does not postpone the next
automatic item; a same-day daily success still does. Changing that policy would
require an explicit product decision and matching runtime changes.

Daily consumption records are written before the publisher renders the page.
They are the current scheduling evidence, not a deployment receipt. Review
publication failures restore the prior queue state. Paper and guideline state
do not provide an equivalent durable deployment-success receipt; this patch
does not infer one or redesign publication transactions. A run explicitly
recorded as failed/observation does not consume a slot.

## Verification

Targeted tests: **62/62 passed**, failures/skips/cancellations 0, 570.4892 ms.
Seven new tests cover production-shaped data, fixed windows, guideline linkage,
manual/failed/invalid records, all control modes, weekly compatibility, and the
actual disk renderer. Repeated renders produce identical upcoming blocks and
preserve the fixture body. The first run passed 61/62: a new assertion demanded
whole-document byte idempotence, but the existing renderer adds separator
newlines. That assertion was narrowed to the owned blocks and preserved body;
the renderer was not changed.

```sh
node --import ./output/offline-test-guard.mjs --test --test-reporter=tap test/upcomingPublicationDates.test.mjs test/upcomingSchedule.test.mjs test/trackCadence.test.mjs test/upcomingRender.test.mjs test/upcomingConsumed.test.mjs
npm run spec-lint
git diff --check
```

The test guard blocks external fetch and model CLI execution. Fixtures use a
temporary directory. Spec lint passed: 6 groups, 80 files, 0 warnings.
`git diff --check` passed. No full-suite rerun or real daily pipeline was used.
Independent review, final HTML refresh, remote CI and deployment are separate
release steps. [Machine-readable evidence](closure-dates.json) records hashes.
