CEOAI.dev Worker V5.0
=====================

Purpose
-------
Capability-aware multi-provider orchestration on top of V4.9 security model.
Only free / explicitly confirmed-free providers are activated. Search enrichment
uses Jina Reader (no key, rate-limited) when a URL is present in a research intent.

Package files
-------------
- ceoai-index-v5.0.js / .mjs: Cloudflare Worker source (byte-identical pair)
- test-ceoai-v5.0.mjs: expanded smoke/security + orchestration tests
- README-CEOAI-V5.0.txt: this document
- wrangler.toml: keep_vars + rate limit binding

Changes from V4.9
-----------------
1. Expanded intent taxonomy: fast | coding | reasoning | research | complex.
2. Capability matrix ranks providers so the best-fit free model is tried first.
3. New AI adapters (OpenAI-compatible): Mistral, xAI, NVIDIA, Hugging Face.
4. Free-only gates:
   - OpenRouter: model must end with :free (unchanged)
   - Mistral: allowlisted free models only (open-mistral-nemo default)
   - xAI / NVIDIA / HF: require XAI_FREE_CONFIRMED / NVIDIA_FREE_CONFIRMED / HF_FREE_CONFIRMED=true
5. Optional free URL reader: Jina Reader (https://r.jina.ai/...) when research intent + URL.
6. RATE_LIMITER fail-closed retained (REQUIRE_ATOMIC_RATE_LIMITER default true).
7. Additional tests for ranking, free gates, Jina enrichment, rate-limit regression.

Provider pool (A)
-----------------
| Provider        | Activation                                      | Default model                          |
|-----------------|--------------------------------------------------|----------------------------------------|
| Gemini          | GEMINI_KEY_1/2/3                                 | gemini-1.5-flash                       |
| GLM Flash (ZAI) | ZAI_GLM_FLASH_KEY_1/2                            | glm-4.5-flash                          |
| OpenRouter      | OPENROUTER_KEY (+ optional COMPLEX :free model)  | meta-llama/llama-3-8b-instruct:free    |
| DeepSeek        | DEEPSEEK_KEY                                     | deepseek-chat                          |
| Mistral         | MISTRAL_KEY (+ allowlisted model)                | open-mistral-nemo                      |
| xAI / Grok      | XAI_KEY + XAI_FREE_CONFIRMED=true                | grok-beta                              |
| NVIDIA Build    | NVIDIA_KEY + NVIDIA_FREE_CONFIRMED=true          | meta/llama-3.1-8b-instruct             |
| Hugging Face    | HF_TOKEN + HF_FREE_CONFIRMED=true                | Qwen/Qwen2.5-7B-Instruct               |
| Workers AI      | WORKERS_AI_ENABLED=true + AI binding             | @cf/meta/llama-3-8b-instruct           |

Not activated by default (billing risk / unverified free): FreeLLMAPI.
NVIDIA / xAI / HF remain off until the operator confirms free quota.

Search & Data pool (B)
----------------------
| Source              | Status in V5.0                                      |
|---------------------|-----------------------------------------------------|
| Jina Reader         | Implemented (free, no key, rate-limited)            |
| Tavily / Exa / etc. | Not wired — require free-credit confirmation later  |
| Google/Bing consoles| Not wired — site-owner APIs, not general search     |
| DuckDuckGo / SearXNG| Not wired — no stable free official API assumed     |

Orchestration
-------------
1. chooseIntent(prompt) → fast | coding | reasoning | research | complex
2. If research + URL → optional Jina fetch injected as system context
3. Build free-only candidate pool from configured keys + free gates
4. Score each candidate by PROVIDER_CAPABILITIES[provider][intent]
5. Sort highest score first; try sequentially with cooldown skip
6. On success persist memory; on total failure return 503 without mutating history

Production security configuration
---------------------------------
- Keep native RATE_LIMITER binding. Fail-closed by default.
- ALLOWED_ORIGINS=https://ceoai.dev ; ALLOW_LOCAL_ORIGINS unset/false
- DEBUG_PROVIDER_ERRORS=false
- AI_ENABLED=true and EXTERNAL_AI_ENABLED=true only when intentionally enabling external providers
- Set *_FREE_CONFIRMED only after verifying the account cannot be billed
- Configure only provider keys/models you have independently verified as free

Deployment checklist
--------------------
1. npm run verify
2. Confirm RATE_LIMITER + KV_MEMORY bindings in Cloudflare
3. Set secrets in Dashboard (do not commit keys)
4. Deploy with wrangler (keep_vars=true preserves dashboard vars)
5. Smoke-test /api/chat from https://ceoai.dev origin

Quota-aware automatic failover (V5.0 update)
--------------------------------------------
When a free daily/monthly quota is exhausted (HTTP 429/403 with quota signals):
1. The provider is marked in KV cooldown for QUOTA_COOLDOWN_TTL (6 hours).
2. The next ranked free AI provider is tried in the same request.
3. If all AI providers are exhausted, the client receives a clear Serbian message
   and Retry-After reflecting the longer quota window.

Search/data failover order (research intent):
1. Jina Reader (URL, no key)
2. Tavily (TAVILY_KEY + TAVILY_FREE_CONFIRMED=true)
3. Google Custom Search (GOOGLE_CSE_KEY + GOOGLE_CSE_CX + GOOGLE_CSE_FREE_CONFIRMED=true)
4. Exa (EXA_KEY + EXA_FREE_CONFIRMED=true)

Bing Webmaster Tools is intentionally not used as a general web search fallback:
it only returns data for sites you own/verify, not arbitrary SERP results.

Short burst rate limits still use COOLDOWN_TTL (1 hour). Quota exhaustion uses
the longer window so the system does not hammer a provider known to be dry.

Search failover order (final)
-----------------------------
1. Jina Reader — URL, no key
2. Firecrawl — FIRECRAWL_KEY + FIRECRAWL_FREE_CONFIRMED=true (scrape or search)
3. Tavily — TAVILY_KEY + TAVILY_FREE_CONFIRMED=true
4. Google Custom Search — GOOGLE_CSE_KEY + GOOGLE_CSE_CX + GOOGLE_CSE_FREE_CONFIRMED=true
5. Exa — EXA_KEY + EXA_FREE_CONFIRMED=true
6. DuckDuckGo Instant Answer — no key, last resort (DUCKDUCKGO_ENABLED=false to disable)
