//! Markdown projection helpers shared by the DOCX, PPTX and XLSX converters.
//!
//! Markdown output is consumed by renderers and LLM chat UIs that may turn it
//! into HTML, so document data must not become live markup: link
//! destinations follow the viewer's hyperlink scheme policy (the TypeScript
//! `sanitizeHyperlinkUrl` in `packages/core/src/interaction/hyperlink.ts`),
//! and inline text cannot open a link, image or raw-HTML construct.

/// Schemes a projected link may carry; mirrors the viewer's
/// `DEFAULT_ALLOWED_HYPERLINK_SCHEMES`.
const ALLOWED_LINK_SCHEMES: [&str; 4] = ["http", "https", "mailto", "tel"];

/// Characters a URL consumer may strip or trim before resolving the scheme:
/// ASCII controls and space (browsers drop embedded TAB/LF/CR), Unicode
/// whitespace such as U+00A0 (Markdown renderers trim it), and U+FEFF.
fn is_ignorable(c: char) -> bool {
    c <= ' ' || c.is_whitespace() || c.is_control() || c == '\u{feff}'
}

/// The lowercased RFC 3986 scheme of `url`, ignoring the characters in
/// [`is_ignorable`] (so `java\tscript:` or a leading U+00A0 cannot hide it).
fn link_scheme(url: &str) -> Option<String> {
    let cleaned: String = url.chars().filter(|&c| !is_ignorable(c)).collect();
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
/// destination (any whitespace, controls, U+FEFF, `(`, `)`, `<`, `>`, `\`) are
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
        if is_ignorable(c) || matches!(c, '(' | ')' | '<' | '>' | '\\') {
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

/// Where projected document text is placed; selects the extra handling on top
/// of the inline escaping every context shares.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum TextContext {
    /// Running text (paragraphs, list items, quoted comment lines). Line
    /// breaks are kept.
    Inline,
    /// An ATX heading label: line breaks become spaces (a heading is one
    /// line) and `#` is escaped so the text cannot form a closing sequence.
    Heading,
    /// A GFM table cell: `|` is escaped and line breaks become `<br>` so the
    /// text stays inside its cell and row.
    TableCell,
}

/// Escape document text for the Markdown projection so it reads as literal
/// text: every [`is_inline_metachar`] is backslash-escaped, plus the
/// [`TextContext`]-specific handling. Markdown the converter emits itself
/// (heading markers, quote prefixes, `<br>` between paragraphs, link syntax
/// for an allowed destination) is written around the result, never through
/// it. The output is at most four bytes per input byte (a lone `\n` becoming
/// `<br>`), which projection size bounds rely on.
pub fn escape_text(text: &str, context: TextContext) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if context != TextContext::Inline && matches!(c, '\r' | '\n') {
            if c == '\r' && chars.peek() == Some(&'\n') {
                chars.next();
            }
            out.push_str(if context == TextContext::Heading {
                " "
            } else {
                "<br>"
            });
            continue;
        }
        if is_inline_metachar(c)
            || (context == TextContext::Heading && c == '#')
            || (context == TextContext::TableCell && c == '|')
        {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn document_text_cannot_form_links_images_or_html() {
        let attack = "<img src=x onerror=alert(1)> [x](javascript:alert(1)) ![i](y)";
        let escaped = r"\<img src=x onerror=alert(1)> \[x\](javascript:alert(1)) \!\[i\](y)";
        assert_eq!(escape_text(attack, TextContext::Inline), escaped);
        assert_eq!(escape_text(attack, TextContext::Heading), escaped);
        assert_eq!(escape_text(attack, TextContext::TableCell), escaped);
        // Ordinary punctuation is untouched.
        let plain = "Q3 revenue: $1,200 (+5%) - see p. 4; a/b & c.";
        for context in [
            TextContext::Inline,
            TextContext::Heading,
            TextContext::TableCell,
        ] {
            assert_eq!(escape_text(plain, context), plain);
        }
    }

    #[test]
    fn contexts_keep_text_inside_its_construct() {
        let text = "a|b #1\r\nc\rd\ne";
        assert_eq!(escape_text(text, TextContext::Inline), text);
        assert_eq!(escape_text(text, TextContext::Heading), r"a|b \#1 c d e");
        assert_eq!(
            escape_text(text, TextContext::TableCell),
            r"a\|b #1<br>c<br>d<br>e"
        );
    }

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
            "\u{a0}vscode://example.com/x",
            "\u{feff}javascript:alert(1)",
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
            link_destination("https://e.example/a\u{a0}b").as_deref(),
            Some("https://e.example/a%C2%A0b")
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
