# Local roxmltree 0.20.0 patch

Source: crates.io roxmltree 0.20.0 (MIT OR Apache-2.0); original licenses retained.
Keep this version aligned with the unmodified `roxmltree-reference` test oracle.

The tokenizer parses element content iteratively rather than recursing once per
element. DTD entity expansion retains the existing bounded loop detector.

`validate` reuses the DOM context and every token handler, with DTDs disabled as
in `Document::parse`. It returns maximum open content depth only after complete
success. Validation retains open ancestors, the current element's attributes,
and namespace bindings; it discards completed elements/attributes and normalized
text. In the std builds used by the OOXML parsers, scoped prefix hash lookups
and a declaration undo log replace ancestor scans and copied inherited lists.
The nearest declaring element wins, with the first declaration on that element
winning even for upstream's accepted repeated default declarations.

Validation interns normalized URIs and `(prefix, URI ID)` namespace values in
hash tables, preserving the original insertion order and exact u16 value ceiling
without sorted-vector insertion. Duplicate attributes use `(optional URI ID,
local name)` keys, so aliases compare by normalized URI and long URIs are not
rehashed per attribute. These substitutions preserve token/error order; the DOM
builder retains its unmodified resolution and duplicate-checking paths.

Together these operations take expected O(input bytes) time with randomized
hashing. Scratch is O(open ancestors + open declarations + current attributes +
unique namespace values/URI bytes); the namespace-value count retains upstream's
ceiling. Every declaration is pushed/undone once. End tags compare the immediate
parent only. DTDs are disabled before any entity declaration can enter a lookup
table, predefined references have fixed rules, text is never repeatedly joined,
and source-position scans occur only on a terminal error. The alloc-only build
retains a tree-map fallback for upstream no-std compatibility (O(log n) map
operations); all repository parser builds enable std, including WASM.

`packages/ooxml-common/src/depth.rs` applies resource policy only after this
validation succeeds. Its generated corpus compares errors with the unmodified
registry DOM parser, and native format tests verify optional-part fallback.
The 100,000-probe grammar test compares exact error variants, payloads and
positions with that oracle, alongside the namespace-value boundary. Adversarial
timing tests compare 4x input sizes for nested prefix shadowing, distinct prefixes,
wide attributes/declarations and long namespace URIs; each deep input must still
be rejected by the 256-frame resource ceiling after validation succeeds.
