---
name: data-masking
description: Apply data masking (tokenization, generalization, suppression, differential privacy) for safe data sharing
version: 0.1.0
execution-mode: advisory
argument-hint: "<dataset> [--method tokenization|generalization|suppression|dp] [--fields pii-fields]"
category: data-science
status: candidate
---
# data-masking | Data Masking for Safe Sharing

## When to Use
- Preparing datasets for sharing with third parties or lower environments
- Protecting PII before analytics or ML training
- Satisfying privacy-by-design requirements in data pipelines
- Reducing risk in non-production copies of production data

## Execution

### 1. Parse Arguments
- `$ARGUMENTS`: `<dataset>` path or table identifier
- `--method`: tokenization, generalization, suppression, dp (default tokenization)
- `--fields`: comma-separated list of PII fields (auto-detect if omitted)

### 2. Discover PII Fields
- If `--fields` omitted, scan columns for PII patterns (email, phone, SSN, names)
- Classify each field: direct identifier, quasi-identifier, sensitive attribute
- Record detected PII in `_state/masking/<dataset>.pii.json`

### 3. Apply Masking Method
- **Tokenization**: replace values with reversible tokens; store mapping in vault
- **Generalization**: bucket values (e.g. age ranges, zip3) to reduce granularity
- **Suppression**: replace with NULL or redacted marker for high-risk fields
- **Differential privacy**: add calibrated noise; set epsilon budget (default 1.0)

### 4. Validate Output
- Confirm no direct identifiers remain in plaintext
- Check quasi-identifier combinations for re-identification risk (k-anonymity >= 5)
- Verify referential integrity preserved for tokenized keys

### 5. Emit Masked Dataset
- Write masked dataset to `_state/masking/<dataset>.masked.<ext>`
- Record method, fields masked, and parameters in a manifest file

## Output Format

```
data-masking | <dataset> (method=tokenization)

## Configuration
- Method: tokenization | Epsilon: n/a
- Fields targeted: email, phone, ssn (3 detected, 0 specified)

## Masking Report
| Field   | Classification   | Method        | Sample (in -> out)              |
|---------|------------------|---------------|---------------------------------|
| email   | direct-id        | tokenization  | a@b.com -> tok_8f3a...          |
| phone   | direct-id        | tokenization  | 555-1234 -> tok_2c71...         |
| ssn     | direct-id        | suppression   | 123-45-6789 -> REDACTED         |

## Validation
- Direct identifiers in plaintext: 0 PASS
- k-anonymity: 12 PASS (threshold 5)
- Referential integrity: preserved PASS

## Verdict
PASS | 3 fields masked, dataset safe for sharing
```

## Skill Chains
- After masking -> `[pii-discover]` to verify no residual PII
- After masking -> `[privacy-audit]` to document compliance
- Before masking -> `[data-govern]` to confirm policy requirements
