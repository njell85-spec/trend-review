# Selection follow-up — bounded local work

Base: PR #165, `5dc5d166b9a45be9c2d0841913a53c8c9664aece`.
Branch: `codex/selection-followup-20261019`; no publication in this pass.

1. Reconcile the current ledgers with official source metadata for a small set of
   clinically relevant guideline families. Distinguish discovery gaps from ranking
   failures and age-window exclusions; do not estimate whole-literature recall.
2. Reproduce two evidence defects: publication dates being treated as edition years,
   and model-reported full-text coverage without supplied article text. Preserve
   historical cards and ledgers; prevent recurrence with minimal deterministic guards.
3. Check that fit scoring cannot undo lineage review/supersession. Retain explicit
   human approvals and the existing non-fatal behavior.
4. Run focused offline regressions, then one complete suite and spec-lint only after
   implementation stabilizes. Record commands, failures, limitations, and sources.
5. Update the short current handoff and link the detailed evidence from it. Keep the
   shared historical handoff intact. Do not change scoring weights without validation.
