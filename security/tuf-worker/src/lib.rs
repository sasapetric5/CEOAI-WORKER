//! Worker-compatible Sigstore TUF verification core.
//!
//! The Worker host performs bounded network reads and Durable Object I/O.
//! This module verifies those bytes with the upstream Sigstore TUF state machine.
//! Untrusted skill content is never executed.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use p256::ecdsa::{signature::{hazmat::PrehashVerifier, Verifier}, Signature, VerifyingKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256, Sha384, Sha512};
use sigstore_crypto::{
    install_default_provider, try_default_provider, CryptoProvider, Error as CryptoError,
    HashContext, SigningScheme,
};
use sigstore_tuf::{
    cache::MetadataStore,
    client::Updater,
    transport::{FetchFuture, Repository, UpdaterConfig},
    Error as TufError,
};
use sigstore_types::HashAlgorithm;

const BOOTSTRAP_ROOT: &[u8] = include_bytes!("../bootstrap-root.json");
const MAX_INPUT_BYTES: usize = 16 * 1024 * 1024;
const MAX_CACHE_ENTRIES: usize = 128;
const MAX_REMOTE_ENTRIES: usize = 96;
const MAX_SINGLE_BLOB: usize = 8 * 1024 * 1024;

#[derive(Debug)]
enum HashState { Sha256(Sha256), Sha384(Sha384), Sha512(Sha512) }

#[derive(Debug)]
struct WorkerHashContext(HashState);

impl HashContext for WorkerHashContext {
    fn update(&mut self, data: &[u8]) {
        match &mut self.0 {
            HashState::Sha256(h) => h.update(data),
            HashState::Sha384(h) => h.update(data),
            HashState::Sha512(h) => h.update(data),
        }
    }
    fn finalize(self: Box<Self>) -> Vec<u8> {
        match self.0 {
            HashState::Sha256(h) => h.finalize().to_vec(),
            HashState::Sha384(h) => h.finalize().to_vec(),
            HashState::Sha512(h) => h.finalize().to_vec(),
        }
    }
}

/// Pure-Rust provider for the pinned Sigstore TUF root's ECDSA P-256/SHA-256 keys.
/// Any unimplemented algorithm fails closed.
#[derive(Debug)]
struct WorkerCryptoProvider;
static WORKER_CRYPTO: WorkerCryptoProvider = WorkerCryptoProvider;

fn install_worker_crypto() -> Result<(), String> {
    if try_default_provider().is_none() {
        install_default_provider(&WORKER_CRYPTO)
            .map_err(|_| "CRYPTO_PROVIDER_ALREADY_INSTALLED".to_string())?;
    }
    Ok(())
}

impl CryptoProvider for WorkerCryptoProvider {
    fn hash(&self, algorithm: HashAlgorithm) -> Result<Box<dyn HashContext>, CryptoError> {
        let state = match algorithm {
            HashAlgorithm::Sha2256 => HashState::Sha256(Sha256::new()),
            HashAlgorithm::Sha2384 => HashState::Sha384(Sha384::new()),
            HashAlgorithm::Sha2512 => HashState::Sha512(Sha512::new()),
            _ => return Err(CryptoError::UnsupportedAlgorithm(format!("unsupported hash {algorithm}"))),
        };
        Ok(Box::new(WorkerHashContext(state)))
    }

    fn verify_raw(&self, scheme: SigningScheme, public_key: &[u8], data: &[u8], signature: &[u8]) -> Result<(), CryptoError> {
        match scheme {
            SigningScheme::EcdsaP256Sha256 => {
                let key = VerifyingKey::from_sec1_bytes(public_key)
                    .map_err(|_| CryptoError::Verification("invalid P-256 public key".into()))?;
                let sig = Signature::from_der(signature)
                    .map_err(|_| CryptoError::Verification("invalid DER ECDSA signature".into()))?;
                key.verify(data, &sig)
                    .map_err(|_| CryptoError::Verification("ECDSA P-256 signature invalid".into()))
            }
            _ => Err(CryptoError::UnsupportedAlgorithm(format!("unsupported TUF signature scheme {}", scheme.name()))),
        }
    }

