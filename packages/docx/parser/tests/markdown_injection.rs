//! Markdown output is rendered by downstream Markdown/HTML consumers, so
//! hyperlink targets and run text from an untrusted document must not become
//! script links, injected links or raw HTML.

use docx_parser::to_markdown_native;
use std::io::{Cursor, Write};
use zip::write::SimpleFileOptions;

const W_NS: &str = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R_NS: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

fn docx_with_links(links: &[(&str, &str)], body: &str) -> Vec<u8> {
    let relationships: String = links
        .iter()
        .map(|(id, target)| {
            format!(
                r#"<Relationship Id="{id}" Type="{R_NS}/hyperlink" Target="{target}" TargetMode="External"/>"#
            )
        })
        .collect();
    let document = format!(
        r#"<w:document xmlns:w="{W_NS}" xmlns:r="{R_NS}"><w:body>{body}<w:sectPr/></w:body></w:document>"#
    );
    let rels = format!(
        r#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">{relationships}</Relationships>"#
    );
    package(&[
        ("word/document.xml", document),
        ("word/_rels/document.xml.rels", rels),
    ])
}

fn package(parts: &[(&str, String)]) -> Vec<u8> {
    let mut bytes = Vec::new();
    {
        let mut zip = zip::ZipWriter::new(Cursor::new(&mut bytes));
        zip.start_file("[Content_Types].xml", SimpleFileOptions::default())
            .unwrap();
        zip.write_all(
            br#"<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>"#,
        )
        .unwrap();
        for (name, text) in parts {
            zip.start_file(*name, SimpleFileOptions::default()).unwrap();
            zip.write_all(text.as_bytes()).unwrap();
        }
        zip.finish().unwrap();
    }
    bytes
}

fn link(id: &str, text: &str) -> String {
    format!(
        r#"<w:hyperlink r:id="{id}"><w:r><w:t xml:space="preserve">{text}</w:t></w:r></w:hyperlink>"#
    )
}

#[test]
fn hyperlinks_and_text_cannot_inject_markdown_links_or_html() {
    let body = format!(
        "<w:p>{}{}{}</w:p><w:p><w:r><w:t>&lt;img src=x onerror=alert(1)&gt; ![p](https://t.example/p.png)</w:t></w:r></w:p><w:p><w:r><w:t>!</w:t></w:r>{}</w:p><w:p>{}</w:p>",
        link("rJs", "script"),
        link("rBreak", "safe"),
        link("rOk", "ok"),
        link("rOk", "pic"),
        link("rEntity", "entity"),
    );
    let bytes = docx_with_links(
        &[
            ("rJs", "javascript:alert(document.domain)"),
            ("rBreak", "https://e.example/x) [y](https://evil.example/"),
            ("rOk", "https://example.com/a?b=c"),
            ("rEntity", "javascript&amp;colon;alert(1)"),
        ],
        &body,
    );
    let markdown = to_markdown_native(&bytes).expect("markdown projects");
    assert!(!markdown.contains("javascript:"), "{markdown}");
    assert!(markdown.contains("script"), "link text is kept: {markdown}");
    assert!(
        markdown.contains("[safe](https://e.example/x%29%20[y]%28https://evil.example/)"),
        "{markdown}"
    );
    assert!(
        markdown.contains("[ok](https://example.com/a?b=c)"),
        "{markdown}"
    );
    assert!(markdown.contains(r"\<img src=x"), "{markdown}");
    // A preceding `!` run cannot turn the projected link into an image.
    assert!(
        markdown.contains(r"\![pic](https://example.com/a?b=c)"),
        "{markdown}"
    );
    // CommonMark decodes entities in destinations; `&` stays literal.
    assert!(
        markdown.contains("[entity](javascript&amp;colon;alert%281%29)"),
        "{markdown}"
    );
    assert!(
        markdown.contains(r"\!\[p\](https://t.example/p.png)"),
        "{markdown}"
    );
}

