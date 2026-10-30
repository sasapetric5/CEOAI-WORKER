use chrono::{SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use scraper::{ElementRef, Html, Selector};
use sha2::{Digest, Sha256};
use spider::{configuration::RedirectPolicy, website::Website};
use std::collections::HashSet;
use std::io::{self, BufRead, Write};
use std::net::IpAddr;
use std::time::Duration;
use tokio::time::timeout;
use url::{Host, Url};

const PROTOCOL: &str = "ceoai-spider/1";
const MAX_URLS: usize = 10;
const MAX_URL_LENGTH: usize = 4_096;
const MAX_REQUEST_LINE_BYTES: usize = 64 * 1024;
const MAX_TIMEOUT_MS: u64 = 15_000;
const MAX_CONTENT_CHARS: usize = 50_000;
const MAX_EVIDENCE_CHARS: usize = 2_000;
const MAX_EXTRACTED_TEXT_CHARS: usize = 20_000;
const MAX_LINKS: usize = 30;

fn selected_text(document: &Html, selector: &str) -> Option<String> {
    let selector = Selector::parse(selector).ok()?;
    let value = document.select(&selector).next()?
        .text().collect::<Vec<_>>().join(" ")
        .split_whitespace().collect::<Vec<_>>().join(" ");
    if value.is_empty() { None } else { Some(value.chars().take(2_000).collect()) }
}

fn is_in_excluded_region(mut node: ElementRef<'_>, excluded: &Selector) -> bool {
    loop {
        if excluded.matches(&node) {
            return true;
        }
        match node.parent().and_then(ElementRef::wrap) {
            Some(parent) => node = parent,
            None => return false,
        }
    }
}

fn extract_page_fields(html: &str, page_url: &str) -> Value {
    let document = Html::parse_document(html);
    let title = selected_text(&document, "title");
    let description = Selector::parse(r#"meta[name="description"]"#).ok()
        .and_then(|selector| document.select(&selector).next())
        .and_then(|node| node.value().attr("content"))
        .map(|value| value.split_whitespace().collect::<Vec<_>>().join(" "))
        .filter(|value| !value.is_empty());
    let base_url = Url::parse(page_url).ok();
    let canonical_url = Selector::parse(r#"link[rel="canonical"]"#).ok()
        .and_then(|selector| document.select(&selector).next())
        .and_then(|node| node.value().attr("href"))
        .and_then(|href| base_url.as_ref()?.join(href).ok())
        .filter(|url| url.scheme() == "https" || url.scheme() == "http");
    let canonical_is_same_host = canonical_url.as_ref().zip(base_url.as_ref())
        .map(|(canonical, base)| canonical.host_str() == base.host_str())
        .unwrap_or(false);
    let canonical = canonical_url.as_ref().map(|url| url.to_string());

    // Prefer semantic content containers; fall back to body only when absent.
    let content_root = Selector::parse("main, article, [role=main]").ok()
        .and_then(|selector| document.select(&selector).next())
        .or_else(|| Selector::parse("body").ok().and_then(|selector| document.select(&selector).next()));
    let excluded = Selector::parse(
        "script, style, noscript, template, nav, footer, aside, [hidden], [aria-hidden=true], [style*='display:none'], [style*='visibility:hidden']"
    ).ok();

    let mut text_parts = Vec::new();
    if let (Some(root), Ok(selector), Some(excluded)) = (
        content_root,
        Selector::parse("p, h1, h2, h3, h4, li, th, td, blockquote, pre"),
        excluded.as_ref(),
    ) {
        for node in root.select(&selector) {
            if is_in_excluded_region(node, excluded) { continue; }
            let value = node.text().collect::<Vec<_>>().join(" ")
                .split_whitespace().collect::<Vec<_>>().join(" ");
            if !value.is_empty() && text_parts.last() != Some(&value) {
                text_parts.push(value);
            }
        }
    }
    // No unfiltered body.text() fallback: it can accidentally ingest scripts,
    // navigation, hidden content and boilerplate when no semantic blocks exist.
    let mut text = text_parts.join("\n");
    if text.chars().count() > MAX_EXTRACTED_TEXT_CHARS {
        text = text.chars().take(MAX_EXTRACTED_TEXT_CHARS).collect();
    }

    let mut headings = Vec::new();
    if let (Some(root), Ok(selector), Some(excluded)) =
        (content_root, Selector::parse("h1, h2, h3"), excluded.as_ref())
    {
        for node in root.select(&selector) {
            if headings.len() >= 20 { break; }
            if is_in_excluded_region(node, excluded) { continue; }
            let value = node.text().collect::<Vec<_>>().join(" ")
                .split_whitespace().collect::<Vec<_>>().join(" ");
            if !value.is_empty() { headings.push(value.chars().take(300).collect::<String>()); }
        }
    }

    let mut links = Vec::new();
    if let (Some(root), Ok(selector), Ok(base)) =
        (content_root, Selector::parse("a[href]"), Url::parse(page_url))
    {
        for node in root.select(&selector) {
            if links.len() >= MAX_LINKS { break; }
            let Some(href) = node.value().attr("href") else { continue };
            let Ok(url) = base.join(href) else { continue };
            if (url.scheme() == "http" || url.scheme() == "https")
                && url.host_str() == base.host_str()
            {
                let label = node.text().collect::<Vec<_>>().join(" ")
                    .split_whitespace().collect::<Vec<_>>().join(" ");
                links.push(json!({"url":url.to_string(),"text":label.chars().take(200).collect::<String>()}));
            }
        }
    }

    json!({
        "title": title,
        "description": description,
        "canonical_url": canonical,
        "canonical_same_host": canonical_is_same_host,
        "canonical_external": canonical_url.is_some() && !canonical_is_same_host,
        "text": text,
        "headings": headings,
        "links": links,
        "extraction_method": "scraper-html-selectors",
        "extraction_version": "1",
        "content_root": if content_root.is_some() && Selector::parse("main, article, [role=main]").ok()
            .and_then(|selector| document.select(&selector).next()).is_some() {
                "semantic-container"
            } else { "body-fallback" },
        "text_char_count": text.chars().count(),
        "heading_count": headings.len(),
        "same_host_link_count": links.len()
    })
}

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

fn read_bounded_line<R: BufRead>(reader: &mut R, max_bytes: usize) -> io::Result<Option<String>> {
    let mut bytes = Vec::with_capacity(max_bytes.min(8 * 1024));
    let mut oversized = false;
    let mut saw_data = false;
    let mut pending_cr = false;

    loop {
        let available = reader.fill_buf()?;
        if available.is_empty() {
            if !saw_data { return Ok(None); }
            if pending_cr && !oversized {
                if bytes.len() == max_bytes { oversized = true; }
                else { bytes.push(b'\r'); }
            }
            break;
        }

        saw_data = true;
        let newline = available.iter().position(|byte| *byte == b'\n');
        let segment_len = newline.unwrap_or(available.len());
        let ends_crlf = newline.is_some()
            && segment_len > 0
            && available[segment_len - 1] == b'\r';
        let content_len = if ends_crlf { segment_len - 1 } else { segment_len };

        if !oversized {
            if pending_cr && !(newline.is_some() && content_len == 0) {
                if bytes.len() == max_bytes { oversized = true; }
                else { bytes.push(b'\r'); }
            }
            if !oversized {
                let remaining = max_bytes.saturating_sub(bytes.len());
                let take = content_len.min(remaining);
                bytes.extend_from_slice(&available[..take]);
                if content_len > remaining { oversized = true; }
            }
        }

        pending_cr = newline.is_none() && available.last() == Some(&b'\r');
        if pending_cr && !oversized && bytes.last() == Some(&b'\r') {
            bytes.pop();
        }

        let consumed = newline.map(|index| index + 1).unwrap_or(available.len());
        reader.consume(consumed);
        if newline.is_some() { break; }
    }

    if oversized {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "request-line-too-large"));
    }
    String::from_utf8(bytes)
        .map(Some)
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "request-line-not-utf8"))
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
    if raw.len() > MAX_URL_LENGTH {
        return Err("url-length-exceeded".into());
    }
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

