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
