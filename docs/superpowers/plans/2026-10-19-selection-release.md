# Selection quality release

Starting local HEAD: `4fe3d887a8e1433e4a6e607c3e8cfbcfe2c3b788`;
implementation: `2f20d6cc6b1125aeb70a19de24e4a219a9aea7de`.
Published draft PR #165: `5dc5d166b9a45be9c2d0841913a53c8c9664aece`.
Fresh remote main: `39363ae92a3d3fa72830077823a79165fa518748`.

1. Preserve the isolated follow-up branch and merge the fresh daily state without
   overwriting existing publications or changing the original checkout.
2. Compare actual selected, rejected and queued candidates against primary source
   evidence. Use the latest remote snapshot, distinguish discovery from ranking,
   and do not infer recall from an incomplete historical candidate pool.
3. Fix only reproduced defects. Keep daily cadence, manual choices, notifications,
   credentials, model providers and operational data outside speculative changes.
4. Obtain independent review and run only regressions justified by new changes or
   integration. Reuse earlier 971-test and independent cache-review evidence at
   their exact SHAs; require CI for the release head.
5. Publish the reviewed changes through the existing PR, merge after checks, and
   verify the existing GitHub Pages deployment. Do not manually run paid analysis
   or send a notification as a deployment smoke test.
6. Record the release SHAs, CI/deployment URLs, limitations and a tool-neutral
   reading order in the current handoff, linking the original shared history.

Budget: inspect official usage before/after major phases; stop new large work at
20% remaining and preserve at least 10%. An unavailable metric is not permission
to continue indefinitely. No paid API calls or new subscriptions/permissions.
