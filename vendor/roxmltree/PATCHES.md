# Local roxmltree 0.20.0 patch

Source: crates.io roxmltree 0.20.0 (MIT OR Apache-2.0); original licenses retained.
Keep this version aligned with the unmodified `roxmltree-reference` test oracle.

The tokenizer parses element content iteratively rather than recursing once per
element. DTD entity expansion retains the existing bounded loop detector.

`validate` reuses the DOM context and every token handler, with DTDs disabled as
in `Document::parse`. It returns maximum open content depth only after complete
success. Validation retains open ancestors, the current element's attributes,
and namespace bindings (with scope boundaries instead of copied inherited
lists); it discards completed elements/attributes and normalized text. Namespace values retain the original DOM deduplication table and its u16
ceiling, so that limit and namespace equality rules remain identical. No second
XML grammar, attribute/entity checker or namespace resolver is maintained.

`packages/ooxml-common/src/depth.rs` applies resource policy only after this
validation succeeds. Its generated corpus compares errors with the unmodified
registry DOM parser, and native format tests verify optional-part fallback.
