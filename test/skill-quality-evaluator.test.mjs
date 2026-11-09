import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createSkillQualityEvaluator } from "../src/agent/skill-quality-evaluator.mjs";

function fixture({ outputs = {}, errors = {} } = {}) {
  const recorded = [];
  const evaluator = createSkillQualityEvaluator({
    skillRegistry: {
      get: id => id === "sample_skill" ? { id, version: "1.0.0" } : null,
      load: async id => id === "sample_skill"
        ? { id, version: "1.0.0", description: "Test fixture", content: "Untrusted instructions only." }
        : null
    },
    skillLifecycle: {
      recordQualityResult: async (id, result) => {
        recorded.push({ id, ...result });
        return { ok: true, record: { status: result.passed === result.total ? "VERIFIED" : "DEGRADED" } };
      }
    },
    executeCase: async ({ testCase, policy }) => {
      assert.equal(policy.networkAccess, false);
      assert.equal(policy.secretAccess, false);
      assert.deepEqual(policy.toolIds, []);
      if (errors[testCase.id]) throw Object.assign(new Error("runner failure"), { code: errors[testCase.id] });
      return { output: Object.hasOwn(outputs, testCase.id) ? outputs[testCase.id] : testCase.expectedOutput };
    },
    now: () => 1234
  });
  return { evaluator, recorded };
}

test("functional evaluator checks actual outputs and persists measured quality", async () => {
  const { evaluator, recorded } = fixture({ outputs: { wrong: { answer: 0 } } });
  const result = await evaluator.evaluate({
    skillId: "sample_skill", runId: "run-0000001", taskCategory: "seo",
    cases: [
      { id: "correct", input: { query: "x" }, expectedOutput: { answer: 1 } },
      { id: "wrong", input: { query: "y" }, expectedOutput: { answer: 1 } }
    ]
  });
  assert.equal(result.ok, true);
  assert.equal(result.passed, 1);
  assert.equal(result.total, 2);
  assert.equal(result.score, 0.5);
  assert.equal(result.qualityPassed, false);
  assert.equal(result.lifecycleStatus, "DEGRADED");
  assert.equal(result.evaluatedAt, 1234);
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].evidenceId, "run-0000001");
});

test("runner failures count as failed cases rather than successful completion", async () => {
  const { evaluator, recorded } = fixture({ errors: { crash: "EXPECTED_RUNNER_FAILURE" } });
  const result = await evaluator.evaluate({
    skillId: "sample_skill", runId: "run-0000002",
    cases: [{ id: "crash", input: {}, expectedOutput: "done" }]
  });
  assert.equal(result.ok, true);
  assert.equal(result.passed, 0);
  assert.equal(result.results[0].code, "EXPECTED_RUNNER_FAILURE");
  assert.equal(recorded[0].passed, 0);
});

test("malformed and duplicate cases are rejected before execution", async () => {
  const { evaluator, recorded } = fixture();
  assert.equal((await evaluator.evaluate({
    skillId: "sample_skill", runId: "run-0000003",
    cases: [{ id: "same", input: {}, expectedOutput: true }, { id: "same", input: {}, expectedOutput: true }]
  })).code, "INVALID_SKILL_EVALUATION_REQUEST");
  assert.equal((await evaluator.evaluate({
    skillId: "missing_skill", runId: "run-0000004",
    cases: [{ id: "valid", input: {}, expectedOutput: true }]
  })).code, "SKILL_NOT_FOUND");
  assert.equal(recorded.length, 0);
});

test("untrusted runner cannot return extra fields or an oversized output", async () => {
  const registry = {
    get: () => ({ id: "sample_skill" }),
    load: async () => ({ id: "sample_skill", version: "1.0.0", content: "guide" })
  };
  const lifecycle = { recordQualityResult: async () => ({ ok: true, record: { status: "DEGRADED" } }) };
  const evaluator = createSkillQualityEvaluator({
    skillRegistry: registry, skillLifecycle: lifecycle,
    executeCase: async () => ({ output: "expected", status: "success" })
  });
  const result = await evaluator.evaluate({
    skillId: "sample_skill", runId: "run-0000005",
    cases: [{ id: "valid", input: {}, expectedOutput: "expected" }]
  });
  assert.equal(result.passed, 0);
  assert.equal(result.results[0].code, "INVALID_RUNNER_RESPONSE");
});

test("quality evidence persistence failure prevents a successful evaluation claim", async () => {
  const { evaluator } = fixture();
  const failing = createSkillQualityEvaluator({
    skillRegistry: { get: () => ({ id: "sample_skill" }), load: async () => ({ id: "sample_skill", version: "1.0.0", content: "guide" }) },
    skillLifecycle: { recordQualityResult: async () => { throw new Error("storage down"); } },
    executeCase: async ({ testCase }) => ({ output: testCase.expectedOutput })
  });
  const result = await failing.evaluate({
    skillId: "sample_skill", runId: "run-0000006",
    cases: [{ id: "valid", input: {}, expectedOutput: "ok" }]
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "SKILL_QUALITY_EVIDENCE_PERSISTENCE_FAILED");
  assert.equal(result.passed, 1);
  assert.ok(evaluator);
});


test("quality evaluator refuses content different from the firewall-scanned hash", async () => {
  const { evaluator } = fixture();
  const result = await evaluator.evaluate({
    skillId: "sample_skill", runId: "run-0000007",
    expectedContentSha256: "f".repeat(64),
    cases: [{ id: "valid", input: {}, expectedOutput: "ok" }]
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "EVALUATED_CONTENT_HASH_MISMATCH");
});


test("staged Skill can be evaluated before it enters the runtime Registry", async () => {
  const { evaluator, recorded } = fixture();
  const content = "Candidate content scanned by the Security Firewall.";
  const hash = createHash("sha256").update(content).digest("hex");
  const result = await evaluator.evaluate({
    skillId: "staged_skill", runId: "run-0000008",
    expectedContentSha256: hash,
    candidateSkill: {
      id: "staged_skill", version: "1.0.0",
      description: "Staged candidate for isolated quality checks",
      content
    },
    cases: [{ id: "valid", input: {}, expectedOutput: "ok" }]
  });
  assert.equal(result.ok, true);
  assert.equal(result.qualityPassed, true);
  assert.equal(recorded[0].id, "staged_skill");
});
