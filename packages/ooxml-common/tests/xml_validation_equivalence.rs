fn assert_equivalent(xml: &str) {
    let expected = roxmltree_reference::Document::parse(xml)
        .map(|_| ())
        .map_err(|error| format!("{error:?}"));
    let actual = roxmltree::validate(xml)
        .map(|_| ())
        .map_err(|error| format!("{error:?}"));
    assert_eq!(actual, expected, "XML: {xml}");
}

#[test]
fn hundred_thousand_generated_documents_match_unmodified_roxmltree() {
    // Fixed-seed grammar probes, including competing errors: compare the exact
    // upstream variant, payload and position, not merely accept/reject status.
    let mut state = 0x9e3779b97f4a7c15u64;
    let mut pick = |count| {
        state ^= state << 13;
        state ^= state >> 7;
        state ^= state << 17;
        state as usize % count
    };
    let declarations = [
        "",
        " xmlns:p='u'",
        " xmlns:q='u'",
        " xmlns:p='v'",
        " xmlns:p=''",
        " xmlns='u' xmlns='v'",
        " xmlns='v' xmlns='u'",
        " xmlns:xml='http://www.w3.org/XML/1998/namespace'",
        " xmlns:p='u&amp;v' xmlns:q='u&#38;v'",
        " xmlns:p='u' xmlns:p='v'",
        " xmlns:xml='bad'",
        " xmlns:q='http://www.w3.org/2000/xmlns/'",
        " q:xmlns='v'",
        " xmlns='u&#10;v'",
    ];
    let attributes = [
        "",
        " a='1'",
        " p:a='1' q:b='2'",
        " p:a='1' q:a='2'",
        " a='1' a='2'",
        " missing:a='1'",
        " a='&unknown;'",
        " a='&#0;'",
        " a='&amp;&#10;&quot;'",
        " xml:a='1'",
        " xml:a='1' xml:a='2'",
        " a='1' a='&unknown;'",
    ];
    let names = ["a", "p:a", "q:a", "xml:a", "missing:a", "xmlns:a", "é"];
    let text = [
        "",
        "text",
        "&amp;&#32;",
        "<![CDATA[x]]>",
        "<!-- x -->",
        "<?pi x?>",
        "&missing;",
    ];
    for probe in 0..100_000 {
        // Half exercise successful shadowing/restoration throughout the tree;
        // the other half mix malformed syntax, namespace and entity errors.
        let valid = probe % 2 == 0;
        let mut xml = String::from("<r xmlns:p='u' xmlns:q='v'>");
        let mut open = Vec::new();
        for _ in 0..1 + pick(12) {
            if !open.is_empty() && pick(4) == 0 {
                xml.push_str(&format!("</{}>", open.pop().unwrap()));
            }
            let name = names[pick(if valid { 4 } else { names.len() })];
            xml.push_str(&format!(
                "<{name}{}{}",
                declarations[pick(if valid { 9 } else { declarations.len() })],
                attributes[pick(if valid { 3 } else { attributes.len() })]
            ));
            if pick(3) == 0 {
                xml.push_str("/>");
            } else {
                xml.push('>');
                open.push(name);
            }
            xml.push_str(text[pick(if valid { 6 } else { text.len() })]);
        }
        while let Some(name) = open.pop() {
            xml.push_str(&format!("</{name}>"));
        }
        xml.push_str(match if valid { 7 } else { pick(8) } {
            0 => "<x missing:a='1' a='1' a='2'/></r>",
            1 => "<x a='1' a='2' missing:b='1'/></r>",
            2 => "</wrong>",
            3 => "<x></r>",
            _ => "</r>",
        });
        assert_equivalent(&xml);
    }
}

#[test]
fn namespace_value_ceiling_matches_upstream_with_reused_prefixes_and_uris() {
    // Ascending fixed-width URIs avoid making the unmodified DOM oracle's
    // sorted-vector insertion quadratic. Reused values must not consume IDs.
    let mut xml = String::from("<r>");
    for i in 0..65_535 {
        xml.push_str(&format!("<a xmlns:p='u{i:05}'/><a xmlns:p='u{i:05}'/>"));
    }
    assert_equivalent(&(xml.clone() + "</r>"));
    xml.push_str("<a xmlns:p='one-more'/></r>");
    assert_equivalent(&xml);
    assert!(matches!(
        roxmltree::validate(&xml),
        Err(roxmltree::Error::NamespacesLimitReached)
    ));
}