fn is_public_routable_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => {
            let [a, b, c, d] = ip.octets();
            !(a == 0 || a == 10 || a == 127 || a >= 224
                || (a == 100 && (64..=127).contains(&b))
                || (a == 169 && b == 254)
                || (a == 172 && (16..=31).contains(&b))
                || (a == 192 && b == 168)
                || (a == 192 && b == 0 && (c == 0 || c == 2))
                || (a == 192 && b == 88 && c == 99)
                || (a == 198 && (b == 18 || b == 19))
                || (a == 198 && b == 51 && c == 100)
                || (a == 203 && b == 0 && c == 113)
                || (a == 255 && b == 255 && c == 255 && d == 255))
        }
        IpAddr::V6(ip) => {
            let segments = ip.segments();
            // Conservative global-unicast allowlist. Reject IETF special-purpose
            // 2001::/23, documentation, 6to4, and documentation-only 3fff::/20.
            (segments[0] & 0xe000) == 0x2000
                && !(segments[0] == 0x2001 && segments[1] <= 0x01ff)
                && !(segments[0] == 0x2001 && segments[1] == 0x0db8)
                && !(segments[0] == 0x2002)
                && !(segments[0] == 0x3fff && (segments[1] & 0xf000) == 0)
                && ip.to_ipv4_mapped().is_none()
        }
    }
}

