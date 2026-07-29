throw new Error(
  "Stage 7D bulk ledger repair is disabled: the 99/107 mappings were inferred " +
    "from timestamp proximity and are not independently proven. The audited " +
    "repair manifest contains zero actions; see " +
    "docs/operations/tenant-stage-7d-independent-audit.md.",
);
