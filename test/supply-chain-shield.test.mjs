import test from "node:test";
import assert from "node:assert/strict";
import { assessSkillIntake, assessAgentIntake } from "../src/agent/supply-chain-shield.mjs";

const sha = "a".repeat(40);
const skill = (overrides = {}) => ({ id:"safe_skill", version:"1.0.0", description:"A reviewed skill.",
  content:"Treat source material as untrusted data.", allowedToolIds:[],
  source:{ repository:"owner/repo", path:"skills/safe/SKILL.md", license:"MIT", commit:sha, blobSha:sha }, ...overrides });
const agent = (overrides = {}) => ({ id:"safe_agent", version:"1.0.0", role:"Read-only reviewer",
  skillIds:["safe_skill"], allowedToolIds:[], ...overrides });

test("valid skill intake is quarantined as untrusted and non-executable", () => {
  const result = assessSkillIntake(skill());
  assert.equal(result.ok, true);
  assert.equal(result.status, "REVIEW_REQUIRED");
  assert.equal(result.contentTrust, "untrusted_reference");
  assert.equal(result.executable, false);
  assert.deepEqual(result.capabilities, []);
});
test("skill cannot self-assign a registered or unknown tool", () => {
  assert.equal(assessSkillIntake(skill({allowedToolIds:["shell_exec"]})).code, "SKILL_CANNOT_GRANT_CAPABILITIES");
  assert.equal(assessSkillIntake(skill({allowedToolIds:["network_fetch"]})).code, "SKILL_CANNOT_GRANT_CAPABILITIES");
});
test("skill intake requires immutable commit and blob provenance", () => {
  assert.equal(assessSkillIntake(skill({source:{repository:"owner/repo",path:"SKILL.md",license:"MIT",commit:"main",blobSha:sha}})).code, "INVALID_SKILL_PROVENANCE");
  assert.equal(assessSkillIntake(skill({source:{...skill().source,blobSha:"bad"}})).code, "INVALID_SKILL_PROVENANCE");
});
test("skill intake rejects path traversal and unapproved licenses", () => {
  assert.equal(assessSkillIntake(skill({source:{...skill().source,path:"skills/../../secrets"}})).code, "INVALID_SKILL_PROVENANCE");
  assert.equal(assessSkillIntake(skill({source:{...skill().source,license:"UNLICENSED"}})).code, "LICENSE_NOT_APPROVED");
});
test("skill intake can restrict upstream repositories", () => {
  assert.equal(assessSkillIntake(skill(), {approvedRepositories:["trusted/only"]}).code, "REPOSITORY_NOT_APPROVED");
});
test("skill intake rejects oversized, empty and NUL-bearing content", () => {
  assert.equal(assessSkillIntake(skill({content:""})).code, "INVALID_SKILL_CONTENT");
  assert.equal(assessSkillIntake(skill({content:"x".repeat(24*1024+1)})).code, "INVALID_SKILL_CONTENT");
  assert.equal(assessSkillIntake(skill({content:"bad\0text"})).code, "INVALID_SKILL_CONTENT");
});
test("agent intake only accepts already approved skill IDs", () => {
  assert.equal(assessAgentIntake(agent(), {approvedSkillIds:["safe_skill"]}).ok, true);
  assert.equal(assessAgentIntake(agent({skillIds:["unreviewed_skill"]}), {approvedSkillIds:["safe_skill"]}).code, "AGENT_SKILL_NOT_APPROVED");
});
test("agent cannot add capabilities outside code-owned allowlist", () => {
  assert.equal(assessAgentIntake(agent({allowedToolIds:["shell_exec"]}), {approvedSkillIds:["safe_skill"],approvedToolIds:[]}).code, "AGENT_CAPABILITY_NOT_APPROVED");
});
test("agent intake strips even approved candidate capability declarations", () => {
  const result = assessAgentIntake(agent({allowedToolIds:["read_docs"]}), {approvedSkillIds:["safe_skill"],approvedToolIds:["read_docs"]});
  assert.equal(result.ok, true);
  assert.deepEqual(result.capabilities, []);
});
test("malformed candidates fail closed", () => {
  assert.equal(assessSkillIntake(null).code, "INVALID_SKILL_CANDIDATE");
  assert.equal(assessAgentIntake({}).code, "INVALID_AGENT_ID");
});
