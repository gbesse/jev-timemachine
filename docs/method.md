---
description: Storage, cache reuse, replay and paired-comparison method used by jev-timemachine.
---

# Method

Corpus rows are append-only versions keyed by the stable source id and a hash of text plus metadata. Judgments are stored separately per item hash and per individual question fingerprint, so changing one question does not invalidate the other answers in the policy.

DecisionPacks v1 rules are evaluated in order with exact typed comparisons. `whatif` changes only code-owned predicate values and never invokes a provider. Timeline buckets describe changes in incoming data, not model degradation, because the model version remains pinned.

Policy comparison uses the same items. Accuracy intervals are Wilson intervals and the difference uses McNemar's exact two-sided binomial test over discordant pairs. Its p-value is evidence about sampling variation, not a business decision or a measure of effect size.