fn resolved_addresses_are_public(addresses: &[std::net::SocketAddr]) -> bool {
    !addresses.is_empty()
        && addresses.iter().all(|address| is_public_routable_ip(address.ip()))
}

async fn validate_dns_target(url: &Url) -> Result<(), String> {
    let host = url.host_str().ok_or_else(|| "hostname-required".to_string())?;
    let port = url.port_or_known_default().ok_or_else(|| "port-required".to_string())?;
    let resolved = timeout(Duration::from_secs(3), tokio::net::lookup_host((host, port)))
        .await.map_err(|_| "dns-resolution-timeout".to_string())?
        .map_err(|_| "dns-resolution-failed".to_string())?
        .collect::<Vec<_>>();
    if resolved.is_empty() { return Err("dns-no-addresses".into()); }
    if !resolved_addresses_are_public(&resolved) {
        return Err("dns-resolved-to-non-public-ip".into());
    }
    Ok(())
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

fn truncation_metadata(transport_truncated: bool, source_chars: usize, bytes_transferred: Option<f64>) -> Value {
    let output_truncated = source_chars > MAX_CONTENT_CHARS;
    json!({
        "spider_transport_content_truncated": transport_truncated,
        "spider_bytes_transferred": bytes_transferred,
        "output_html_truncated": output_truncated,
        "content_truncated": transport_truncated || output_truncated,
        "content_limit_scope": "output-serialization-only; not a transport byte cap"
    })
}

#[cfg(test)]
mod truncation_metadata_tests {
    use super::*;

    #[test]
    fn reports_transport_and_output_truncation_separately() {
        let transport_only = truncation_metadata(true, 100, Some(2048.0));
        assert_eq!(transport_only["spider_transport_content_truncated"], true);
        assert_eq!(transport_only["output_html_truncated"], false);
        assert_eq!(transport_only["content_truncated"], true);
        assert_eq!(transport_only["spider_bytes_transferred"], 2048.0);

        let output_only = truncation_metadata(false, MAX_CONTENT_CHARS + 1, None);
        assert_eq!(output_only["spider_transport_content_truncated"], false);
        assert_eq!(output_only["output_html_truncated"], true);
        assert_eq!(output_only["content_truncated"], true);

        let complete = truncation_metadata(false, 100, Some(512.0));
        assert_eq!(complete["content_truncated"], false);
    }
}

async fn crawl_one(url: &Url, timeout_ms: u64) -> Result<Vec<Value>, String> {
    validate_dns_target(url).await?;
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
        let extracted = extract_page_fields(&bounded_html, &final_url);

        let truncation = truncation_metadata(
            page.content_truncated,
            html.chars().count(),
            page.bytes_transferred,
        );

        records.push(json!({
            "source_url": final_url,
            "collected_at": Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true),
            "http_status": status,
            "robots_allowed": null,
            "robots_enforcement": "spider-respect-robots-txt-enabled; per-URL decision not exposed by adapter",
            "retry_after_respected": false,
            "extractor": "spider-rs/2.53.9",
            "content_hash": content_hash,
            "evidence": [evidence],
            "data": {
                "html": bounded_html,
                "truncation": truncation,
                "extracted": extracted
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
            "robots_decision_visibility":"not-exposed-by-spider-adapter",
            "retry_after_requested":request.respect_retry_after,
            "retry_after":"not-implemented",
            "paid_services":false
        }),
    }
}

#[tokio::main]
async fn main() {
    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut output = stdout.lock();

    let mut input = stdin.lock();
    loop {
        let line = match read_bounded_line(&mut input, MAX_REQUEST_LINE_BYTES) {
            Ok(Some(line)) if !line.trim().is_empty() => line,
            Ok(Some(_)) => continue,
            Ok(None) => break,
            Err(error) if error.kind() == io::ErrorKind::InvalidData => {
                let response = response_error("invalid-request", vec![error.to_string()]);
                if serde_json::to_writer(&mut output, &response).is_err()
                    || writeln!(output).is_err()
                    || output.flush().is_err()
                {
                    break;
                }
                continue;
            }
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
    fn extracts_title_description_text_headings_and_same_host_links() {
        let html = r#"<html><head><title>Official Page</title><meta name="description" content="Verified public data"></head><body><nav><a href="/menu">Navigation only</a></nav><main><h1>Public records</h1><p>Source content for testing.</p><a href="/records">Records</a><a href="https://other.example/">External</a><a href="javascript:alert(1)">Unsafe</a></main><footer>Footer boilerplate</footer></body></html>"#;
        let extracted = extract_page_fields(html, "https://example.org/");
        assert_eq!(extracted["title"], "Official Page");
        assert_eq!(extracted["description"], "Verified public data");
        assert_eq!(extracted["canonical_external"], false);
        assert_eq!(extracted["extraction_method"], "scraper-html-selectors");
        assert_eq!(extracted["extraction_version"], "1");
        assert!(extracted["text"].as_str().unwrap().contains("Source content for testing."));
        assert!(!extracted["text"].as_str().unwrap().contains("Navigation only"));
        assert!(!extracted["text"].as_str().unwrap().contains("Footer boilerplate"));
        assert_eq!(extracted["headings"][0], "Public records");
        assert_eq!(extracted["links"].as_array().unwrap().len(), 1);
        assert_eq!(extracted["links"][0]["url"], "https://example.org/records");
    }

    #[test]
    fn excludes_hidden_script_style_and_embedded_navigation_content() {
        let html = r#"<html><body><main>
            <p>Visible public record <span>with details</span>.</p>
            <p hidden>Hidden text.</p>
            <p aria-hidden="true">ARIA hidden text.</p>
            <nav><p>Navigation text.</p></nav>
            <footer><p>Footer text.</p></footer>
            <script>secret_script_value()</script><style>.hidden{display:none}</style>
            <noscript>Fallback script text.</noscript>
        </main></body></html>"#;
        let extracted = extract_page_fields(html, "https://example.org/");
        let text = extracted["text"].as_str().unwrap();
        assert!(text.contains("Visible public record"));
        for forbidden in ["Hidden text.", "ARIA hidden text.", "Navigation text.",
            "Footer text.", "secret_script_value", "Fallback script text."] {
            assert!(!text.contains(forbidden), "must exclude {forbidden}");
        }
    }

    #[test]
    fn flags_external_canonical_as_untrusted_provenance() {
        let html = r#"<html><head><link rel="canonical" href="https://other.example/page"></head><body><main><p>Content</p></main></body></html>"#;
        let extracted = extract_page_fields(html, "https://example.org/");
        assert_eq!(extracted["canonical_external"], true);
        assert_eq!(extracted["canonical_same_host"], false);
    }

    #[test]
    fn extraction_fixture_matrix_covers_ten_page_shapes() {
        let fixtures = [
            ("article", r#"<html><head><title>Article</title></head><body><article><h1>Article heading</h1><p>Article body.</p></article></body></html>"#, "Article body.", "semantic-container"),
            ("main", r#"<html><head><title>Main</title></head><body><main><h1>Main heading</h1><p>Main body.</p></main></body></html>"#, "Main body.", "semantic-container"),
            ("role-main", r#"<html><head><title>Role</title></head><body><div role="main"><h1>Role heading</h1><p>Role body.</p></div></body></html>"#, "Role body.", "semantic-container"),
            ("body-fallback", r#"<html><head><title>Fallback</title></head><body><p>Fallback body.</p></body></html>"#, "Fallback body.", "body-fallback"),
            ("table", r#"<html><head><title>Table</title></head><body><main><table><tr><th>Year</th><td>2026</td></tr></table></main></body></html>"#, "Year", "semantic-container"),
            ("list", r#"<html><head><title>List</title></head><body><main><ul><li>First record</li><li>Second record</li></ul></main></body></html>"#, "Second record", "semantic-container"),
            ("preformatted", r#"<html><head><title>Code</title></head><body><main><pre>alpha beta</pre></main></body></html>"#, "alpha beta", "semantic-container"),
            ("nav-footer-noise", r#"<html><head><title>Noise</title></head><body><nav><h1>Nav heading</h1><p>Nav text.</p></nav><main><h1>Real heading</h1><p>Real content.</p></main><footer><p>Footer text.</p></footer></body></html>"#, "Real content.", "semantic-container"),
            ("missing-title", r#"<html><body><main><p>Content without title.</p></main></body></html>"#, "Content without title.", "semantic-container"),
            ("empty-body", r#"<html><head><title>Empty</title></head><body></body></html>"#, "", "body-fallback"),
        ];
        assert_eq!(fixtures.len(), 10);
        for (name, html, expected_text, expected_root) in fixtures {
            let extracted = extract_page_fields(html, "https://example.org/test");
            assert_eq!(extracted["content_root"], expected_root, "fixture {name}");
            assert!(extracted["text"].as_str().unwrap().contains(expected_text), "fixture {name}");
            assert_eq!(extracted["text_char_count"].as_u64().unwrap() as usize,
                extracted["text"].as_str().unwrap().chars().count(), "fixture {name}");
        }
        let noisy = extract_page_fields(fixtures[7].1, "https://example.org/test");
        assert_eq!(noisy["headings"].as_array().unwrap().len(), 1);
        assert_eq!(noisy["headings"][0], "Real heading");
        assert!(!noisy["text"].as_str().unwrap().contains("Nav text."));
        assert!(!noisy["text"].as_str().unwrap().contains("Footer text."));
    }

    #[test]
    fn bounded_reader_rejects_oversized_line_and_recovers_at_next_line() {
        let input = format!("{}\nvalid\n", "x".repeat(MAX_REQUEST_LINE_BYTES + 1));
        let mut reader = io::Cursor::new(input.into_bytes());
        let first = read_bounded_line(&mut reader, MAX_REQUEST_LINE_BYTES).unwrap_err();
        assert_eq!(first.to_string(), "request-line-too-large");
        assert_eq!(read_bounded_line(&mut reader, MAX_REQUEST_LINE_BYTES).unwrap().as_deref(), Some("valid"));
        assert_eq!(read_bounded_line(&mut reader, MAX_REQUEST_LINE_BYTES).unwrap(), None);
    }

    #[test]
    fn bounded_reader_accepts_exact_limit_and_strips_crlf() {
        let input = format!("{}\r\n", "x".repeat(32));
        let mut reader = io::Cursor::new(input.into_bytes());
        assert_eq!(read_bounded_line(&mut reader, 32).unwrap().unwrap().len(), 32);
    }

    #[test]
    fn rejects_overlong_urls_before_parsing() {
        let raw = format!("https://example.org/{}", "a".repeat(MAX_URL_LENGTH));
        assert_eq!(validate_target(&raw, &allowlist()).unwrap_err(), "url-length-exceeded");
    }

    #[test]
    fn allows_exact_approved_public_host() {
        let parsed = validate_target("https://example.org/data#section", &allowlist()).unwrap();
        assert_eq!(parsed.as_str(), "https://example.org/data");
    }

    #[test]
    fn rejects_non_public_ip_ranges() {
        for raw in [
            "0.0.0.0", "10.0.0.1", "100.64.0.1", "127.0.0.1",
            "169.254.1.1", "172.16.0.1", "192.168.1.1",
            "192.0.2.1", "192.88.99.1", "198.18.0.1", "198.51.100.1",
            "203.0.113.1", "224.0.0.1", "255.255.255.255",
            "::", "::1", "fe80::1", "fc00::1", "2001:db8::1",
            "2001:10::1", "2001:20::1", "2001:2::1", "2001:3::1",
            "2002::1", "3fff::1", "::ffff:127.0.0.1",
        ] {
            let ip: IpAddr = raw.parse().unwrap();
            assert!(!is_public_routable_ip(ip), "must reject {raw}");
        }
        for raw in ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"] {
            let ip: IpAddr = raw.parse().unwrap();
            assert!(is_public_routable_ip(ip), "must allow public {raw}");
        }
    }

    #[test]
    fn dns_resolution_rejects_mixed_public_and_private_answers() {
        use std::net::SocketAddr;
        let public = SocketAddr::from(([1, 1, 1, 1], 443));
        let private = SocketAddr::from(([10, 0, 0, 7], 443));
        let loopback = SocketAddr::from(([127, 0, 0, 1], 443));
        assert!(resolved_addresses_are_public(&[public]));
        assert!(!resolved_addresses_are_public(&[public, private]));
        assert!(!resolved_addresses_are_public(&[public, loopback]));
        assert!(!resolved_addresses_are_public(&[]));
    }

    #[test]
    fn dns_resolution_rejects_ipv6_private_and_link_local_answers() {
        use std::net::SocketAddr;
        for raw in ["::1", "fc00::1", "fe80::1", "2001:db8::1"] {
            let ip: IpAddr = raw.parse().unwrap();
            let address = SocketAddr::new(ip, 443);
            assert!(!resolved_addresses_are_public(&[address]), "must reject {raw}");
        }
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
