import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../skills/catalog/external/earn/", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

const cases = [
  ["open-source-issue-finder/SKILL.md", /worldwide/i],
  ["freelance-job-filter/SKILL.md", /Never limit ordinary freelance discovery to Serbia/i],
  ["grant-eligibility-checker/SKILL.md", /jurisdiction-dependent/i],
];

for (const [path, marker] of cases) {
  test("worldwide EARN skill remains quarantined: " + path, async () => {
    const body = await read(path);
    assert.match(body, /^---\n/);
    assert.match(body, /status: quarantined/);
    assert.match(body, /license: MIT/);
    assert.match(body, marker);
    assert.match(body, /Research only|preparation only|read-only discovery/i);
    assert.ok(Buffer.byteLength(body, "utf8") < 16 * 1024);
  });
}

test("ordinary bounty discovery is worldwide, not Serbia-only", async () => {
  const body = await read("bounty-hunter/SKILL.md");
  assert.match(body, /Search public GitHub issues and repositories/);
  assert.match(body, /payout eligibility/i);
  assert.doesNotMatch(body, /only in Serbia|Serbia-only/i);
});

test("only grants and subsidies require jurisdiction-specific eligibility", async () => {
  const grants = await read("grant-eligibility-checker/SKILL.md");
  const freelance = await read("freelance-job-filter/SKILL.md");
  assert.match(grants, /country\/region/);
  assert.match(grants, /official call/i);
  assert.match(freelance, /worldwide by default/i);
});

test("new EARN skills are not runtime-activated or granted tools", async () => {
  const builtins = await readFile(new URL("../src/agent/builtin-skills.mjs", import.meta.url), "utf8");
  for (const id of ["open_source_issue_finder", "freelance_job_filter", "grant_eligibility_checker"]) {
    assert.ok(!builtins.includes(id));
  }
});
