import wasmModule from "../../security/tuf-worker/pkg/ceoai_sigstore_tuf_worker.wasm";
import { createCloudflareSigstoreTufFirewall } from "./cloudflare-sigstore-tuf-firewall.mjs";

// Wrangler binds the compiled Rust artifact as a WebAssembly.Module.
// The entrypoint loads this adapter lazily so Node-only unit tests do not
// need a generated WASM artifact in their checkout.
export function createWorkerSigstoreTufFirewall(options = {}) {
  return createCloudflareSigstoreTufFirewall({
    ...options,
    wasmModule,
  });
}
