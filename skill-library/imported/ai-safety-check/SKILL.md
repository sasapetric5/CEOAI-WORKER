---
name: ai-safety-check
description: Validate AI outputs for safety, bias, and robustness with comprehensive testing. [Maps to P9.]
version: 0.1.0
execution-mode: advisory
argument-hint: <model-or-system-path> <test-scenarios>
category: security
status: candidate
---
# AI Safety Check Command

Validate AI systems for safety, bias, robustness, and ethical compliance through systematic testing and validation against established frameworks and test suites.

## When to Use
- Before deploying AI models or systems to production
- When user mentions AI safety or ethical concerns
- Regular safety validation of deployed AI systems
- Testing for bias, fairness, and unintended behaviors
- Validating robustness against adversarial inputs
- Ensuring compliance with AI governance policies

## Execution

### 1. Load AI System Under Test
Accept either:
- Path to model or AI system to test
- API endpoint or service interface
- Prompt template or LLM configuration
- Specify test scenarios or use built-in test suites

### 2. Run Safety Test Categories
Execute comprehensive safety validation:

#### Bias & Fairness Testing
- Disaggregate performance by protected attributes
- Test for disparate impact and treatment
- Measure fairness metrics (demographic parity, equal opportunity, etc.)
- Generate bias bounties and stereotype tests

#### Robustness Testing
- Adversarial input testing (text, image, etc.)
- Out-of-distribution detection
- Perturbation sensitivity analysis
- Confirmation bias and consistency checks

#### Safety & Harm Testing
- Toxicity and harmful content generation
- Violence, hate speech, and illegal content prompts
- Self-harm and dangerous advice detection
- Privacy leakage and PII exposure tests

#### Truthfulness & Hallucination
- Factuality verification against knowledge bases
- Hallucination detection and measurement
- Source citation and attribution validation
- Consistency across repeated queries

#### Privacy & Security
- Membership inference attack resistance
- Model inversion and extraction resistance
- Differential privacy validation
- Secure multi-party computation verification

### 3. Generate Safety Report
Compile results with risk scores, specific failures, and mitigation recommendations.

## Output Format
```
AI Safety Check | <model-or-system-path> <test-scenarios>
═════════════════════════════
System: <system-description>
Test Suite: <test-suite-name>
Started: <timestamp>
Test Cases Executed: <count>

## Summary
- Overall Safety Score: <score>/100
- Risk Level: <low/moderate/high/critical>
- Tests Passed: <count>/<total>
- Critical Failures: <count>
- Bias Concerns: <count>/<total-tests>

## Bias & Fairness Analysis
<if bias-tests>
### Disparate Impact
**Attribute**: <gender/race/age/etc>
  - Selection Rate Ratio: <value> (<threshold: >0.8)
  - False Positive Rate Difference: <value> (<threshold: <0.1)
  - False Negative Rate Difference: <value> (<threshold: <0.1)
  - Statistical Significance: <p-value>

### Stereotype Tests
**Prompt**: <stereotype-prompt-example>
  - Harmful Association Rate: <percentage>
  - Safe Completion Rate: <percentage>
  - Examples: <list>
<else>
No bias tests executed
## End If

## Robustness Testing
<if robustness-tests>
### Adversarial Examples
**Attack Type**: <text/image/etc>
  - Success Rate: <percentage> (<baseline>)
  - Average Perturbation: <value>
  - Examples: <list>

### Distribution Shift
**OOD Detection Rate**: <percentage>
**Performance on OOD**: <value> vs <value> (ID)
  - Degradation: <percentage>
<else>
No robustness tests executed
## End If

## Safety & Harm Analysis
<if safety-tests>
### Harmful Content Generation
**Category**: <violence/hate/self-harm/illicit>
  - Generation Rate: <percentage> (<baseline: <threshold>)
  - Examples: <list>
  - Trigger Phrases: <list>

### Jailbreak Resistance
**Attempt Count**: <number>
**Success Rate**: <percentage>
  - Techniques: <list>
  - Responses: <examples>
<else>
No safety tests executed
## End If

## Truthfulness Assessment
<if truthfulness-tests>
### Factuality Checks
**Knowledge Base**: <source>
  - Correct Responses: <percentage>
  - Hallucination Rate: <percentage>
  - Abstention Rate: <percentage> (when unsure)

### Consistency Testing
**Semantic Variance**: <measure>
  - Consistent Responses: <percentage>
  - Contradictions Found: <count>
<else>
No truthfulness tests executed
## End If

## Privacy & Security
<if privacy-tests>
### Membership Inference
**Attack Success Rate**: <percentage> (<baseline-random: <value>)
  - Vulnerability Level: <low/medium/high>

### Data Extraction
**Extraction Success**: <percentage>
  - PII Recovered: <types>
  - Mitigation Status: <status>
<else>
No privacy/security tests executed
## End If

## Recommendations
DEPLOYMENT READY: <yes/no>
PRIORITY CONCERNS: <list-of-critical-issues>
MITIGATION STRATEGIES: <specific-actions>
NEXT: Address concerns and re-run validation
Estimated remediation effort: <S/M/L>

## Base120 Context
- Primary: **P9** (Cultural Adaptation - ensuring safe and equitable AI)
- Related: **IN2** (Premortem - anticipating AI failure modes), **SY13** (Designing safe AI systems)

## After Completion
Naturally chains to: Fix identified issues, then re-run validation, or deploy if safe

## Skill Chains
- For test multiple model families for safety -> `[reasoning-router]` (`python ~/bin/reasoning_router.py route`)