/// Review comments and note labels carry document text too; they reach the
/// output as literal text while the converter's own quote and heading syntax
/// stays intact.
#[test]
fn review_comments_and_note_labels_cannot_inject_markdown_links_or_html() {
    const ATTACK: &str = "&lt;img src=x onerror=alert(1)&gt; [x](javascript:alert(1))";
    let document = format!(
        r#"<w:document xmlns:w="{W_NS}"><w:body><w:p><w:r><w:t>body</w:t></w:r></w:p><w:sectPr/></w:body></w:document>"#
    );
    let rels = format!(
        r#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="c" Type="{R_NS}/comments" Target="comments.xml"/><Relationship Id="f" Type="{R_NS}/footnotes" Target="footnotes.xml"/></Relationships>"#
    );
    let comments = format!(
        r#"<w:comments xmlns:w="{W_NS}"><w:comment w:id="&lt;b&gt;#" w:author="[a](javascript:alert(1))"><w:p><w:r><w:t xml:space="preserve">{ATTACK} Plain line, 50% done.</w:t></w:r></w:p></w:comment></w:comments>"#
    );
    let footnotes = format!(
        r#"<w:footnotes xmlns:w="{W_NS}"><w:footnote w:id="]&lt;img src=x onerror=alert(1)&gt;"><w:p><w:r><w:t>note</w:t></w:r></w:p></w:footnote></w:footnotes>"#
    );
    let bytes = package(&[
        ("word/document.xml", document),
        ("word/_rels/document.xml.rels", rels),
        ("word/comments.xml", comments),
        ("word/footnotes.xml", footnotes),
    ]);

    let markdown = to_markdown_native(&bytes).expect("markdown projects");

    assert!(markdown.contains("### Comment \\<b>\\#\n"), "{markdown}");
    assert!(
        markdown.contains("> **\\[a\\](javascript:alert(1))**\n"),
        "{markdown}"
    );
    assert!(
        markdown.contains(
            "> \\<img src=x onerror=alert(1)> \\[x\\](javascript:alert(1)) Plain line, 50% done.\n"
        ),
        "{markdown}"
    );
    assert!(
        markdown.contains("[^\\]\\<img src=x onerror=alert(1)>]: note"),
        "{markdown}"
    );
    assert!(
        !markdown.contains(" <img") && !markdown.contains("[x]("),
        "{markdown}"
    );
}

/// Document text cannot form Markdown structure either: entities,
/// strikethrough and code fences stay literal, a heading keeps its trailing
/// `#`s, a line break inside a table cell stays inside the cell, block
/// markers at a line start (including an ordered-list marker split across
/// runs) do not open blocks, and a lone CR in a comment cannot end the quote.
#[test]
fn document_text_cannot_form_blocks_entities_or_fences() {
    let document = format!(
        r#"<w:document xmlns:w="{W_NS}"><w:body><w:p><w:pPr><w:outlineLvl w:val="0"/></w:pPr><w:r><w:t xml:space="preserve">Topic ###</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>first</w:t><w:br/><w:t xml:space="preserve"># forged</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>a|b</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><w:r><w:t>1</w:t></w:r><w:r><w:t xml:space="preserve">. split</w:t></w:r></w:p><w:p><w:r><w:t xml:space="preserve">~~deleted~~ &amp;copy;</w:t></w:r></w:p><w:p><w:r><w:t>```</w:t></w:r><w:r><w:br/></w:r><w:r><w:t xml:space="preserve">&gt; quoted</w:t></w:r></w:p><w:sectPr/></w:body></w:document>"#
    );
    let rels = format!(
        r#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="c" Type="{R_NS}/comments" Target="comments.xml"/></Relationships>"#
    );
    let comments = format!(
        r#"<w:comments xmlns:w="{W_NS}"><w:comment w:id="1" w:author="A"><w:p><w:r><w:t xml:space="preserve">alpha&#13;&#13;~~~&#13;outside</w:t></w:r></w:p></w:comment></w:comments>"#
    );
    let bytes = package(&[
        ("word/document.xml", document),
        ("word/_rels/document.xml.rels", rels),
        ("word/comments.xml", comments),
    ]);

    let markdown = to_markdown_native(&bytes).expect("markdown projects");

    assert!(markdown.starts_with("# Topic \\#\\#\\#\n"), "{markdown}");
    assert!(
        markdown.contains("| first<br># forged | a\\|b |\n| --- | --- |\n"),
        "{markdown}"
    );
    assert!(markdown.contains("\n1\\. split\n"), "{markdown}");
    assert!(
        markdown.contains("\n\\~\\~deleted\\~\\~ \\&copy;\n"),
        "{markdown}"
    );
    assert!(
        markdown.contains("\n\\`\\`\\`  \n\\> quoted\n"),
        "{markdown}"
    );
    assert!(
        markdown.contains("> alpha\n> \n> \\~\\~\\~\n> outside\n"),
        "{markdown}"
    );
}
