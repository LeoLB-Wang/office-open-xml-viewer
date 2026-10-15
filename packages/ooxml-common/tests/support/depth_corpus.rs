// Shared generated inputs for DOM equivalence and native package wiring tests.
// Injections before, inside and after the deep chain ensure validation cannot
// publish a crossing before checking the remainder of the part.
pub fn depth_corpus(depth: usize) -> Vec<(String, String, bool)> {
    let mut cases = Vec::new();
    for (name, fragment, valid) in [
        ("plain", "<x/>", true),
        (
            "repeated-default-namespace",
            "<x xmlns='u' xmlns='v'><y/></x>",
            true,
        ),
        ("inherited-prefix", "<p:x p:a='1'/>", true),
        (
            "namespace-shadow",
            "<x xmlns:p='urn:inner'><p:x/></x><p:x/>",
            true,
        ),
        (
            "namespace-sibling-leak",
            "<x xmlns:q='urn:inner'/><q:x/>",
            false,
        ),
        (
            "normalized-namespace-duplicate",
            "<x xmlns:a='u&amp;v' xmlns:b='u&#38;v' a:c='1' b:c='2'/>",
            false,
        ),
        ("bad-quoted-delimiter", "<x a='>' a='2'/>", false),
        (
            "valid-entities",
            "<x a='&quot;&gt;&#10;'>&amp;&#x20;&lt;</x>",
            true,
        ),
        ("illegal-character", "<x a='\u{1}'/>", false),
        ("duplicate-attribute", "<x a='1' a='2'/>", false),
        (
            "duplicate-expanded-attribute",
            "<x xmlns:a='u' xmlns:b='u' a:v='1' b:v='2'/>",
            false,
        ),
        ("duplicate-namespace", "<x xmlns:a='u' xmlns:a='v'/>", false),
        ("unknown-text-entity", "&unknown;", false),
        ("unknown-attribute-entity", "<x a='&unknown;'/>", false),
        ("invalid-character-reference", "&#0;", false),
        ("undeclared-element-prefix", "<missing:x/>", false),
        ("undeclared-attribute-prefix", "<x missing:a='1'/>", false),
        ("reserved-prefix", "<x xmlns:xml='wrong'/>", false),
        ("mismatch", "<x></y>", false),
        ("unclosed", "<x>", false),
        ("invalid-empty-tag", "<x / >", false),
        ("quoted-delimiters", "<x a='/> >' b=\"' >\"/>", true),
        ("cdata", "<![CDATA[ <x> > </x> ]]>", true),
        ("comment", "<!-- <x> > </x> -->", true),
        ("pi", "<?test <x> > </x> ?>", true),
        ("bad-comment", "<!-- <x> -- > -->", false),
        ("bad-cdata", "<![CDATA[ <x> >", false),
        ("bad-pi", "<?test <x> >", false),
    ] {
        for position in 0..3 {
            let mut xml = String::from("<r xmlns:p='urn:test'>");
            if position == 0 {
                xml.push_str(fragment);
            }
            xml.push_str(&"<p:a>".repeat(depth));
            if position == 1 {
                xml.push_str(fragment);
            }
            xml.push_str(&"</p:a>".repeat(depth));
            if position == 2 {
                xml.push_str(fragment);
            }
            xml.push_str("</r>");
            cases.push((format!("{name}-{position}-{depth}"), xml, valid));
        }
    }
    cases.push((
        format!("unclosed-chain-{depth}"),
        "<r>".to_string() + &"<a>".repeat(depth),
        false,
    ));
    cases.push((
        format!("mismatched-chain-{depth}"),
        "<r>".to_string() + &"<a>".repeat(depth) + &"</b>".repeat(depth) + "</r>",
        false,
    ));
    cases
}
