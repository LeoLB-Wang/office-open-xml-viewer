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
/// metacharacters (`\ * _ \`` and the GFM strikethrough `~`), `&` (which
/// would start an entity or numeric character reference), and the characters
/// that would open a link, image or raw HTML from document text (`[`, `]`,
/// `<`, and `!`, which would turn a following projected link into an image).
/// Escaping every backtick and tilde also means document text can never open
/// a code fence.
pub fn is_inline_metachar(c: char) -> bool {
    matches!(
        c,
        '\\' | '*' | '_' | '`' | '~' | '&' | '[' | ']' | '<' | '!'
    )
}

/// Where projected document text is placed; selects the extra handling on top
/// of the inline escaping every context shares.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum TextContext {
    /// Running text (paragraphs, list items, notes, quoted comment lines).
    /// Line breaks are kept, and the start of the text and of every line is
    /// treated as a line start (see [`escape_text`]).
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
/// [`TextContext`]-specific handling. In [`TextContext::Inline`] a block
/// marker at a line start (after optional spaces or tabs) is escaped too, so
/// the text cannot open an ATX heading (`#`), block quote (`>`), list item
/// (`-`, `+`, `1.`, `1)`), setext underline or thematic break (`=`, `-`).
/// Fragments are treated as starting a line because the converter may place
/// them there; an escaped marker in mid-line renders unchanged.
///
/// Markdown the converter emits itself (heading markers, quote prefixes,
/// `<br>` between paragraphs, link syntax for an allowed destination) is
/// written around the result, never through it. The output is at most four
/// bytes per input byte (a lone `\n` becoming `<br>`; every other rule at most
/// doubles), which projection size bounds rely on.
pub fn escape_text(text: &str, context: TextContext) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    let mut at_line_start = context == TextContext::Inline;
    while let Some(c) = rest.chars().next() {
        if at_line_start {
            at_line_start = false;
            let body = rest.trim_start_matches([' ', '\t']);
            out.push_str(&rest[..rest.len() - body.len()]);
            rest = body;
            if let Some(marker) = block_marker_offset(rest) {
                out.push_str(&rest[..marker]);
                out.push('\\');
                // The marker is ASCII punctuation that no other rule escapes
                // in this context, so it is copied as is.
                out.push_str(&rest[marker..=marker]);
                rest = &rest[marker + 1..];
            }
            continue;
        }
        rest = &rest[c.len_utf8()..];
        if matches!(c, '\r' | '\n') {
            let crlf = c == '\r' && rest.starts_with('\n');
            match context {
                TextContext::Inline => {
                    out.push_str(if crlf {
                        "\r\n"
                    } else if c == '\r' {
                        "\r"
                    } else {
                        "\n"
                    });
                    at_line_start = true;
                }
                TextContext::Heading => out.push(' '),
                TextContext::TableCell => out.push_str("<br>"),
            }
            if crlf {
                rest = &rest[1..];
            }
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

/// Byte offset of the character to escape when `line` (with its indentation
/// removed) would begin a CommonMark block: an ATX heading, block quote,
/// bullet or ordered list item, setext underline or thematic break. Markers
/// that need a following space are only escaped when one (or the end of the
/// text, which another fragment may continue) follows. A bare `.`/`)` counts
/// as an ordered-list delimiter because the digits may end a preceding run.
/// `*`, `_`, `` ` `` and `~` never reach here unescaped.
fn block_marker_offset(line: &str) -> Option<usize> {
    let bytes = line.as_bytes();
    let ends_marker = |index: usize| {
        bytes
            .get(index)
            .is_none_or(|b| matches!(b, b' ' | b'\t' | b'\r' | b'\n'))
    };
    match *bytes.first()? {
        b'>' => Some(0),
        b'#' => {
            let hashes = bytes.iter().take_while(|&&b| b == b'#').count();
            (hashes <= 6 && ends_marker(hashes)).then_some(0)
        }
        b'-' => (ends_marker(1) || bytes.get(1) == Some(&b'-')).then_some(0),
        b'=' => (ends_marker(1) || bytes.get(1) == Some(&b'=')).then_some(0),
        b'+' => ends_marker(1).then_some(0),
        _ => {
            let digits = bytes.iter().take_while(|b| b.is_ascii_digit()).count();
            (digits <= 9
                && matches!(bytes.get(digits), Some(b'.' | b')'))
                && ends_marker(digits + 1))
            .then_some(digits)
        }
    }
}

/// Split `text` into lines at CRLF, CR and LF alike. CommonMark ends a line at
/// each of them, so a quote prefix must be written after every one; a final
/// line break does not start an extra empty line.
pub fn split_lines(text: &str) -> impl Iterator<Item = &str> {
    let mut rest = Some(text);
    std::iter::from_fn(move || {
        let current = rest?;
        match current.find(['\r', '\n']) {
            Some(index) => {
                let next = if current[index..].starts_with("\r\n") {
                    index + 2
                } else {
                    index + 1
                };
                rest = (next < current.len()).then(|| &current[next..]);
                Some(&current[..index])
            }
            None => {
                rest = None;
                Some(current)
            }
        }
    })
}

/// Upper bound on the lines [`split_lines`] yields for `text`.
pub fn line_count_bound(text: &str) -> u64 {
    text.bytes().filter(|&b| b == b'\r' || b == b'\n').count() as u64 + 1
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
        // Ordinary punctuation is untouched, including mid-line block markers.
        let plain = "Q3 revenue: $1,200 (+5%) - see p. 4; a/b, -5 and =SUM(A1) #tag 2026.10";
        for context in [
            TextContext::Inline,
            TextContext::Heading,
            TextContext::TableCell,
        ] {
            assert_eq!(
                escape_text(plain, context),
                plain.replace(
                    '#',
                    if context == TextContext::Heading {
                        r"\#"
                    } else {
                        "#"
                    }
                )
            );
        }
    }

    #[test]
    fn entities_strikethrough_and_fences_stay_literal() {
        assert_eq!(
            escape_text("&copy; &#60; ~~gone~~", TextContext::Inline),
            r"\&copy; \&#60; \~\~gone\~\~"
        );
        assert_eq!(
            escape_text("x\n```\n~~~", TextContext::Inline),
            "x\n\\`\\`\\`\n\\~\\~\\~"
        );
    }

    #[test]
    fn line_start_block_markers_are_escaped_in_running_text() {
        for (line, escaped) in [
            ("# forged", r"\# forged"),
            ("###", r"\###"),
            ("  > quote", r"  \> quote"),
            (">quote", r"\>quote"),
            ("- item", r"\- item"),
            ("---", r"\---"),
            ("+ item", r"\+ item"),
            ("===", r"\==="),
            ("1. item", r"1\. item"),
            ("12) item", r"12\) item"),
            (". rest of a split 1.", r"\. rest of a split 1."),
            ("-", r"\-"),
            // Not block markers: left alone.
            ("#tag", "#tag"),
            ("-5%", "-5%"),
            ("+1", "+1"),
            ("=SUM(A1)", "=SUM(A1)"),
            ("2026.10", "2026.10"),
            ("1234567890. big", "1234567890. big"),
        ] {
            assert_eq!(escape_text(line, TextContext::Inline), escaped, "{line:?}");
        }
        assert_eq!(
            escape_text("a\r# b\r\n> c\n- d", TextContext::Inline),
            "a\r\\# b\r\n\\> c\n\\- d"
        );
        // Headings and cells are inline-only constructs.
        assert_eq!(escape_text("- a", TextContext::TableCell), "- a");
        assert_eq!(escape_text("> a", TextContext::Heading), "> a");
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
    fn lines_split_at_cr_lf_and_crlf() {
        let text = "a\r\rb\r\nc\nd\n";
        assert_eq!(
            split_lines(text).collect::<Vec<_>>(),
            ["a", "", "b", "c", "d"]
        );
        assert!(split_lines(text).count() as u64 <= line_count_bound(text));
        assert_eq!(split_lines("").collect::<Vec<_>>(), [""]);
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
