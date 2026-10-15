/**
 * Retained-layout validation policy.
 *
 * The layout engine defends its "retained layout is structured-clone-safe plain
 * data" contract in two layers:
 *
 * - FATAL checks, which always run and are NOT governed by this policy: the
 *   full `assertDocumentLayout` invariant suite on every finished layout
 *   (non-finite or negative geometry, invalid ownership, broken layout
 *   invariants — fatal per the layout engine's error contract in
 *   docs/docx-layout-engine-redesign.md, with no test/production split), plus
 *   the backstops fused into the unconditional clone/freeze walks in
 *   `plain-data.ts` and `invariants.ts` (non-cloneable values, foreign
 *   prototypes, non-finite numbers).
 * - PATH-PRECISE diagnostics, which this policy gates: the separate
 *   `assertPlainData` pre-pass that walks the graph a second time purely to
 *   report the exact property path of a violation. It is redundant with the
 *   fused backstops — the same violation is still detected and thrown without
 *   it, just with a terser message — so it is a development-time nicety, not a
 *   safety layer.
 *
 * `snapshotPlainData` runs on every block accepted during pagination, re-paid
 * on every convergence pass, so the duplicate pre-pass walk is a real cost on
 * big documents. The policy is:
 *
 * - OFF in every production realm. Tests may mock this internal policy to
 *   exercise the additional reports; runtime environment variables never alter
 *   the layout contract or add a second traversal.
 *
 * Freezing is NOT part of this policy and always runs: retained-layout
 * immutability is load-bearing (the identity WeakSets here and in
 * `invariants.ts`, the `DeepReadonly` contract the variant store hands out, and
 * the assumption that a cached layout cannot be mutated by a consumer).
 */

/** Production omits only the redundant path-precise pre-pass. */
export function documentLayoutValidationEnabled(): boolean {
  return false;
}
