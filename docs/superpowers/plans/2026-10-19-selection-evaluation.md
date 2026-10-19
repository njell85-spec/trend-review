# Substantive selection evaluation

Base: `96600bc489c76e0657914d27dc02d9e270113cb4`.

1. Freeze a small primary-source reference sample before changing selection
   rules. State topic/track strata, dates, sampling limitations and uncertain
   labels. Keep known diagnostic controls separate from new sample results.
2. Separate development and holdout cases. Keep holdout labels away from the
   implementation author until the proposed patch is fixed.
3. Trace observed stages: acquisition evidence, filters, scores/ranks, queues,
   publication and historical/manual decisions. Absence in retained data alone
   does not prove search failure. A cross-track retained item is not a search miss.
4. Correct only demonstrated policy/logic defects. Preserve clinical content,
   manual adoption/rejection, publication history and source limitations. Record
   recommendations where a reader decision remains necessary.
5. Use deterministic focused checks, an independent review and the frozen
   holdout. Report before/after cases and tradeoffs with actual denominators;
   do not assert whole-literature precision/recall or clinical validation.
6. Publish approved fixes through a separate branch and verify existing CI/Pages.
   Update current handoff and catch-up links with exact source/deployment evidence.

No real daily collection/clinical-analysis run, new automation, paid model API,
permission or authentication change is part of this evaluation.
