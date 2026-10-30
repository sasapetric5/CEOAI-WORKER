#!/usr/bin/env python3
"""Apply narrow, idempotent Emscripten compatibility patches.

The pinned Spider release has native-only fingerprint, thread-pool and
multi-thread test assumptions. Cloudflare Workers use a host-driven event
loop and do not provide a general-purpose OS thread pool.
"""
from pathlib import Path

registry = Path.home() / ".cargo" / "registry" / "src"

# 1. Provide a valid Client Hint platform for Emscripten.
fingerprint_files = list(registry.glob(
    "*/spider_fingerprint-2.39.0/src/spoof_headers.rs"
))
if len(fingerprint_files) != 1:
    raise SystemExit(
        f"expected exactly one spider_fingerprint 2.39.0 source, found {len(fingerprint_files)}"
    )
fingerprint = fingerprint_files[0]
fingerprint_text = fingerprint.read_text(encoding="utf-8")
fallback_marker = "sec-ch-ua-platform fallback for targets such as Emscripten."
if fallback_marker not in fingerprint_text:
    fallback = r'''#[cfg(not(any(
    target_os = "macos",
    target_os = "windows",
    target_os = "linux",
    target_os = "android",
    target_os = "ios"
)))]
/// sec-ch-ua-platform fallback for targets such as Emscripten.
fn get_sec_ch_ua_platform() -> &'static str {
    "\\"Unknown\\""
}

'''
    anchor = '#[cfg(target_arch = "x86")]'
    if fingerprint_text.count(anchor) != 1:
        raise SystemExit("unexpected fingerprint source layout; refusing to patch")
    fingerprint_text = fingerprint_text.replace(anchor, fallback + anchor, 1)
    fingerprint.write_text(fingerprint_text, encoding="utf-8")

# 2. Disable Spider's native background thread pool on wasm and dispatch
# connector futures on the Worker-managed Tokio runtime instead.
spider_roots = list(registry.glob("*/spider-2.53.9/src"))
if len(spider_roots) != 1:
    raise SystemExit(
        f"expected exactly one spider 2.53.9 source, found {len(spider_roots)}"
    )
spider_src = spider_roots[0]
connect = spider_src / "utils" / "connect.rs"
connect_text = connect.read_text(encoding="utf-8")

native_fn = "pub fn init_background_runtime() {"
native_guard = '#[cfg(not(target_arch = "wasm32"))]\n' + native_fn
wasm_fn = '''#[cfg(target_arch = "wasm32")]
pub fn init_background_runtime() {
    // Workers have no general-purpose OS thread pool. Connector futures
    // are scheduled on the host-driven runtime by send_to_background_runtime.
    BACKGROUND_THREAD_CONNECT_ENABLED.store(false, std::sync::atomic::Ordering::Relaxed);
}

'''
if native_guard not in connect_text:
    if connect_text.count(native_fn) != 1:
        raise SystemExit("unexpected Spider init_background_runtime layout")
    connect_text = connect_text.replace(native_fn, native_guard, 1)
if "Connector futures are scheduled on the host-driven runtime" not in connect_text:
    anchor = "/// Init a background thread for request connect handling.\n"
    if connect_text.count(anchor) != 1:
        raise SystemExit("unexpected Spider init documentation layout")
    connect_text = connect_text.replace(anchor, wasm_fn + anchor, 1)

sender = "fn send_to_background_runtime(future: impl Future<Output = ()> + Send + 'static) {"
sender_guard = '#[cfg(not(target_arch = "wasm32"))]\n' + sender
wasm_sender = '''#[cfg(target_arch = "wasm32")]
fn send_to_background_runtime(future: impl Future<Output = ()> + Send + 'static) {
    tokio::spawn(future);
}

'''
if sender_guard not in connect_text:
    if connect_text.count(sender) != 1:
        raise SystemExit("unexpected Spider background sender layout")
    connect_text = connect_text.replace(sender, sender_guard, 1)
if "tokio::spawn(future);" not in connect_text:
    anchor = "/// This tower service injects futures with a oneshot channel, and then sends them to the background runtime for processing.\n"
    if connect_text.count(anchor) != 1:
        raise SystemExit("unexpected Spider background layer documentation layout")
    connect_text = connect_text.replace(anchor, wasm_sender + anchor, 1)
connect.write_text(connect_text, encoding="utf-8")

# 3. Exclude one upstream native multi-thread concurrency test from wasm
# compilation. It tests OS-thread parallelism, unavailable in Workers.
page = spider_src / "page.rs"
page_text = page.read_text(encoding="utf-8")
test_attr = '#[tokio::test(flavor = "multi_thread", worker_threads = 4)]\nasync fn test_host_dns_cache_concurrent_no_deadlock()'
guarded_attr = '#[cfg(all(test, not(target_arch = "wasm32")))]\n' + test_attr
if guarded_attr not in page_text:
    if page_text.count(test_attr) != 1:
        raise SystemExit("unexpected Spider native concurrency test layout")
    page_text = page_text.replace(test_attr, guarded_attr, 1)
    page.write_text(page_text, encoding="utf-8")

print("Emscripten compatibility patches applied (idempotent)")
