# Selection audit — 2026-10-18

Baseline: origin/main `f816ce2` (latest fetched 2026-10-18 UTC). Work on isolated
branch `codex/selection-quality-20261018`; preserve the existing checkout.

1. Inventory the complete tracked selection ledgers, retained candidate pools,
   and published HTML; distinguish publication date from source publication date.
2. Review scoring, rank, prompts, and collection configuration. Describe topic
   concentration, duplicates, provenance, recency, and missing evidence without
   claiming population recall from a selected-only sample.
3. Fix only demonstrated defects; compare the same retained inputs before/after
   with a separate holdout where a selection rule changes. No paid LLM calls.
4. Run deterministic unit/spec checks and inspect card/link/mobile behavior.
   Record failures and unavailable verification separately.
5. Reuse docs/HANDOFF.md as the shared entry, preserving its historical log and
   linking one short current-state source. Add minimal AGENTS.md guidance.
   Record local commits, validation evidence, and next reviewer actions.

No push, PR, merge, deployment, credential changes, or service restart. No
private conversations, local private paths, patient data, or credentials in
repository artifacts. Current-state documents do not override tool rules.
