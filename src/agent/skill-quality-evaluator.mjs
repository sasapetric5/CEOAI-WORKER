// CEOAI Functional Skill Evaluator.
// Candidate instructions are data, never executable code. The injected runner must be a
// trusted, isolated adapter; this evaluator never grants tools, network, secrets or writes.
const ID = /^[a-z][a-z0-9_]{0,47}$/;
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const CASE_ID = /^[a-z][a-z0-9_-]{0,47}$/;
const MAX_CASES = 20;
const MAX_VALUE_BYTES = 16 * 1024;
const MAX_DEPTH = 12;
const plain = value => value !== null && typeof value === "object" && !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

function canonical(value, depth = 0, seen = new Set()) {
  if (depth > MAX_DEPTH) throw new TypeError("EVALUATION_VALUE_TOO_DEEP");
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new TypeError("INVALID_EVALUATION_VALUE");
    seen.add(value);
    const result = "[" + value.map(item => canonical(item, depth + 1, seen)).join(",") + "]";
    seen.delete(value);
    return result;
  }
  if (!plain(value) || seen.has(value)) throw new TypeError("INVALID_EVALUATION_VALUE");
  seen.add(value);
  const keys = Object.keys(value).sort();
  const result = "{" + keys.map(key => JSON.stringify(key) + ":" + canonical(value[key], depth + 1, seen)).join(",") + "}";
  seen.delete(value);
  return result;
}

async function sha256(value) {
  if (!globalThis.crypto?.subtle) throw new Error("SKILL_HASH_UNAVAILABLE");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function boundedJson(value) {
  const serialized = canonical(value);
  if (new TextEncoder().encode(serialized).byteLength > MAX_VALUE_BYTES) throw new TypeError("EVALUATION_VALUE_TOO_LARGE");
  return serialized;
}

function validCase(item) {
  if (!plain(item) || Object.keys(item).some(key => !["id", "input", "expectedOutput"].includes(key)) ||
      typeof item.id !== "string" || !CASE_ID.test(item.id) ||
      !Object.hasOwn(item, "input") || !Object.hasOwn(item, "expectedOutput")) return false;
  try { boundedJson(item.input); boundedJson(item.expectedOutput); return true; } catch { return false; }
}

export function createSkillQualityEvaluator({
  skillRegistry,
  skillLifecycle,
  executeCase,
  now = () => Date.now(),
  maxCases = MAX_CASES
} = {}) {
  if (!skillRegistry || typeof skillRegistry.get !== "function" || typeof skillRegistry.load !== "function") {
    throw new TypeError("SKILL_REGISTRY_REQUIRED");
  }
  if (!skillLifecycle || typeof skillLifecycle.recordQualityResult !== "function") {
    throw new TypeError("SKILL_LIFECYCLE_REQUIRED");
  }
  if (typeof executeCase !== "function") throw new TypeError("TRUSTED_ISOLATED_SKILL_RUNNER_REQUIRED");
  if (typeof now !== "function") throw new TypeError("INVALID_CLOCK");
  if (!Number.isSafeInteger(maxCases) || maxCases < 1 || maxCases > MAX_CASES) throw new TypeError("INVALID_EVALUATION_LIMIT");

  async function evaluate({ skillId, runId, taskCategory = "general", cases, expectedContentSha256 } = {}) {
    if (typeof skillId !== "string" || !ID.test(skillId) || typeof runId !== "string" || !RUN_ID.test(runId) ||
        typeof taskCategory !== "string" || !/^[a-z][a-z0-9_-]{0,47}$/.test(taskCategory) ||
        (expectedContentSha256 !== undefined && (typeof expectedContentSha256 !== "string" || !/^[a-f0-9]{64}$/.test(expectedContentSha256))) ||
        !Array.isArray(cases) || cases.length < 1 || cases.length > maxCases ||
        cases.some(item => !validCase(item)) || new Set(cases.map(item => item.id)).size !== cases.length) {
      return { ok: false, code: "INVALID_SKILL_EVALUATION_REQUEST" };
    }

    const metadata = skillRegistry.get(skillId);
    if (!metadata) return { ok: false, code: "SKILL_NOT_FOUND" };
    let skill;
    try { skill = await skillRegistry.load(skillId); }
    catch { return { ok: false, code: "SKILL_CONTENT_UNAVAILABLE" }; }
    if (!skill || typeof skill.content !== "string" || !skill.content.trim()) {
      return { ok: false, code: "SKILL_CONTENT_UNAVAILABLE" };
    }
    if (expectedContentSha256 !== undefined) {
      let actualHash;
      try { actualHash = await sha256(skill.content); }
      catch { return { ok: false, code: "SKILL_HASH_UNAVAILABLE" }; }
      if (actualHash !== expectedContentSha256) return { ok: false, code: "EVALUATED_CONTENT_HASH_MISMATCH" };
    }

    const results = [];
    for (const item of cases) {
      let actual;
      let passed = false;
      let errorCode = null;
      try {
        const response = await executeCase(Object.freeze({
          skill: Object.freeze({
            id: skill.id,
            version: skill.version,
            description: skill.description,
            content: skill.content,
            source: skill.source ?? null,
            trust: "untrusted_reference"
          }),
          testCase: Object.freeze({ id: item.id, input: item.input, expectedOutput: item.expectedOutput }),
          policy: Object.freeze({
            isolated: true,
            candidateCodeExecution: false,
            networkAccess: false,
            filesystemWriteAccess: false,
            secretAccess: false,
            toolIds: Object.freeze([]),
            maxOutputBytes: MAX_VALUE_BYTES
          })
        }));
        if (!plain(response) || Object.keys(response).some(key => key !== "output") || !Object.hasOwn(response, "output")) {
          errorCode = "INVALID_RUNNER_RESPONSE";
        } else {
          actual = response.output;
          passed = boundedJson(actual) === boundedJson(item.expectedOutput);
          if (!passed) errorCode = "OUTPUT_MISMATCH";
        }
      } catch (error) {
        errorCode = typeof error?.code === "string" && /^[A-Z0-9_]{1,64}$/.test(error.code)
          ? error.code : "CASE_EXECUTION_FAILED";
      }
      results.push({ caseId: item.id, passed, ...(errorCode ? { code: errorCode } : {}) });
    }

    const passed = results.filter(result => result.passed).length;
    const total = results.length;
    const score = passed / total;
    let lifecycle;
    try {
      lifecycle = await skillLifecycle.recordQualityResult(skillId, {
        passed,
        total,
        score,
        taskCategory,
        evidenceId: runId
      });
    } catch {
      return { ok: false, code: "SKILL_QUALITY_EVIDENCE_PERSISTENCE_FAILED", passed, total, score, results };
    }
    if (!lifecycle?.ok) {
      return { ok: false, code: lifecycle?.code || "SKILL_QUALITY_EVIDENCE_PERSISTENCE_FAILED", passed, total, score, results };
    }
    return {
      ok: true,
      skillId,
      runId,
      evaluatedAt: now(),
      passed,
      total,
      score,
      qualityPassed: passed === total && score >= 0.8,
      lifecycleStatus: lifecycle.record.status,
      results
    };
  }

  return Object.freeze({ evaluate });
}
