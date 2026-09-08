# V0 Self-Audit — Final Starter Kit

## Overall conclusion

The final starter kit is suitable for beginning the Claude Code V0 build.

The arithmetic model remains a simplified management model, but the synthetic source data, rule configuration, and test oracle are now internally consistent and machine-checkable.

## What is now validated

### Source-data plausibility
- individual labor entries are physically plausible
- employee-day hours are capped
- labor data reaches the close date
- change-order chronology is valid
- cost type and source type are separated
- active vendors are used
- referential integrity is checked

### Finance/reference integrity
- prior/current baseline metrics are independently recomputable from raw source rows
- duplicate invoices are excluded from valid commitment invoicing
- pending invoices are excluded
- rejected COs do not increase contract value
- RNI/commitment treatment preserves the no-double-counting invariant
- billing/retainage ties are deterministic

### Exception oracle
Reference files now include:
- exact positive exception instances
- exact rule counts
- negative/no-false-positive controls
- zero-denominator calculation fixtures

### Documentation
- one repository root name
- actual and documented folder trees agree
- budget basis is defined
- overtime factor is defined
- missing thresholds are configured
- PM missing-explanation semantics are defined
- final technical-review template is wired into completion

## Remaining limitations

1. The source schemas are realistic synthetic exports, not literal Sage/Procore schemas.
2. Draft WIP/revenue logic needs validation with experienced construction Controllers/CPAs before production claims.
3. Physical progress is management input and can be subjective.
4. Customer policies and thresholds are fictional defaults.
5. Security, auth, tenancy, production integrations, and posting controls remain outside V0.
6. AI reviewer agreement does not prove accounting correctness; real-user/domain validation remains necessary.

## Pre-build requirement

Run:

```bash
python3 scripts/validate_mock_data.py
python3 scripts/validate_reference_metrics.py
```

Do not begin feature coding if either fails.