    fn verify_prehashed(&self, scheme: SigningScheme, public_key: &[u8], digest: &[u8], signature: &[u8]) -> Result<(), CryptoError> {
        match scheme {
            SigningScheme::EcdsaP256Sha256 => {
                let key = VerifyingKey::from_sec1_bytes(public_key)
                    .map_err(|_| CryptoError::Verification("invalid P-256 public key".into()))?;
                let sig = Signature::from_der(signature)
                    .map_err(|_| CryptoError::Verification("invalid DER ECDSA signature".into()))?;
                key.verify_prehash(digest, &sig)
                    .map_err(|_| CryptoError::Verification("ECDSA P-256 prehash signature invalid".into()))
            }
            _ => Err(CryptoError::UnsupportedAlgorithm(format!("unsupported prehashed scheme {}", scheme.name()))),
        }
    }
}

#[derive(Clone, Default)]
struct BridgeStore(Arc<Mutex<HashMap<String, Vec<u8>>>>);

impl BridgeStore {
    fn from_map(map: HashMap<String, Vec<u8>>) -> Self { Self(Arc::new(Mutex::new(map))) }
    fn snapshot(&self) -> HashMap<String, Vec<u8>> {
        self.0.lock().expect("metadata store lock poisoned").clone()
    }
}

impl MetadataStore for BridgeStore {
    fn load(&self, name: &str) -> Result<Option<Vec<u8>>, TufError> {
        Ok(self.0.lock().map_err(|_| TufError::Malformed("metadata store lock poisoned".into()))?.get(name).cloned())
    }
    fn store(&self, name: &str, bytes: &[u8]) -> Result<(), TufError> {
        if name.len() > 512 || name.starts_with('/') || name.split('/').any(|part| part == "..") {
            return Err(TufError::Malformed("unsafe metadata cache key".into()));
        }
        self.0.lock().map_err(|_| TufError::Malformed("metadata store lock poisoned".into()))?
            .insert(name.to_string(), bytes.to_vec());
        Ok(())
    }
}

struct MemoryRepository { metadata: HashMap<String, Vec<u8>>, targets: HashMap<String, Vec<u8>> }

