//! Experimental Cloudflare Worker compatibility probe for the Spider stack.

mod guarded_transport;

use serde::Serialize;
use std::time::Duration;
use worker::*;

fn main() {}

#[derive(Serialize)]
struct Health {
    status: &'static str,
    runtime: &'static str,
    crawler: &'static str,
    tokio_timer: bool,
    tokio_timeout: bool,
}

#[event(fetch)]
async fn fetch(req: Request, _env: Env, _ctx: Context) -> Result<Response> {
    let path = req.path();

    if path == "/health" {
        return Response::from_json(&Health {
            status: "ok",
            runtime: "cloudflare-workers-emscripten-experimental",
            crawler: "spider-2.53.9-dependency-compile-probe",
            tokio_timer: true,
            tokio_timeout: true,
        });
    }

    if path == "/transport-capabilities" {\n        let capabilities = guarded_transport::Capabilities::current_runtime();\n        let mut response = Response::from_json(&serde_json::json!({\n            "status": if capabilities.permits_crawl() { "ready" } else { "blocked" },\n            "runtime": "cloudflare-workers-fetch",\n            "capabilities": {\n                "dns_resolution": capabilities.dns_resolution,\n                "dns_pinning": capabilities.dns_pinning,\n                "peer_ip_verification": capabilities.peer_ip_verification,\n                "redirect_validation": capabilities.redirect_validation,\n                "bounded_streaming": capabilities.bounded_streaming\n            },\n            "crawl_enabled": capabilities.permits_crawl(),\n            "reason": "Workers Fetch does not expose the resolved DNS answer set and connected peer IP to this adapter; fail closed."\n        }))?;\n        response.headers_mut().set("cache-control", "no-store")?;\n        return Ok(response);\n    }\n\n    if path == "/crawl" {\n        let reason = guarded_transport::WorkerGuardedTransport::ensure_supported()\n            .err().unwrap_or("crawl-route-not-enabled");\n        let mut response = Response::from_json(&serde_json::json!({\n            "protocol": "ceoai-spider/1",\n            "status": "rejected",\n            "error": reason,\n            "network_requests": 0,\n            "external_actions": false,\n            "paid_services": false\n        }))?;\n        response.headers_mut().set("cache-control", "no-store")?;\n        return Ok(response.with_status(503));\n    }\n\n    if path == "/runtime-check" {
        let start = js_sys::Date::now();
        let timer = tokio::time::timeout(
            Duration::from_millis(250),
            tokio::time::sleep(Duration::from_millis(10)),
        ).await;
        let elapsed_ms = js_sys::Date::now() - start;
        let mut response = Response::from_json(&serde_json::json!({
            "status": if timer.is_ok() { "ok" } else { "timeout" },
            "tokio_timer": timer.is_ok(),
            "elapsed_ms": elapsed_ms,
            "note": "Runtime compatibility probe only; no crawling is exposed."
        }))?;
        response.headers_mut().set("cache-control", "no-store")?;
        return Ok(response);
    }

    if path == "/" {
        return Response::ok("CEOAI Spider experimental Worker. Try /health or /runtime-check.\n");
    }

    Response::error("Not Found", 404)
}
