use ooxml_common::depth::{parse_guarded, GuardedParseError, MAX_XML_DEPTH};
use std::time::{Duration, Instant};

fn elapsed(xml: &str) -> Duration {
    // Use the median of interleaved runs: input generation is excluded and an
    // isolated scheduler pause cannot decide the regression result.
    let start = Instant::now();
    std::hint::black_box(roxmltree::validate(std::hint::black_box(xml)).unwrap());
    start.elapsed()
}

#[test]
fn adversarial_validation_scales_with_input_before_depth_rejection() {
    for kind in [
        "shadowed-prefix",
        "distinct-prefixes",
        "attributes",
        "namespace-attributes",
        "long-uri-attributes",
    ] {
        let input = |size| match kind {
            "shadowed-prefix" => "<a xmlns:p='u'>".repeat(size) + &"</a>".repeat(size),
            "distinct-prefixes" => {
                (0..size)
                    .map(|i| format!("<a xmlns:p{i}='u'>"))
                    .collect::<String>()
                    + &"</a>".repeat(size)
            }
            _ => {
                let mut xml = String::from("<a");
                if kind == "long-uri-attributes" {
                    // Rehashing the namespace URI per attribute would multiply
                    // two independent input dimensions despite O(1) map lookup.
                    xml.push_str(&format!(" xmlns:p='{}'", "u".repeat(size)));
                }
                // Descending names also expose sorted-vector namespace interning.
                for i in (0..size).rev() {
                    if kind == "attributes" {
                        xml.push_str(&format!(" a{i}='&amp;'"));
                    } else if kind == "long-uri-attributes" {
                        xml.push_str(&format!(" p:a{i}='1'"));
                    } else {
                        xml.push_str(&format!(" xmlns:p{i}='u' p{i}:a{i}='1'"));
                    }
                }
                xml + ">"
                    + &"<a>".repeat(MAX_XML_DEPTH as usize)
                    + &"</a>".repeat(MAX_XML_DEPTH as usize + 1)
            }
        };
        // Unique namespaces retain upstream's 2^16-value ceiling.
        let small_size = if matches!(
            kind,
            "distinct-prefixes" | "namespace-attributes" | "long-uri-attributes"
        ) {
            5_000
        } else {
            20_000
        };
        let small = input(small_size);
        let large = input(small_size * 4);
        elapsed(&small);
        elapsed(&large);
        let mut small_times = Vec::new();
        let mut large_times = Vec::new();
        for _ in 0..3 {
            small_times.push(elapsed(&small));
            large_times.push(elapsed(&large));
        }
        small_times.sort();
        large_times.sort();
        let ratio = large_times[1].as_secs_f64() / small_times[1].as_secs_f64();
        eprintln!(
            "{kind}: {:?} -> {:?}, ratio {ratio:.2}",
            small_times[1], large_times[1]
        );
        assert!(ratio < 10.0, "{kind}: 4x input took {ratio:.2}x time");
        for xml in [&small, &large] {
            assert!(matches!(
                parse_guarded(xml),
                Err(GuardedParseError::TooDeep)
            ));
        }
    }
}
