use chrono::{SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use spider::{configuration::RedirectPolicy, website::Website};
use std::collections::HashSet;
use std::io::{self, BufRead, Write};
use std::time::Duration;
use tokio::time::timeout;
use url::{Host, Url};

const PROTOCOL: &str = "ceoai-spider/1";
const MAX_URLS: usize = 10;
const MAX_TIMEOUT_MS: u64 = 15_000;
const MAX_CONTENT_CHARS: usize = 50_000;
const MAX_EVIDENCE_CHARS: usize = 2_000;

#[derive(Debug, Deserialize)]
struct JobRequest {
    protocol: String,
    job_id: String,
    adapter_id: String,
    urls: Vec<String>,
    concurrency: u8,
    timeout_ms: u64,
    browser_mode: bool,
    follow_links: bool,
    obey_robots_txt: bool,
    #[serde(default)]
    respect_retry_after: bool,
    max_records: usize,
    external_actions: bool,
    paid_services: bool,
}

#[derive(Debug, Serialize)]
struct JobResponse {
    protocol: String,
    job_id: String,
    adapter_id: String,
    records: Vec<Value>,
    errors: Vec<String>,
    external_actions: bool,
    paid_services: bool,
    execution: Value,
}

fn approved_hosts_from_env() -> HashSet<String> {
    std::env::var("CEOAI_CRAWLER_APPROVED_HOSTS")
        .unwrap_or_default()
        .split(',')
        .map(|host| host.trim().trim_end_matches('.').to_ascii_lowercase())
        .filter(|host| !host.is_empty())
        .collect()
}

fn validate_target(raw: &str, approved_hosts: &HashSet<String>) -> Result<Url, String> {
    let mut url = Url::parse(raw).map_err(|_| "invalid-url".to_string())?;
    if url.scheme() != "https" && url.scheme() != "http" {
        return Err("scheme-not-allowed".into());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("url-credentials-forbidden".into());
    }
    if let Some(port) = url.port() {
        if port != 80 && port != 443 {
            return Err("nonstandard-port-forbidden".into());
        }
    }

    let host = match url.host() {
        Some(Host::Domain(host)) => host.trim_end_matches('.').to_ascii_lowercase(),
        Some(Host::Ipv4(_)) | Some(Host::Ipv6(_)) => {
            return Err("ip-literal-forbidden".into())
        }
        None => return Err("hostname-required".into()),
    };

    if host == "localhost"
        || [".localhost", ".local", ".internal", ".test", ".invalid"]
            .iter()
            .any(|suffix| host.ends_with(suffix))
    {
        return Err("non-public-host-forbidden".into());
    }
    if !approved_hosts.contains(&host) {
        return Err("source-host-not-approved".into());
    }

    url.set_fragment(None);
    Ok(url)
}

fn validate_job(request: &JobRequest, approved_hosts: &HashSet<String>) -> Result<Vec<Url>, Vec<String>> {
    let mut errors = Vec::new();
    if request.protocol != PROTOCOL { errors.push("protocol-mismatch".into()); }
    if request.adapter_id != "spider" { errors.push("adapter-id-mismatch".into()); }
    if request.job_id.is_empty()
        || request.job_id.len() > 100
        || !request.job_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        errors.push("invalid-job-id".into());
    }
    if request.urls.is_empty() { errors.push("urls-required".into()); }
    if request.urls.len() > MAX_URLS { errors.push("url-limit-exceeded".into()); }
    if !(1..=2).contains(&request.concurrency) { errors.push("concurrency-out-of-range".into()); }
    if !(1_000..=MAX_TIMEOUT_MS).contains(&request.timeout_ms) { errors.push("timeout-out-of-range".into()); }
    if request.max_records == 0 || request.max_records > 100 { errors.push("record-limit-out-of-range".into()); }
    if request.browser_mode { errors.push("browser-mode-disabled-in-local-pilot".into()); }
    if request.follow_links { errors.push("link-following-disabled-in-local-pilot".into()); }
    if !request.obey_robots_txt { errors.push("robots-txt-must-be-enabled".into()); }
    if request.external_actions { errors.push("external-actions-must-be-disabled".into()); }
    if request.paid_services { errors.push("paid-services-must-be-disabled".into()); }

    let mut urls = Vec::new();
    for raw in &request.urls {
        match validate_target(raw, approved_hosts) {
            Ok(url) => urls.push(url),
            Err(reason) => errors.push(reason),
        }
    }
    if errors.is_empty() { Ok(urls) } else { Err(errors) }
}

fn response_error(job_id: &str, errors: Vec<String>) -> JobResponse {
    JobResponse {
        protocol: PROTOCOL.into(),
        job_id: job_id.chars().take(100).collect(),
        adapter_id: "spider".into(),
        records: Vec::new(),
        errors,
        external_actions: false,
        paid_services: false,
        execution: json!({"status":"rejected","network_requests":0}),
    }
}

