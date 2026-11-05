// CEOAI Advanced Orchestration v1.0
// Deterministic DAG compiler and bounded wave executor.
// This module does not call providers or grant capabilities; callers inject both policy and execution.
const ID = /^[a-z][a-z0-9_-]{0,47}$/;
const TASK_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const CAPABILITIES = new Set(["seo", "earn", "coding", "research", "general"]);
const MAX_NODES = 64;
const MAX_INPUT_BYTES = 8192;
const MAX_RESULT_BYTES = 16384;
const plain = value => value !== null && typeof value === "object" && !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const fail = code => ({ ok: false, code });
function safeJson(value, maxBytes) {
  try {
    const json = JSON.stringify(value);
    if (typeof json !== "string" || new TextEncoder().encode(json).byteLength > maxBytes) return null;
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) && !plain(parsed) ? null : parsed;
  } catch { return null; }
}
function validateNode(node) {
  const allowed = ["id", "agentId", "skillIds", "capabilities", "dependsOn", "input", "requiresApproval"];
  if (!plain(node) || Object.keys(node).some(key => !allowed.includes(key))) return false;
  if (typeof node.id !== "string" || !ID.test(node.id)) return false;
  if (typeof node.agentId !== "string" || !ID.test(node.agentId)) return false;
  if (!Array.isArray(node.skillIds) || node.skillIds.length > 16 ||
      !node.skillIds.every(id => typeof id === "string" && ID.test(id)) ||
      new Set(node.skillIds).size !== node.skillIds.length) return false;
  if (!Array.isArray(node.capabilities) || node.capabilities.length < 1 || node.capabilities.length > 5 ||
      !node.capabilities.every(cap => CAPABILITIES.has(cap)) ||
      new Set(node.capabilities).size !== node.capabilities.length) return false;
  if (!Array.isArray(node.dependsOn) || node.dependsOn.length > MAX_NODES ||
      !node.dependsOn.every(id => typeof id === "string" && ID.test(id)) ||
      new Set(node.dependsOn).size !== node.dependsOn.length || node.dependsOn.includes(node.id)) return false;
  if (node.input !== undefined && safeJson(node.input, MAX_INPUT_BYTES) === null) return false;
  return node.requiresApproval === undefined || typeof node.requiresApproval === "boolean";
}

export function compileWorkflowGraph({ id, nodes } = {}) {
  if (typeof id !== "string" || !TASK_ID.test(id)) return fail("INVALID_WORKFLOW_ID");
  if (!Array.isArray(nodes) || nodes.length < 1 || nodes.length > MAX_NODES || !nodes.every(validateNode)) {
    return fail("INVALID_WORKFLOW_NODES");
  }
  const byId = new Map();
  for (const node of nodes) {
    if (byId.has(node.id)) return fail("DUPLICATE_NODE_ID");
    byId.set(node.id, node);
  }
  for (const node of nodes) {
    if (node.dependsOn.some(dep => !byId.has(dep))) return fail("UNKNOWN_DEPENDENCY");
  }
  const indegree = new Map(nodes.map(node => [node.id, node.dependsOn.length]));
  const dependents = new Map(nodes.map(node => [node.id, []]));
  for (const node of nodes) for (const dep of node.dependsOn) dependents.get(dep).push(node.id);
  const remaining = new Set(nodes.map(node => node.id));
  const waves = [];
  while (remaining.size) {
    const ready = nodes.filter(node => remaining.has(node.id) && indegree.get(node.id) === 0).map(node => node.id);
    if (!ready.length) return fail("WORKFLOW_CYCLE");
    waves.push(ready);
    for (const nodeId of ready) {
      remaining.delete(nodeId);
      for (const child of dependents.get(nodeId)) indegree.set(child, indegree.get(child) - 1);
    }
  }
  const normalizedNodes = nodes.map(node => ({
    id: node.id, agentId: node.agentId, skillIds: [...node.skillIds],
    capabilities: [...node.capabilities], dependsOn: [...node.dependsOn],
    input: node.input === undefined ? null : safeJson(node.input, MAX_INPUT_BYTES),
    requiresApproval: node.requiresApproval === true,
  }));
  return Object.freeze({
    ok: true, graph: Object.freeze({
      version: 1, id, nodes: Object.freeze(normalizedNodes.map(Object.freeze)),
      waves: Object.freeze(waves.map(wave => Object.freeze(wave))),
    }),
  });
}

