#!/usr/bin/env python3
"""Patch worker-build 0.8.7 to select the snippets directory containing files.

Cargo 1.100 may leave several same-named wasm-bindgen snippet directories in
the target tree. Checking only the directory name can select an empty/stale
candidate, so esbuild then cannot resolve inline0.js. Match every JS import
against an actual file before choosing the candidate directory.
"""
from pathlib import Path
import sys

if len(sys.argv) != 2:
    raise SystemExit("usage: patch-worker-build-snippets.py <worker-build-src/build/mod.rs>")

source = Path(sys.argv[1])
if not source.is_file():
    raise SystemExit(f"worker-build source not found: {source}")

text = source.read_text(encoding="utf-8")
old_parse = '''    let wanted: Vec<&str> = js
        .split("./snippets/")
        .skip(1)
        .filter_map(|rest| rest.split('/').next())
        .collect();'''
new_parse = r'''    let wanted: Vec<&str> = js
        .split("./snippets/")
        .skip(1)
        .filter_map(|rest| {
            let end = rest.find(|c: char| {
                c == '"' || c == '\'' || c == ')' || c == ';' || c.is_whitespace()
            })?;
            Some(&rest[..end])
        })
        .collect();'''
old_match = '.find(|dir| wanted.iter().all(|w| dir.join(w).is_dir()))'
new_match = '.find(|dir| wanted.iter().all(|w| dir.join(w).is_file()))'

if new_parse in text and new_match in text:
    print("worker-build snippets lookup patch already applied")
    raise SystemExit(0)
if text.count(old_parse) != 1 or text.count(old_match) != 1:
    raise SystemExit("unexpected worker-build 0.8.7 snippets_dir layout; refusing to patch")

text = text.replace(old_parse, new_parse, 1).replace(old_match, new_match, 1)
source.write_text(text, encoding="utf-8")
print(f"patched worker-build snippets lookup: {source}")
