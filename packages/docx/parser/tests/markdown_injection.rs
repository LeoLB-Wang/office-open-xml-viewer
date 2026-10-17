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
    let mut bytes = Vec::new();
    {
        let mut zip = zip::ZipWriter::new(Cursor::new(&mut bytes));
        for (name, text) in [
            (
                "[Content_Types].xml",
                r#"<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>"#
                    .to_string(),
            ),
            ("word/document.xml", document),
            ("word/_rels/document.xml.rels", rels),
        ] {
            zip.start_file(name, SimpleFileOptions::default()).unwrap();
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
        "<w:p>{}{}{}</w:p><w:p><w:r><w:t>&lt;img src=x onerror=alert(1)&gt; ![p](https://t.example/p.png)</w:t></w:r></w:p>",
        link("rJs", "script"),
        link("rBreak", "safe"),
        link("rOk", "ok"),
    );
    let bytes = docx_with_links(
        &[
            ("rJs", "javascript:alert(document.domain)"),
            ("rBreak", "https://e.example/x) [y](https://evil.example/"),
            ("rOk", "https://example.com/a?b=c"),
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
    assert!(
        markdown.contains(r"!\[p\](https://t.example/p.png)"),
        "{markdown}"
    );
}
