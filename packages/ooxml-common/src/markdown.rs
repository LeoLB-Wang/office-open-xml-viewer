//! Markdown projection helpers shared by the DOCX and PPTX converters.
//!
//! Markdown output is consumed by renderers and LLM chat UIs that may turn it
//! into HTML, so document data must not become live markup: link
//! destinations follow the viewer's hyperlink scheme policy (the TypeScript
//! `sanitizeHyperlinkUrl` in `packages/core/src/interaction/hyperlink.ts`),
//! and inline text cannot open a link, image or raw-HTML construct.

/// Schemes a projected link may carry; mirrors the viewer's
/// `DEFAULT_ALLOWED_HYPERLINK_SCHEMES`.
const ALLOWED_LINK_SCHEMES: [&str; 4] = ["http", "https", "mailto", "tel"];

/// The lowercased RFC 3986 scheme of `url`, ignoring the ASCII whitespace and
/// C0 controls browsers strip (so `java\tscript:` is seen as `javascript`).
fn link_scheme(url: &str) -> Option<String> {
    let cleaned: String = url.chars().filter(|&c| c > ' ').collect();
    let (scheme, _) = cleaned.split_once(':')?;
    let mut chars = scheme.chars();
    let first = chars.next()?;
    (first.is_ascii_alphabetic()
        && chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '-' | '.')))
    .then(|| scheme.to_ascii_lowercase())
}

/// A Markdown link destination for a document hyperlink target, or `None` when
/// the target must not become a link (an empty target or a scheme outside the
/// allowlist, such as `javascript:` or `data:`); the caller then emits the link
/// text alone. A scheme-less (relative) reference cannot name a dangerous
/// scheme and is kept. Characters that would end or restructure the
/// destination (whitespace, controls, `(`, `)`, `<`, `>`, `\`) are
/// percent-encoded so the target cannot break out into further Markdown, and
/// `&` is written as `&amp;` so CommonMark entity decoding (`&colon;`,
/// `&#58;`) reproduces the checked target instead of forming a new scheme.
pub fn link_destination(url: &str) -> Option<String> {
    if url.is_empty() {
        return None;
    }
    if let Some(scheme) = link_scheme(url) {
        if !ALLOWED_LINK_SCHEMES.contains(&scheme.as_str()) {
            return None;
        }
    }
    let mut out = String::with_capacity(url.len());
    for c in url.chars() {
        if c <= ' ' || c == '\u{7f}' || matches!(c, '(' | ')' | '<' | '>' | '\\') {
            let mut buf = [0u8; 4];
            for byte in c.encode_utf8(&mut buf).bytes() {
                out.push_str(&format!("%{byte:02X}"));
            }
        } else if c == '&' {
            out.push_str("&amp;");
        } else {
            out.push(c);
        }
    }
    Some(out)
}

/// True for inline characters escaped in projected text: formatting
/// metacharacters (`\ * _ \``) plus the characters that would open a link,
/// image or raw HTML from document text (`[`, `]`, `<`, and `!`, which would
/// turn a following projected link into an image).
pub fn is_inline_metachar(c: char) -> bool {
    matches!(c, '\\' | '*' | '_' | '`' | '[' | ']' | '<' | '!')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn link_destinations_follow_the_viewer_scheme_policy() {
        assert_eq!(
            link_destination("https://example.com/a?b=c#d").as_deref(),
            Some("https://example.com/a?b=c#d")
        );
        assert_eq!(
            link_destination("MAILTO:x@example.com").as_deref(),
            Some("MAILTO:x@example.com")
        );
        assert_eq!(
            link_destination("docs/page.html").as_deref(),
            Some("docs/page.html")
        );
        for blocked in [
            "javascript:alert(1)",
            " java\tscript:alert(1)",
            "data:text/html,x",
            "vbscript:x",
            "file:///etc/passwd",
            "",
        ] {
            assert_eq!(link_destination(blocked), None, "{blocked:?}");
        }
        // Entity forms stay literal after CommonMark decoding.
        assert_eq!(
            link_destination("javascript&colon;alert(1)").as_deref(),
            Some("javascript&amp;colon;alert%281%29")
        );
        assert_eq!(
            link_destination("https://e.example/?a=1&b=2").as_deref(),
            Some("https://e.example/?a=1&amp;b=2")
        );
        assert_eq!(
            link_destination("https://e.example/x) [y](https://evil.example/").as_deref(),
            Some("https://e.example/x%29%20[y]%28https://evil.example/")
        );
    }
}
