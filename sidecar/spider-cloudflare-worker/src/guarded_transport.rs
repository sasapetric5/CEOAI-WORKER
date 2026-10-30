//! Cloudflare Worker transport security gate.
//!
//! These validators are intentionally stricter than a normal URL validator.
//! The current Workers Fetch runtime does not expose a DNS answer set or the
//! connected peer IP to this Rust handler, so the production transport adapter
//! MUST fail closed instead of pretending those checks happened.

use std::{
    collections::HashSet,
    net::{IpAddr, SocketAddr},
};
use url::{Host, Url};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Capabilities {
    pub dns_resolution: bool,
    pub dns_pinning: bool,
    pub peer_ip_verification: bool,
    pub redirect_validation: bool,
    pub bounded_streaming: bool,
}

impl Capabilities {
    /// No supported Cloudflare Workers API currently gives this adapter both
    /// the DNS answer set and the actual connected peer address. Until a
    /// controlled egress primitive supplies both, crawling remains disabled.
    pub(crate) const fn current_runtime() -> Self {
        Self {
            dns_resolution: false,
            dns_pinning: false,
            peer_ip_verification: false,
            redirect_validation: false,
            bounded_streaming: false,
        }
    }

    pub(crate) const fn permits_crawl(self) -> bool {
        self.dns_resolution
            && self.dns_pinning
            && self.peer_ip_verification
            && self.redirect_validation
            && self.bounded_streaming
    }
}

pub(crate) fn is_public_ip(ip: IpAddr) -> bool {
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

/// DNS is accepted only when every answer is public. Mixed public/private
/// answer sets are rejected to prevent DNS rebinding and address selection
/// ambiguity.
pub(crate) fn validate_dns_answers(addresses: &[IpAddr]) -> Result<(), &'static str> {
    if addresses.is_empty() {
        return Err("dns-empty-answer-set");
    }
    if addresses.iter().any(|ip| !is_public_ip(*ip)) {
        return Err("dns-non-public-answer");
    }
    Ok(())
}

/// The peer must be one of the exact addresses resolved for this request and
/// must use the requested destination port.
pub(crate) fn verify_peer(
    resolved: &[SocketAddr],
    peer: Option<SocketAddr>,
) -> Result<(), &'static str> {
    let peer = peer.ok_or("peer-address-unavailable")?;
    if !is_public_ip(peer.ip()) {
        return Err("peer-address-non-public");
    }
    if !resolved.iter().any(|address| *address == peer) {
        return Err("peer-address-not-pinned");
    }
    Ok(())
}

pub(crate) fn validate_redirect(
    current: &Url,
    next: &Url,
    approved_hosts: &HashSet<String>,
) -> Result<(), &'static str> {
    if !matches!(next.scheme(), "http" | "https") {
        return Err("redirect-scheme-forbidden");
    }
    if !next.username().is_empty() || next.password().is_some() {
        return Err("redirect-credentials-forbidden");
    }
    if next.port().is_some_and(|port| port != 80 && port != 443) {
        return Err("redirect-port-forbidden");
    }
    let host = match next.host() {
        Some(Host::Domain(host)) => host.trim_end_matches('.').to_ascii_lowercase(),
        _ => return Err("redirect-hostname-only"),
    };
    if !approved_hosts.contains(&host) {
        return Err("redirect-host-not-approved");
    }
    if current.host_str().map(str::to_ascii_lowercase) != Some(host) {
        return Err("redirect-cross-host-forbidden");
    }
    Ok(())
}

/// A deliberate fail-closed adapter placeholder. It never performs a network
/// request. It becomes replaceable only when the runtime exposes DNS pinning
/// and peer verification, not merely a generic fetch() function.
pub(crate) struct WorkerGuardedTransport;

impl WorkerGuardedTransport {
    pub(crate) fn ensure_supported() -> Result<(), &'static str> {
        if Capabilities::current_runtime().permits_crawl() {
            Ok(())
        } else {
            Err("guarded-transport-capability-unavailable")
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn allowlist() -> HashSet<String> {
        ["example.org".to_string()].into_iter().collect()
    }

    #[test]
    fn rejects_empty_and_mixed_public_private_dns_answers() {
        assert_eq!(validate_dns_answers(&[]), Err("dns-empty-answer-set"));
        assert!(validate_dns_answers(&["1.1.1.1".parse().unwrap()).is_ok());
        assert_eq!(
            validate_dns_answers(&["1.1.1.1".parse().unwrap(), "10.0.0.8".parse().unwrap()]),
            Err("dns-non-public-answer")
        );
    }

    #[test]
    fn rejects_private_and_special_ipv4_ipv6_addresses() {
        for raw in [
            "0.0.0.0", "10.0.0.1", "100.64.0.1", "127.0.0.1",
            "169.254.1.1", "172.16.0.1", "192.168.1.1", "192.0.2.1",
            "198.18.0.1", "198.51.100.1", "203.0.113.1", "224.0.0.1",
            "255.255.255.255", "::", "::1", "fc00::1", "fe80::1",
            "2001:db8::1", "2002::1", "::ffff:127.0.0.1",
        ] {
            assert!(!is_public_ip(raw.parse().unwrap()), "must reject {raw}");
        }
        for raw in ["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111"] {
            assert!(is_public_ip(raw.parse().unwrap()), "must allow {raw}");
        }
    }

    #[test]
    fn peer_must_match_the_pinned_dns_socket_exactly() {
        let pinned = SocketAddr::from(([1, 1, 1, 1], 443));
        assert!(verify_peer(&[pinned], Some(pinned)).is_ok());
        assert_eq!(
            verify_peer(&[pinned], Some(SocketAddr::from(([8, 8, 8, 8], 443)))),
            Err("peer-address-not-pinned")
        );
        assert_eq!(verify_peer(&[pinned], None), Err("peer-address-unavailable"));
        assert_eq!(
            verify_peer(&[pinned], Some(SocketAddr::from(([127, 0, 0, 1], 443)))),
            Err("peer-address-non-public")
        );
    }

    #[test]
    fn redirects_must_stay_on_same_approved_host_and_safe_port() {
        let current = Url::parse("https://example.org/start").unwrap();
        let hosts = allowlist();
        assert!(validate_redirect(
            &current,
            &Url::parse("https://example.org/next").unwrap(),
            &hosts
        ).is_ok());
        for raw in [
            "https://evil.example/next",
            "http://127.0.0.1/",
            "http://[::1]/",
            "https://example.org:8443/",
            "file:///etc/passwd",
            "https://user:pass@example.org/",
        ] {
            assert!(validate_redirect(&current, &Url::parse(raw).unwrap(), &hosts).is_err(), "{raw}");
        }
    }

    #[test]
    fn worker_adapter_fails_closed_without_runtime_dns_and_peer_capabilities() {
        let capabilities = Capabilities::current_runtime();
        assert!(!capabilities.permits_crawl());
        assert_eq!(
            WorkerGuardedTransport::ensure_supported(),
            Err("guarded-transport-capability-unavailable")
        );
    }
}
