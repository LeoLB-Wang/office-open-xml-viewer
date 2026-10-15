use super::*;
use std::io::{Cursor, Write};

fn package(body: &str, parts: &[(&str, &str)]) -> Vec<u8> {
    let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
    write_test_content_types(&mut writer);
    let document = format!(
        r#"<w:document xmlns:w="{W_NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>{body}</w:body></w:document>"#
    );
    for (name, xml) in
        std::iter::once(("word/document.xml", document.as_str())).chain(parts.iter().copied())
    {
        writer
            .start_file(name, zip::write::SimpleFileOptions::default())
            .unwrap();
        writer.write_all(xml.as_bytes()).unwrap();
    }
    writer.finish().unwrap().into_inner()
}

fn assert_depth_error(error: &str, limit: u32) {
    let payload: serde_json::Value =
        serde_json::from_str(error.strip_prefix("OOXML_RESOURCE_LIMIT:").expect(error)).unwrap();
    assert_eq!(payload["code"], "ooxml-resource-limit");
    assert_eq!(payload["details"]["violation"]["metric"], "depth");
    assert_eq!(payload["details"]["violation"]["limit"], limit);
}

#[test]
fn optional_styles_and_header_footer_depth_fail_closed_at_package_boundary() {
    let deep = "<w:x>".repeat(257) + &"</w:x>".repeat(257);
    for (tag, path) in [
        ("styles", "word/styles.xml"),
        ("hdr", "word/header1.xml"),
        ("ftr", "word/footer1.xml"),
    ] {
        let xml = format!(r#"<w:{tag} xmlns:w="{W_NS}">{deep}</w:{tag}>"#);
        let kind = if tag == "hdr" { "header" } else { "footer" };
        let rels = format!(
            r#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="h" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/{kind}" Target="{}"/></Relationships>"#,
            path.strip_prefix("word/").unwrap()
        );
        let body =
            format!(r#"<w:p/><w:sectPr><w:{kind}Reference w:type="default" r:id="h"/></w:sectPr>"#);
        let bytes = package(
            &body,
            &[(path, &xml), ("word/_rels/document.xml.rels", &rels)],
        );
        let error = parse_from_bytes(&bytes).expect_err("optional part limit must reject document");
        assert_depth_error(&error, 256);
        let error = parse_from_bytes_streamed_with_limits(&bytes, None, None, "depth-test")
            .expect_err("streamed document must reject optional part limit");
        assert_depth_error(&error, 256);
    }
}

#[test]
fn nested_table_depth_fails_closed_before_publishing_document() {
    std::thread::Builder::new()
        .stack_size(32 * 1024 * 1024)
        .spawn(|| {
            let mut body = "<w:p/>".to_string();
            for _ in 0..66 {
                body = format!("<w:tbl><w:tr><w:tc>{body}</w:tc></w:tr></w:tbl>");
            }
            let bytes = package(&body, &[]);
            let error = parse_from_bytes(&bytes).expect_err("nested tables must reject document");
            assert_depth_error(&error, 64);
            let error = parse_from_bytes_streamed_with_limits(&bytes, None, None, "depth-test")
                .expect_err("streamed tables must reject document");
            assert_depth_error(&error, 64);
        })
        .unwrap()
        .join()
        .unwrap();
}

#[test]
fn textbox_container_and_table_depth_fail_closed() {
    let xml = format!(
        r#"<w:txbxContent xmlns:w="{W_NS}"><w:tbl><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl></w:txbxContent>"#
    );
    let document = roxmltree::Document::parse(&xml).unwrap();
    for container_descent in [true, false] {
        let mut zip = Zip::new(Cursor::new(package("<w:p/>", &[]))).unwrap();
        let error = zip
            .run_operation("textbox-test", |_| {
                let parse = if container_descent {
                    parse_text_box_content_at_depth
                } else {
                    parse_text_box_content
                };
                let _provisional = parse(
                    document.root_element(),
                    &StyleMap::parse(""),
                    &mut NumberingMap::default(),
                    &HashMap::new(),
                    &ChartMap::default(),
                    &HashMap::new(),
                    &ThemeColors::default(),
                    DepthGuard::with_limit(0),
                );
                Ok(())
            })
            .unwrap_err();
        assert_depth_error(&error, 0);
    }
}

mod lexical_depth_cases {
    include!("../../../../ooxml-common/tests/support/lexical_depth_cases.rs");
}

#[test]
fn optional_styles_distinguish_lexical_depth_from_shallow_content_errors() {
    let baseline = package("<w:p/>", &[("word/styles.xml", "<broken")]);
    let expected = serde_json::to_value(parse_from_bytes(&baseline).unwrap()).unwrap();
    let expected_streamed = serde_json::to_value(
        parse_from_bytes_streamed_with_limits(&baseline, None, None, "depth-test").unwrap(),
    )
    .unwrap();
    for (name, xml, crossing) in lexical_depth_cases::lexical_depth_cases() {
        let bytes = package("<w:p/>", &[("word/styles.xml", &xml)]);
        let result = parse_from_bytes(&bytes);
        let streamed = parse_from_bytes_streamed_with_limits(&bytes, None, None, "depth-test");
        if crossing {
            assert_depth_error(&result.unwrap_err(), 256);
            assert_depth_error(&streamed.unwrap_err(), 256);
        } else {
            assert_eq!(
                serde_json::to_value(result.expect(name)).unwrap(),
                expected,
                "{name}"
            );
            assert_eq!(
                serde_json::to_value(streamed.expect(name)).unwrap(),
                expected_streamed,
                "{name}"
            );
        }
    }
}
