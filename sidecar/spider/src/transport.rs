use std::{collections::HashSet, net::{IpAddr, SocketAddr}, time::Duration};

use reqwest::{header::LOCATION, redirect::Policy, StatusCode};
use spider::fetch_engine::{
    EngineError, EngineMethod, EngineRequest, EngineResponse, HttpFetchEngine,
};
use url::{Host, Url};

const MAX_RESPONSE_BYTES: usize = 2 * 1024 * 1024;
const MAX_REDIRECTS: usize = 3;
const MAX_RETRY_AFTER: Duration = Duration::from_secs(30);
const MAX_RETRIES: usize = 2;

fn approved_hosts() -> HashSet<String> {
    std::env::var("CEOAI_CRAWLER_APPROVED_HOSTS")
        .unwrap_or_default()
        .split(',')
        .map(|s| s.trim().trim_end_matches('.').to_ascii_lowercase())
        .filter(|s| !s.is_empty())
        .collect()
}

fn public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => {
            let [a, b, c, _] = ip.octets();
            !(a == 0 || a == 10 || a == 127 || a >= 224
                || (a == 100 && (64..=127).contains(&b))
                || (a == 169 && b == 254)
                || (a == 172 && (16..=31).contains(&b))
                || (a == 192 && b == 168)
                || (a == 192 && b == 0 && (c == 0 || c == 2))
                || (a == 192 && b == 88 && c == 99)
                || (a == 198 && (b == 18 || b == 19))
                || (a == 198 && b == 51 && c == 100)
                || (a == 203 && b == 0 && c == 113))
        }
        IpAddr::V6(ip) => {
            let s = ip.segments();
            (s[0] & 0xe000) == 0x2000
                && !(s[0] == 0x2001 && s[1] <= 0x01ff)
                && !(s[0] == 0x2001 && s[1] == 0x0db8)
                && !(s[0] == 0x2002)
                && !(s[0] == 0x3fff && (s[1] & 0xf000) == 0)
                && ip.to_ipv4_mapped().is_none()
        }
    }
}

fn validate_url(url: &Url, hosts: &HashSet<String>) -> Result<(), String> {
    if !matches!(url.scheme(), "http" | "https") {
        return Err("transport-scheme-forbidden".into());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("transport-credentials-forbidden".into());
    }
    if url.port().is_some_and(|p| p != 80 && p != 443) {
        return Err("transport-port-forbidden".into());
    }
    let host = match url.host() {
        Some(Host::Domain(host)) => host.trim_end_matches('.').to_ascii_lowercase(),
        _ => return Err("transport-hostname-only".into()),
    };
    if !hosts.contains(&host) {
        return Err("transport-host-not-approved".into());
    }
    Ok(())
}

async fn resolve_public(url: &Url) -> Result<Vec<SocketAddr>, String> {
    let host = url.host_str().ok_or("transport-host-required")?;
    let port = url.port_or_known_default().ok_or("transport-port-required")?;
    let addresses = tokio::time::timeout(
        Duration::from_secs(3),
        tokio::net::lookup_host((host, port)),
    ).await.map_err(|_| "transport-dns-timeout")?
        .map_err(|_| "transport-dns-failed")?
        .collect::<Vec<_>>();
    if addresses.is_empty() || addresses.iter().any(|a| !public_ip(a.ip())) {
        return Err("transport-dns-non-public-or-empty".into());
    }
    Ok(addresses)
}

fn retry_after_delay(headers: &reqwest::header::HeaderMap) -> Option<Duration> {
    let raw = headers.get(reqwest::header::RETRY_AFTER)?.to_str().ok()?.trim();
    if let Ok(seconds) = raw.parse::<u64>() {
        return Some(Duration::from_secs(seconds));
    }
    let when = chrono::DateTime::parse_from_rfc2822(raw).ok()?;
    let delta = when.with_timezone(&chrono::Utc).signed_duration_since(chrono::Utc::now());
    Some(delta.to_std().unwrap_or(Duration::ZERO))
}

#[derive(Debug)]
pub(crate) struct GuardedResponse {
    pub status: StatusCode,
    pub final_url: Url,
    pub headers: reqwest::header::HeaderMap,
    pub body: Vec<u8>,
    pub peer: Option<SocketAddr>,
}

pub(crate) async fn fetch_guarded(
    initial_url: &Url,
    timeout_ms: u64,
    body_limit: usize,
    respect_retry_after: bool,
    allow_redirects: bool,
) -> Result<GuardedResponse, String> {
    tokio::time::timeout(
        Duration::from_millis(timeout_ms),
        fetch_guarded_inner(initial_url, timeout_ms, body_limit, respect_retry_after, allow_redirects),
    )
    .await
    .map_err(|_| "transport-total-timeout".to_string())?
}