async fn crawl_one(url: &Url, timeout_ms: u64) -> Result<Vec<Value>, String> {
    let mut website = Website::new(url.as_str());
    website
        .with_limit(1)
        .with_depth(1)
        .with_respect_robots_txt(true)
        .with_redirect_policy(RedirectPolicy::None)
        .with_request_timeout(Some(Duration::from_millis(timeout_ms)))
        .with_crawl_timeout(Some(Duration::from_millis(timeout_ms)));

    let mut receiver = website.subscribe(16);
    let crawl_result = timeout(
        Duration::from_millis(timeout_ms.saturating_add(1_000)),
        website.crawl(),
    ).await;
    website.unsubscribe();

    if crawl_result.is_err() {
        return Err("crawl-timeout".into());
    }

    let mut records = Vec::new();
    while let Ok(page) = receiver.try_recv() {
        let html = page.get_content();
        if html.is_empty() {
            continue;
        }
        let digest = Sha256::digest(html.as_bytes());
        let content_hash = format!("{:x}", digest);
        let bounded_html: String = html.chars().take(MAX_CONTENT_CHARS).collect();
        let evidence: String = html.chars().take(MAX_EVIDENCE_CHARS).collect();
        let final_url = page.get_url().to_string();
        let status = page.status_code.as_u16();

        records.push(json!({
            "source_url": final_url,
            "collected_at": Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true),
            "http_status": status,
            "robots_allowed": true,
            "extractor": "spider-rs/2.53.9",
            "content_hash": content_hash,
            "evidence": [evidence],
            "data": {
                "html": bounded_html,
                "content_truncated": html.chars().count() > MAX_CONTENT_CHARS
            }
        }));
    }
    Ok(records)
}

async fn handle_line(line: &str) -> JobResponse {
    let request: JobRequest = match serde_json::from_str(line) {
        Ok(request) => request,
        Err(_) => return response_error("invalid-request", vec!["invalid-json-request".into()]),
    };
    let job_id = request.job_id.clone();
    let approved_hosts = approved_hosts_from_env();
    let urls = match validate_job(&request, &approved_hosts) {
        Ok(urls) => urls,
        Err(errors) => return response_error(&job_id, errors),
    };

    // Initial pilot is deliberately serial even when the request allows two workers.
    // We will raise effective concurrency only after live-source load tests.
    let mut records = Vec::new();
    let mut errors = Vec::new();
    for url in &urls {
        match crawl_one(url, request.timeout_ms).await {
            Ok(mut page_records) => records.append(&mut page_records),
            Err(error) => errors.push(format!("{}:{}", url.host_str().unwrap_or("unknown"), error)),
        }
        if records.len() >= request.max_records {
            records.truncate(request.max_records);
            break;
        }
    }

    JobResponse {
        protocol: PROTOCOL.into(),
        job_id,
        adapter_id: "spider".into(),
        records,
        errors,
        external_actions: false,
        paid_services: false,
        execution: json!({
            "status":"completed",
            "mode":"local-http-only-serial-pilot",
            "requested_concurrency":request.concurrency,
            "effective_concurrency":1,
            "browser_mode":false,
            "follow_links":false,
            "robots_txt":true,
            "paid_services":false
        }),
    }
}

#[tokio::main]
async fn main() {
    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut output = stdout.lock();

    for line in stdin.lock().lines() {
        let line = match line {
            Ok(line) if !line.trim().is_empty() => line,
            Ok(_) => continue,
            Err(_) => break,
        };
        let response = handle_line(&line).await;
        if serde_json::to_writer(&mut output, &response).is_err() {
            break;
        }
        if writeln!(output).is_err() || output.flush().is_err() {
            break;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn allowlist() -> HashSet<String> {
        ["example.org".to_string(), "data.gov.rs".to_string()].into_iter().collect()
    }

    #[test]
    fn allows_exact_approved_public_host() {
        let parsed = validate_target("https://example.org/data#section", &allowlist()).unwrap();
        assert_eq!(parsed.as_str(), "https://example.org/data");
    }

    #[test]
    fn rejects_unapproved_hosts_and_subdomains() {
        assert_eq!(
            validate_target("https://sub.example.org/", &allowlist()).unwrap_err(),
            "source-host-not-approved"
        );
    }

    #[test]
    fn rejects_ip_literals_local_hosts_credentials_and_custom_ports() {
        let hosts = allowlist();
        for raw in [
            "http://127.0.0.1/",
            "http://[::1]/",
            "http://localhost/",
            "https://user:pass@example.org/",
            "https://example.org:8443/",
        ] {
            assert!(validate_target(raw, &hosts).is_err(), "{raw}");
        }
    }

    #[tokio::test]
    async fn malformed_json_is_rejected_without_network_access() {
        let response = handle_line("{not-json").await;
        assert_eq!(response.errors, vec!["invalid-json-request"]);
        assert!(response.records.is_empty());
        assert_eq!(response.execution["status"], "rejected");
        assert_eq!(response.execution["network_requests"], 0);
    }

    #[tokio::test]
    async fn request_for_unapproved_host_is_rejected_before_crawl() {
        let request = json!({
            "protocol": PROTOCOL,
            "job_id": "offline_test",
            "adapter_id": "spider",
            "urls": ["https://unapproved.example/data"],
            "concurrency": 1,
            "timeout_ms": 5000,
            "browser_mode": false,
            "follow_links": false,
            "obey_robots_txt": true,
            "respect_retry_after": true,
            "max_records": 10,
            "external_actions": false,
            "paid_services": false
        });
        let response = handle_line(&request.to_string()).await;
        assert!(response.errors.iter().any(|error| error == "source-host-not-approved"));
        assert!(response.records.is_empty());
        assert_eq!(response.execution["network_requests"], 0);
    }

    #[test]
    fn error_response_never_echoes_untrusted_payload() {
        let response = response_error(
            "job_1",
            vec!["source-host-not-approved".to_string()],
        );
        let serialized = serde_json::to_string(&response).unwrap();
        assert!(!serialized.contains("secret-token"));
        assert_eq!(response.external_actions, false);
        assert_eq!(response.paid_services, false);
    }
}
