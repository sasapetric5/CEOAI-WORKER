#!/usr/bin/env python3
"""Apply a narrow Emscripten fallback to spider_fingerprint 2.39.0.

Upstream currently defines get_sec_ch_ua_platform only for desktop/mobile OSes.
Emscripten has no matching target_os cfg, so the dependency fails to compile.
This adds the standards-compatible "Unknown" platform hint for unsupported OSes.
Remove this workaround once upstream ships the equivalent fallback.
"""
from pathlib import Path
import sys

matches = list((Path.home() / ".cargo" / "registry" / "src").glob(
    "*/spider_fingerprint-2.39.0/src/spoof_headers.rs"
))
if len(matches) != 1:
    raise SystemExit(
        f"expected exactly one spider_fingerprint 2.39.0 source, found {len(matches)}"
    )

source = matches[0]
text = source.read_text(encoding="utf-8")
fallback = '''#[cfg(not(any(
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
if "sec-ch-ua-platform fallback for targets such as Emscripten." in text:
    print("spider_fingerprint Emscripten fallback already applied")
    raise SystemExit(0)

anchor = '#[cfg(target_arch = "x86")]'
if text.count(anchor) != 1:
    raise SystemExit("unexpected spider_fingerprint source layout; refusing to patch")
text = text.replace(anchor, fallback + anchor, 1)
source.write_text(text, encoding="utf-8")
print(f"patched {source}")

# Spider's default HTTP connector creates an OS thread and a Tokio
# multi-thread runtime. Cloudflare Workers are host-event-loop driven;
# schedule the connector future on the already-active Tokio runtime instead.
spider_roots = list((Path.home() / ".cargo" / "registry" / "src").glob(
    "*/spider-2.53.9/src"
))
if len(spider_roots) != 1:
    raise SystemExit(
        f"expected exactly one spider 2.53.9 source, found {len(spider_roots)}"
    )

connect = spider_roots[0] / "utils" / "connect.rs"
connect_text = connect.read_text(encoding="utf-8")

native_init = "/// Init a background thread for request connect handling.\n"
wasm_init = """#[cfg(target_arch = "wasm32")]
pub fn init_background_runtime() {
    // No OS threads in Workers. The request's host-driven Tokio runtime
    // will execute connector futures directly.
    BACKGROUND_THREAD_CONNECT_ENABLED.store(false, std::sync::atomic::Ordering::Relaxed);
}

"""
if "No OS threads in Workers." not in connect_text:
    if connect_text.count(native_init) != 1:
        raise SystemExit("unexpected Spider connect.rs init layout; refusing to patch")
    connect_text = connect_text.replace(native_init, wasm_init + native_init, 1)
    connect_text = connect_text.replace(
        "pub fn init_background_runtime() {",
        "#[cfg(not(target_arch = \"wasm32\"))]\npub fn init_background_runtime() {",
        1,
    )

send_anchor = "fn send_to_background_runtime(future: impl Future<Output = ()> + Send + 'static) {"
if "tokio::spawn(future);" not in connect_text:
    if connect_text.count(send_anchor) != 1:
        raise SystemExit("unexpected Spider connect.rs sender layout; refusing to patch")
    connect_text = connect_text.replace(
        send_anchor,
        "#[cfg(not(target_arch = \"wasm32\"))]\n" + send_anchor,
        1,
    )
    layer_anchor = "/// This tower service injects futures with a oneshot channel, and then sends them to the background runtime for processing.\n"
    wasm_sender = """#[cfg(target_arch = "wasm32")]
fn send_to_background_runtime(future: impl Future<Output = ()> + Send + 'static) {
    // The Worker handler is already executing inside the host-driven runtime.
    tokio::spawn(future);
}

"""
    if connect_text.count(layer_anchor) != 1:
        raise SystemExit("unexpected Spider connect.rs layer layout; refusing to patch")
    connect_text = connect_text.replace(layer_anchor, wasm_sender + layer_anchor, 1)

connect.write_text(connect_text, encoding="utf-8")

# Upstream has a multi-thread Tokio unit test outside a target guard. It is
# useful on native hosts but cannot be compiled into a Worker binary.
page = spider_roots[0] / "page.rs"
page_text = page.read_text(encoding="utf-8")
test_attr = '#[tokio::test(flavor = "multi_thread", worker_threads = 4)]\nasync fn test_host_dns_cache_concurrent_no_deadlock()'
guarded_attr = '#[cfg(all(test, not(target_arch = "wasm32")))]\n' + test_attr
if guarded_attr not in page_text:
    if page_text.count(test_attr) != 1:
        raise SystemExit("unexpected Spider page.rs test layout; refusing to patch")
    page_text = page_text.replace(test_attr, guarded_attr, 1)
    page.write_text(page_text, encoding="utf-8")

print("patched Spider 2.53.9 for host-driven Emscripten runtime")