export function createAdvancedOrchestrator({ executeNode, checkpoint = null, audit = null, maxParallel = 4 } = {}) {
  if (typeof executeNode !== "function") throw new TypeError("NODE_EXECUTOR_REQUIRED");
  if (checkpoint !== null && typeof checkpoint !== "function") throw new TypeError("INVALID_CHECKPOINT");
  if (audit !== null && typeof audit.record !== "function") throw new TypeError("INVALID_AUDIT");
  if (!Number.isSafeInteger(maxParallel) || maxParallel < 1 || maxParallel > 8) throw new TypeError("INVALID_PARALLEL_LIMIT");
  const emit = event => { try { audit?.record(Object.freeze(event)); } catch { /* audit is non-blocking */ } };

  async function run(graph, { grantedCapabilities = [], priorResults = {} } = {}) {
    if (!plain(graph) || graph.version !== 1 || typeof graph.id !== "string" || !TASK_ID.test(graph.id) ||
        !Array.isArray(graph.nodes) || !Array.isArray(graph.waves)) return fail("INVALID_COMPILED_GRAPH");
    if (!Array.isArray(grantedCapabilities) || !grantedCapabilities.every(cap => CAPABILITIES.has(cap))) return fail("INVALID_CAPABILITY_GRANTS");
    const grants = new Set(grantedCapabilities);
    const results = safeJson(priorResults, MAX_RESULT_BYTES);
    if (!plain(results)) return fail("INVALID_PRIOR_RESULTS");
    const byId = new Map(graph.nodes.map(node => [node.id, node]));
    if (byId.size !== graph.nodes.length || graph.nodes.some(node => !validateNode(node))) return fail("INVALID_COMPILED_GRAPH");
    for (const id of Object.keys(results)) if (!byId.has(id)) return fail("UNKNOWN_PRIOR_RESULT");
    const completed = new Set(Object.keys(results));
    for (const wave of graph.waves) {
      if (!Array.isArray(wave)) return fail("INVALID_COMPILED_GRAPH");
      const pending = wave.filter(id => !completed.has(id));
      for (const id of pending) {
        const node = byId.get(id);
        if (!node || node.dependsOn.some(dep => !completed.has(dep))) return fail("DEPENDENCY_NOT_SATISFIED");
        if (node.capabilities.some(cap => !grants.has(cap))) {
          emit({ type: "capability_denied", workflowId: graph.id, nodeId: id });
          return { ok: false, status: "blocked", code: "CAPABILITY_NOT_GRANTED", nodeId: id };
        }
      }
      const approvalNode = pending.find(id => byId.get(id).requiresApproval);
      if (approvalNode) return {
        ok: true, status: "paused_approval", workflowId: graph.id,
        pendingNodeId: approvalNode, completedNodeIds: [...completed], results,
      };
      for (let offset = 0; offset < pending.length; offset += maxParallel) {
        const batch = pending.slice(offset, offset + maxParallel);
        const settled = await Promise.allSettled(batch.map(async id => {
          const node = byId.get(id);
          const value = await executeNode({
            workflowId: graph.id, nodeId: id, agentId: node.agentId,
            skillIds: [...node.skillIds], capabilities: [...node.capabilities],
            input: node.input, priorResults: safeJson(results, MAX_RESULT_BYTES),
            idempotencyKey: graph.id + ":" + id,
          });
          const safe = safeJson(value, MAX_RESULT_BYTES);
          if (safe === null) throw new Error("NODE_RESULT_INVALID_OR_TOO_LARGE");
          return { id, value: safe };
        }));
        for (let index = 0; index < settled.length; index++) {
          const item = settled[index];
          if (item.status === "rejected") {
            const failedId = batch[index];
            emit({ type: "node_failed", workflowId: graph.id, nodeId: failedId });
            return { ok: false, status: "failed", code: "NODE_EXECUTION_FAILED", nodeId: failedId, completedNodeIds: [...completed], results };
          }
          results[item.value.id] = item.value.value;
          completed.add(item.value.id);
          emit({ type: "node_completed", workflowId: graph.id, nodeId: item.value.id });
          if (checkpoint) {
            try { await checkpoint({ workflowId: graph.id, completedNodeIds: [...completed], results: safeJson(results, MAX_RESULT_BYTES) }); }
            catch { return fail("CHECKPOINT_WRITE_FAILED"); }
          }
        }
      }
    }
    return { ok: true, status: "completed", workflowId: graph.id, completedNodeIds: [...completed], results };
  }
  return Object.freeze({ run });
}