async fn fetch_guarded_inner(
    initial_url: &Url,
    timeout_ms: u64,
    body_limit: usize,
    respect_retry_after: bool,
    allow_redirects: bool,
) -> Result<GuardedResponse, String> {
    let hosts = approved_hosts();
    let mut current = initial_url.clone();
    let body_limit = body_limit.min(MAX_RESPONSE_BYTES);
    let mut retry_index = 0usize;

    for redirect_index in 0..=MAX_REDIRECTS {
        validate_url(&current, &hosts)?;
        let addresses = resolve_public(&current).await?;
        let host = current.host_str().ok_or("transport-host-required")?;
        let client = reqwest::Client::builder()
            .redirect(Policy::none())
            .resolve_to_addrs(host, &addresses)
            .connect_timeout(Duration::from_secs(5))
            .timeout(Duration::from_millis(timeout_ms))
            .user_agent("CEOAI-Crawler/1.0")
            .build()
            .map_err(|_| "transport-client-build-failed")?;

        let mut response = client.get(current.clone())
            .header(reqwest::header::ACCEPT_ENCODING, "identity")
            .send().await
            .map_err(|_| "transport-request-failed")?;
        let peer = response.remote_addr();
        if !peer.is_some_and(|p| addresses.iter().any(|a| *a == p)) {
            return Err("transport-peer-not-pinned-address".into());
        }

        if response.status().is_redirection() {
            if !allow_redirects {
                return Ok(GuardedResponse {
                    status: response.status(),
                    final_url: current,
                    headers: response.headers().clone(),
                    body: Vec::new(),
                    peer,
                });
            }
            if redirect_index == MAX_REDIRECTS {
                return Err("transport-redirect-limit".into());
            }
            let location = response.headers().get(LOCATION)
                .and_then(|v| v.to_str().ok())
                .ok_or("transport-redirect-without-location")?;
            let next = current.join(location)
                .map_err(|_| "transport-invalid-redirect")?;
            validate_url(&next, &hosts)?;
            if next.host_str() != current.host_str() {
                return Err("transport-cross-host-redirect-forbidden".into());
            }
            current = next;
            continue;
        }

        let status = response.status();
        let headers = response.headers().clone();
        let declared_content_length = headers.get(reqwest::header::CONTENT_LENGTH)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse::<u64>().ok());
        if respect_retry_after
            && (status == StatusCode::TOO_MANY_REQUESTS || status == StatusCode::SERVICE_UNAVAILABLE)
            && retry_index < MAX_RETRIES
        {
            if let Some(wait) = retry_after_delay(&headers) {
                if wait <= MAX_RETRY_AFTER {
                    retry_index += 1;
                    tokio::time::sleep(wait).await;
                    continue;
                }
            }
        }
        if headers.get(reqwest::header::CONTENT_LENGTH)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse::<u64>().ok())
            .is_some_and(|n| n > body_limit as u64)
        {
            return Err("transport-content-length-limit".into());
        }

        let mut body = Vec::with_capacity(body_limit.min(16 * 1024));
        while let Some(chunk) = response.chunk().await
            .map_err(|_| "transport-body-read-failed")? {
            if body.len().saturating_add(chunk.len()) > body_limit {
                return Err("transport-stream-body-limit".into());
            }
            body.extend_from_slice(&chunk);
        }
        return Ok(GuardedResponse {
            status,
            final_url: current,
            headers,
            body,
            peer,
        });
    }
    Err("transport-redirect-limit".into())
}

pub(crate) struct GuardedHttpEngine {
    timeout_ms: u64,
    respect_retry_after: bool,
}

impl GuardedHttpEngine {
    pub(crate) fn new(timeout_ms: u64, respect_retry_after: bool) -> Self {
        Self { timeout_ms, respect_retry_after }
    }
}

#[async_trait::async_trait]
impl HttpFetchEngine for GuardedHttpEngine {
    async fn fetch(&self, request: EngineRequest<'_>) -> Result<EngineResponse, EngineError> {
        if request.method != EngineMethod::Get {
            return Err(EngineError::Request);
        }
        let url = Url::parse(request.url).map_err(|_| EngineError::Request)?;
        let response = fetch_guarded(&url, self.timeout_ms, MAX_RESPONSE_BYTES, self.respect_retry_after, false)
            .await.map_err(|e| EngineError::Other(e))?;
        let status_code = spider::client::StatusCode::from_u16(response.status.as_u16())
            .map_err(|_| EngineError::Request)?;
        Ok(EngineResponse {
            status_code,
            final_url: (response.final_url.as_str() != request.url)
                .then(|| response.final_url.to_string()),
            headers: response.headers,
            remote_addr: response.peer,
            body: response.body,
            declared_content_length,
            served: true,
            ..Default::default()
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redirect_validation_rejects_private_destinations_and_unapproved_hosts() {
        let hosts = ["example.org".to_string()].into_iter().collect();
        for raw in [
            "http://127.0.0.1/",
            "http://[::1]/",
            "https://internal.example.org/",
            "https://evil.example/",
            "file:///etc/passwd",
            "https://user:pass@example.org/",
            "https://example.org:8443/",
            "https://8.8.8.8/",
        ] {
            let url = Url::parse(raw).unwrap();
            assert!(validate_url(&url, &hosts).is_err(), "must reject {raw}");
        }
        assert!(validate_url(&Url::parse("https://example.org/next").unwrap(), &hosts).is_ok());
    }

    #[test]
    fn retry_after_accepts_seconds_and_rejects_invalid_values() {
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert(reqwest::header::RETRY_AFTER, "7".parse().unwrap());
        assert_eq!(retry_after_delay(&headers), Some(Duration::from_secs(7)));
        headers.insert(reqwest::header::RETRY_AFTER, "nonsense".parse().unwrap());
        assert_eq!(retry_after_delay(&headers), None);
    }

    #[test]
    fn response_limit_is_bounded() {
        assert_eq!(MAX_RESPONSE_BYTES, 2 * 1024 * 1024);
        assert_eq!(MAX_REDIRECTS, 3);
    }
}