impl Repository for MemoryRepository {
    fn fetch_metadata<'a>(&'a self, name: &'a str, max_length: u64) -> FetchFuture<'a> {
        let result = self.metadata.get(name).cloned().filter(|bytes| bytes.len() as u64 <= max_length);
        Box::pin(async move { Ok(result) })
    }
    fn fetch_target<'a>(&'a self, path: &'a str, max_length: u64) -> FetchFuture<'a> {
        let result = self.targets.get(path).cloned().filter(|bytes| bytes.len() as u64 <= max_length);
        Box::pin(async move { Ok(result) })
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct VerifyInput {
    #[serde(default)] cache: HashMap<String, String>,
    #[serde(default)] metadata: HashMap<String, String>,
    #[serde(default)] targets: HashMap<String, String>,
    #[serde(default)] now_unix_seconds: Option<i64>,
    #[serde(default = "default_target_path")] target_path: String,
}
fn default_target_path() -> String { "trusted_root.json".to_string() }

#[derive(Debug, Serialize, Deserialize)]
struct VerifyOutput {
    ok: bool,
    code: String,
    root_version: Option<u64>,
    timestamp_version: Option<u64>,
    snapshot_version: Option<u64>,
    targets_version: Option<u64>,
    verified_target_base64: Option<String>,
    cache: HashMap<String, String>,
}

fn error_output(code: &str) -> VerifyOutput {
    VerifyOutput { ok: false, code: code.to_string(), root_version: None, timestamp_version: None,
        snapshot_version: None, targets_version: None, verified_target_base64: None, cache: HashMap::new() }
}

fn decode_map(input: HashMap<String, String>, max_entries: usize) -> Result<HashMap<String, Vec<u8>>, &'static str> {
    if input.len() > max_entries { return Err("TOO_MANY_TUF_ENTRIES"); }
    let mut out = HashMap::with_capacity(input.len());
    let mut total = 0usize;
    for (name, encoded) in input {
        if name.is_empty() || name.len() > 512 || name.starts_with('/') ||
            name.split('/').any(|part| part == "..") { return Err("INVALID_TUF_ENTRY_NAME"); }
        let bytes = BASE64.decode(encoded.as_bytes()).map_err(|_| "INVALID_TUF_BASE64")?;
        if bytes.len() > MAX_SINGLE_BLOB { return Err("TUF_ENTRY_TOO_LARGE"); }
        total = total.checked_add(bytes.len()).ok_or("TUF_INPUT_TOO_LARGE")?;
        if total > MAX_INPUT_BYTES { return Err("TUF_INPUT_TOO_LARGE"); }
        out.insert(name, bytes);
    }
    Ok(out)
}

fn verify(input_bytes: &[u8]) -> VerifyOutput {
    if input_bytes.len() > MAX_INPUT_BYTES { return error_output("TUF_INPUT_TOO_LARGE"); }
    let input: VerifyInput = match serde_json::from_slice(input_bytes) {
        Ok(value) => value, Err(_) => return error_output("INVALID_TUF_INPUT"),
    };
    if input.target_path.is_empty() || input.target_path.len() > 256 ||
        input.target_path.starts_with('/') || input.target_path.split('/').any(|p| p == "..") {
        return error_output("INVALID_TUF_TARGET_PATH");
    }
    if install_worker_crypto().is_err() { return error_output("CRYPTO_PROVIDER_UNAVAILABLE"); }

    let cache = match decode_map(input.cache, MAX_CACHE_ENTRIES) { Ok(v) => v, Err(e) => return error_output(e) };
    let metadata = match decode_map(input.metadata, MAX_REMOTE_ENTRIES) { Ok(v) => v, Err(e) => return error_output(e) };
    let targets = match decode_map(input.targets, MAX_REMOTE_ENTRIES) { Ok(v) => v, Err(e) => return error_output(e) };
    let repo = MemoryRepository { metadata, targets };
    let store = BridgeStore::from_map(cache);

    let mut config = UpdaterConfig::default();
    config.root_max_length = 512 * 1024;
    config.timestamp_max_length = 32 * 1024;
    config.snapshot_max_length = 2 * 1024 * 1024;
    config.targets_max_length = 2 * 1024 * 1024;
    config.target_max_length = 2 * 1024 * 1024;
    config.max_root_rotations = 32;
    config.max_delegations = 32;

    let mut updater = match Updater::new(repo, BOOTSTRAP_ROOT) {
        Ok(value) => value.with_config(config).with_store(store.clone()),
        Err(_) => return error_output("TUF_BOOTSTRAP_ROOT_INVALID"),
    };
    let now = match input.now_unix_seconds {
        Some(seconds) => match jiff::Timestamp::from_second(seconds) {
            Ok(value) => value, Err(_) => return error_output("INVALID_TUF_CLOCK"),
        },
        None => jiff::Timestamp::now(),
    };
    if futures::executor::block_on(updater.refresh(now)).is_err() {
        return error_output("TUF_METADATA_VERIFICATION_FAILED");
    }
    let verified_target = match futures::executor::block_on(updater.get_target(&input.target_path, now)) {
        Ok(bytes) => bytes, Err(_) => return error_output("TUF_TARGET_VERIFICATION_FAILED"),
    };

    let trusted = updater.trusted();
    let mut persisted = HashMap::new();
    for (name, bytes) in store.snapshot() { persisted.insert(name, BASE64.encode(bytes)); }
    VerifyOutput {
        ok: true, code: "TUF_CHAIN_VERIFIED".to_string(),
        root_version: Some(trusted.root().version),
        timestamp_version: trusted.timestamp().map(|m| m.version),
        snapshot_version: trusted.snapshot().map(|m| m.version),
        targets_version: trusted.targets_role("targets").map(|m| m.version),
        verified_target_base64: Some(BASE64.encode(verified_target)),
        cache: persisted,
    }
}

fn encode_output(output: VerifyOutput) -> Vec<u8> {
    serde_json::to_vec(&output).unwrap_or_else(|_| br#"{"ok":false,"code":"TUF_OUTPUT_ENCODING_FAILED"}"#.to_vec())
}

/// Allocate a byte buffer in WASM linear memory for the JS host.
#[no_mangle]
pub extern "C" fn alloc(len: u32) -> u32 {
    let boxed = vec![0u8; len as usize].into_boxed_slice();
    let ptr = Box::leak(boxed).as_mut_ptr();
    ptr as u32
}

/// Release an output buffer returned by verify_tuf.
#[no_mangle]
pub unsafe extern "C" fn free_buffer(ptr: u32, len: u32) {
    if ptr != 0 && len != 0 {
        let slice = std::ptr::slice_from_raw_parts_mut(ptr as *mut u8, len as usize);
        drop(Box::from_raw(slice));
    }
}

/// Verify a bounded TUF metadata set. Returns (pointer << 32) | length.
#[no_mangle]
pub unsafe extern "C" fn verify_tuf(ptr: u32, len: u32) -> u64 {
    let input = std::slice::from_raw_parts(ptr as *const u8, len as usize);
    let output = encode_output(verify(input));
    let boxed = output.into_boxed_slice();
    let out_len = boxed.len() as u32;
    let out_ptr = Box::into_raw(boxed) as *mut u8 as u32;
    ((out_ptr as u64) << 32) | out_len as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture_input() -> Vec<u8> {
        let mut metadata = HashMap::new();
        metadata.insert("timestamp.json".into(), BASE64.encode(include_bytes!("../testdata/timestamp.json")));
        metadata.insert("166.snapshot.json".into(), BASE64.encode(include_bytes!("../testdata/snapshot.json")));
        metadata.insert("14.targets.json".into(), BASE64.encode(include_bytes!("../testdata/targets.json")));
        let mut targets = HashMap::new();
        targets.insert("6494e21ea73fa7ee769f85f57d5a3e6a08725eae1e38c755fc3517c9e6bc0b66.trusted_root.json".into(),
            BASE64.encode(include_bytes!("../testdata/trusted_root.json")));
        serde_json::to_vec(&serde_json::json!({"metadata":metadata,"targets":targets,"target_path":"trusted_root.json"})).unwrap()
    }

    #[test]
    fn verifies_pinned_sigstore_public_good_tuf_metadata_and_target() {
        let result: VerifyOutput = serde_json::from_slice(&encode_output(verify(&fixture_input()))).unwrap();
        assert!(result.ok, "{}", result.code);
        assert_eq!(result.code, "TUF_CHAIN_VERIFIED");
        assert_eq!(result.root_version, Some(16));
        assert_eq!(result.timestamp_version, Some(830));
        assert_eq!(result.snapshot_version, Some(166));
        assert_eq!(result.targets_version, Some(14));
        assert!(result.verified_target_base64.is_some());
        assert!(result.cache.contains_key("root.json"));
        assert!(result.cache.contains_key("timestamp.json"));
    }

    #[test]
    fn rejects_tampered_timestamp_signature() {
        let mut input: serde_json::Value = serde_json::from_slice(&fixture_input()).unwrap();
        let encoded = input["metadata"]["timestamp.json"].as_str().unwrap();
        let mut bytes = BASE64.decode(encoded).unwrap();
        let marker = b"faf4f883";
        let at = bytes.windows(marker.len()).position(|w| w == marker).unwrap();
        bytes[at] = b'0';
        input["metadata"]["timestamp.json"] = serde_json::Value::String(BASE64.encode(bytes));
        let result: VerifyOutput = serde_json::from_slice(&encode_output(verify(&serde_json::to_vec(&input).unwrap()))).unwrap();
        assert!(!result.ok);
        assert_eq!(result.code, "TUF_METADATA_VERIFICATION_FAILED");
    }

    #[test]
    fn rejects_tampered_trusted_root_target_hash() {
        let mut input: serde_json::Value = serde_json::from_slice(&fixture_input()).unwrap();
        let key = "6494e21ea73fa7ee769f85f57d5a3e6a08725eae1e38c755fc3517c9e6bc0b66.trusted_root.json";
        let mut bytes = BASE64.decode(input["targets"][key].as_str().unwrap()).unwrap();
        bytes[20] ^= 1;
        input["targets"][key] = serde_json::Value::String(BASE64.encode(bytes));
        let result: VerifyOutput = serde_json::from_slice(&encode_output(verify(&serde_json::to_vec(&input).unwrap()))).unwrap();
        assert!(!result.ok);
        assert_eq!(result.code, "TUF_TARGET_VERIFICATION_FAILED");
    }

    #[test]
    fn tampered_cache_is_not_trusted_when_fresh_metadata_is_available() {
        let mut input: serde_json::Value = serde_json::from_slice(&fixture_input()).unwrap();
        let mut cache = HashMap::new();
        let mut cached = include_bytes!("../testdata/timestamp.json").to_vec();
        cached[20] ^= 1;
        cache.insert("timestamp.json", BASE64.encode(cached));
        input["cache"] = serde_json::to_value(cache).unwrap();
        let result: VerifyOutput = serde_json::from_slice(&encode_output(verify(&serde_json::to_vec(&input).unwrap()))).unwrap();
        assert!(result.ok, "{}", result.code);
    }

    #[test]
    fn fails_closed_when_timestamp_is_missing() {
        let input = serde_json::json!({"metadata":{},"targets":{},"target_path":"trusted_root.json"});
        let result: VerifyOutput = serde_json::from_slice(&encode_output(verify(&serde_json::to_vec(&input).unwrap()))).unwrap();
        assert!(!result.ok);
        assert_eq!(result.code, "TUF_METADATA_VERIFICATION_FAILED");
    }
}
