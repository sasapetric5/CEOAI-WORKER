# CEOAI V5.0 — status Faze 1 i Faze 2

Stanje provereno na `main`, 8. novembra 2026. Aktivna Wrangler ulazna tačka je `ceoai-index-v5.0.mjs`. Ovo je status stvarnog repozitorijuma, ne alternativnog V5.1 overlay predloga iz Biblioteke.

## Faza 1 — arhitektura i integracija

| Oblast | Potvrđeno stanje |
|---|---|
| Worker ulaz | `wrangler.toml` direktno koristi `ceoai-index-v5.0.mjs`; nema potrebe za dodatnim `src/worker.mjs` adapterom u ovoj arhitekturi. |
| HMAC aplikacije | `/v1/agents/run`, Spider rute i HMAC varijanta OpenAI-kompatibilne rute koriste `verifyHmacSignature`; nonce zaštita je obavezna preko `SECURITY_DO`. |
| Izolacija aplikacija | Politike postoje za ContentCraft, AI Force i RankGeo; izbor agenata je ograničen po aplikaciji. |
| Spider | Worker ima `queue()` handler; producer/consumer koriste `SPIDER_QUEUE`, `SPIDER_LEDGER`, KV rezultate, ponovna slanja i DLQ. |
| Durable Objects | `SecurityOrchestratorDO`, `SpiderJobLedgerDO`, `WorkflowTaskDO` i `CapabilityAuthorityDO` su izvezeni iz Worker ulaza i deklarisani u `wrangler.toml` sa migracijama. |
| Agent runtime | Agent registry, skill registry, planner, supervisor, provider adapter i tool registry postoje u `src/agent/`; HMAC gateway koristi postojeći V5.0 provider pool. |
| Testovi | GitHub Actions na poslednjem potvrđenom commitu: 1.063 testa uspešno, 0 neuspešnih; Repository Shield i Wrangler dry-run uspešni. |

### Važna razlika u odnosu na mapu iz Biblioteke

Dokument `FAZA1-MAPA.md` razmatra i V5.1 overlay sa zasebnim `src/worker.mjs`, `src/index.mjs` i drugim provider routerom. Ti fajlovi nisu aktivna ulazna putanja ovog `main` repozitorijuma. Njihovo slepo kopiranje bi napravilo drugi adapter i paralelni sistem provajdera/kvota. Zadržavamo postojeći direktni Worker i ne spajamo alternativni overlay bez posebne revizije i migracionog plana.

## Faza 2 — bezbednosna osnova

| Kontrola | Potvrđeno stanje |
|---|---|
| Četiri nivoa | App, caller, agent i skill grant moraju svi dozvoliti isti poziv. |
| Opsezi resursa | Prazan opseg i globalni `*` su odbijeni; podresursi zahtevaju eksplicitan `site.example/*` opseg sa granicom. |
| Potpisano odobrenje | Ed25519 V2; Worker koristi samo javni ključ. Payload uključuje app, caller, agent, skill, tool, operation, resource, argumentsDigest, effectKey i expiry (najviše 10 minuta). |
| Veza sa pozivom | Supervisor izračunava stabilni effect key; verifikator proverava da se potpisani effect key i digest argumenata poklapaju sa konkretnim pozivom. |
| Atomski autoritet | `CapabilityAuthorityDO` u jednoj transakciji troši approval ID, broji kvotu i pamti receipt za stabilni effect key. Konflikt identiteta ili argumenata se odbija. |
| Idempotentno izvršavanje | `WorkflowTaskDO` koristi lease, fencing token, CAS checkpoint i effect ledger; izvršilac vraća postojeći rezultat ili `EFFECT_OUTCOME_UNKNOWN` bez slepog ponavljanja. |
| Integracioni test | `test/signed-approval-supervisor-integration.test.mjs` povezuje Ed25519 proveru, četiri grant sloja, stvarni DO kod kroz test harness i idempotentni tool executor; proverava da se testni spoljni efekat izvrši samo jednom. |

## Šta nije uključeno (namerno)

1. App gateway i dalje pravi `tools: []`, `enabled: false` i prazan `allowedToolIds`. Nema aktivnih spoljnih akcija.
2. Nisu postavljeni stvarni capability grantovi niti javni ključ vlasnika u Cloudflare okruženju. Bez njih odobreni pozivi moraju da budu odbijeni.
3. `callerId` je trenutno servisni identitet izveden iz HMAC aplikacije (`app_<id>`), a ne identitet krajnjeg korisnika.
4. Za proizvoljan modelom planiran spoljni poziv potreban je korak „plan → prikaži tačan poziv → vlasnik potpiše → izvrši“. Ne treba aktivirati publish/send alat dok ovaj challenge/confirmation tok ne postoji.
5. Wrangler dry-run potvrđuje razrešenu konfiguraciju, ali ne dokazuje da su stvarni Cloudflare bindingi, migracije i Browser Run dozvole provereni uživo. Produkcioni deploy i stvarni spoljašnji pozivi nisu rađeni.

## Sledeći bezbedan korak

Završiti pregled svakog konkretnog read-only alata i njegovog input schema/SSRF/idempotency ugovora, zatim dodati ga iza četiri grant sloja. Tek posle toga napraviti vlasnički preview/approval tok za svaki external-effect alat. Ne aktivirati alat samo zato što je CI zelen.
