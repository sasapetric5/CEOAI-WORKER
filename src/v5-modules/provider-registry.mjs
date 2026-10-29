// CEOAI V5.0 — universal capability registry for explicitly integrated providers.
// Adding a provider requires a reviewed code entry and adapter; keys/config alone never enable it.
// Unknown providers and models are denied by default.
const SAFE_ID = /^[a-z0-9][a-z0-9_-]{0,79}$/;
const MODEL_RULES = Object.freeze({
  "openrouter": model => /^[A-Za-z0-9._/-]{1,180}:free$/.test(model),
  "mistral": model => ["open-mistral-nemo", "mistral-small-latest", "ministral-8b-latest"].includes(model),
  "workers-ai": model => model === "@cf/meta/llama-3-8b-instruct",
  "glm-flash": model => model === "glm-4.5-flash",
  "gemini": model => model === "gemini-1.5-flash",
  "deepseek": model => model === "deepseek-flash",
  // Token Harbor model IDs are exact-allowlisted; only explicit free routes are permitted.
  "tokenharbor": model => model === "deepseek-v4.1-flash:free",
  "xai": model => model === "grok-beta",
  "nvidia": model => model === "meta/llama-3.1-8b-instruct",
  "huggingface": model => model === "Qwen/Qwen2.5-7B-Instruct",
  "dahl": model => model === "MiniMaxAI/MiniMax-M2.7",
});
const BUILT_INS = [
  { id:"workers-ai", adapter:"workers-ai", confirmationEnv:"WORKERS_AI_FREE_CONFIRMED", keyRequired:false, modelRule:"workers-ai", capabilities:["fast"], quotaMode:"local-counter" },
  { id:"glm-flash", adapter:"openai-compatible", confirmationEnv:"ZAI_GLM_FLASH_FREE_CONFIRMED", keyRequired:true, modelRule:"glm-flash", capabilities:["fast","coding"], quotaMode:"local-counter" },
  { id:"gemini", adapter:"gemini", confirmationEnv:"GEMINI_FREE_CONFIRMED", keyRequired:true, modelRule:"gemini", capabilities:["fast","reasoning"], quotaMode:"local-counter" },
  { id:"openrouter", adapter:"openai-compatible", confirmationEnv:"OPENROUTER_FREE_CONFIRMED", keyRequired:true, modelRule:"openrouter", capabilities:["fast","coding","reasoning","complex"], quotaMode:"local-counter" },
  { id:"deepseek", adapter:"openai-compatible", confirmationEnv:"DEEPSEEK_FREE_CONFIRMED", keyRequired:true, modelRule:"deepseek", capabilities:["coding","reasoning"], quotaMode:"local-counter" },
  { id:"tokenharbor", adapter:"openai-compatible", confirmationEnv:"TOKENHARBOR_FREE_CONFIRMED", keyRequired:true, modelRule:"tokenharbor", capabilities:["fast","coding","reasoning","complex"], quotaMode:"local-counter" },
  { id:"mistral", adapter:"openai-compatible", confirmationEnv:"MISTRAL_FREE_CONFIRMED", keyRequired:true, modelRule:"mistral", capabilities:["coding","fast"], quotaMode:"local-counter" },
  { id:"xai", adapter:"openai-compatible", confirmationEnv:"XAI_FREE_CONFIRMED", keyRequired:true, modelRule:"xai", capabilities:["reasoning","complex"], quotaMode:"local-counter" },
  { id:"nvidia", adapter:"openai-compatible", confirmationEnv:"NVIDIA_FREE_CONFIRMED", keyRequired:true, modelRule:"nvidia", capabilities:["coding","reasoning"], quotaMode:"local-counter" },
  { id:"huggingface", adapter:"openai-compatible", confirmationEnv:"HF_FREE_CONFIRMED", keyRequired:true, modelRule:"huggingface", capabilities:["fast","coding"], quotaMode:"local-counter" },
  { id:"dahl", adapter:"openai-compatible", confirmationEnv:"DAHL_FREE_CONFIRMED", keyRequired:true, modelRule:"dahl", capabilities:["coding","reasoning","complex"], quotaMode:"provider-reported" },
];

function normalizeDefinition(definition) {
  if (!definition || typeof definition !== "object") return null;
  const id = definition.id;
  if (typeof id !== "string" || !SAFE_ID.test(id)) return null;
  if (typeof definition.adapter !== "string" || !/^[a-z][a-z0-9-]{1,39}$/.test(definition.adapter)) return null;
  if (typeof definition.confirmationEnv !== "string" || !/^[A-Z][A-Z0-9_]{2,79}$/.test(definition.confirmationEnv)) return null;
  if (typeof definition.keyRequired !== "boolean") return null;
  if (typeof definition.modelRule !== "string" || typeof MODEL_RULES[definition.modelRule] !== "function") return null;
  if (!Array.isArray(definition.capabilities) || definition.capabilities.some(x => !["fast","coding","reasoning","research","complex"].includes(x))) return null;
  if (!["local-counter","provider-reported","none"].includes(definition.quotaMode)) return null;
  return Object.freeze({ ...definition, capabilities:Object.freeze([...new Set(definition.capabilities)]) });
}

export function createProviderRegistry(definitions = BUILT_INS) {
  const entries = new Map();
  for (const definition of definitions) {
    const normalized = normalizeDefinition(definition);
    if (!normalized || entries.has(normalized.id)) throw new TypeError("Invalid or duplicate provider registry entry");
    entries.set(normalized.id, normalized);
  }
  return Object.freeze({
    get(id) { return entries.get(id) || null; },
    has(id) { return entries.has(id); },
    list() { return [...entries.values()].map(({ id, adapter, confirmationEnv, keyRequired, capabilities, quotaMode }) =>
      Object.freeze({ id, adapter, confirmationEnv, keyRequired, capabilities:[...capabilities], quotaMode })); },
    isModelAllowed(id, model) {
      const entry = entries.get(id);
      if (!entry || typeof model !== "string" || !model.trim()) return false;
      const rule = MODEL_RULES[entry.modelRule];
      return Boolean(rule && rule(model.trim()));
    },
  });
}

export const PROVIDER_REGISTRY = createProviderRegistry();
export function getProviderCapability(providerId) {
  const entry = PROVIDER_REGISTRY.get(providerId);
  if (!entry) return null;
  return Object.freeze({
    id: entry.id, adapter: entry.adapter, confirmationEnv: entry.confirmationEnv,
    keyRequired: entry.keyRequired, capabilities:[...entry.capabilities], quotaMode:entry.quotaMode,
  });
}
export function isRegisteredModelAllowed(providerId, model) {
  return PROVIDER_REGISTRY.isModelAllowed(providerId, model);
}
