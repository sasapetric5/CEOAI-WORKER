// Research-capable composition root. Callers still grant tool capabilities per task.
import { createAPIConnectorRegistry } from "../integrations/api-connector-registry.mjs";
import { createToolRegistry } from "./tool-registry.mjs";
import { createAgentLoop } from "./agent-loop.mjs";
import { createBuiltinAgentSystem } from "./agent-system.mjs";
import { createHackerNewsSearchTool } from "./research-tool.mjs";

export function createBuiltinResearchAgentSystem({
  fetchImpl = globalThis.fetch,
  maxAgents = 3,
  maxToolCalls = 1,
  maxSteps = 2,
} = {}) {
  const connectorRegistry = createAPIConnectorRegistry({ fetchImpl });
  const toolRegistry = createToolRegistry({
    tools: [createHackerNewsSearchTool({ connectorRegistry })],
    enabled: true,
    limits: { timeoutMs: 9000, maxOutputBytes: 7000 },
  });
  const system = createBuiltinAgentSystem({
    toolRegistry,
    maxAgents,
    maxToolCalls,
    agentLoopFactory: ({ toolRegistry, skillRegistry }) =>
      createAgentLoop({ toolRegistry, skillRegistry, maxSteps, maxToolCalls }),
  });
  return Object.freeze({ ...system, connectorRegistry, toolRegistry });
}
