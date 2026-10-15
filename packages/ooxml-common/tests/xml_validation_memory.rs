use std::alloc::{GlobalAlloc, Layout, System};
use std::sync::atomic::{AtomicUsize, Ordering};

struct CountingAllocator;
static LIVE_BYTES: AtomicUsize = AtomicUsize::new(0);
static PEAK_BYTES: AtomicUsize = AtomicUsize::new(0);

unsafe impl GlobalAlloc for CountingAllocator {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        let ptr = unsafe { System.alloc(layout) };
        if !ptr.is_null() {
            let prior = LIVE_BYTES.fetch_add(layout.size(), Ordering::Relaxed);
            PEAK_BYTES.fetch_max(prior + layout.size(), Ordering::Relaxed);
        }
        ptr
    }

    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        LIVE_BYTES.fetch_sub(layout.size(), Ordering::Relaxed);
        unsafe { System.dealloc(ptr, layout) };
    }

    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        let replacement = unsafe { System.realloc(ptr, layout, new_size) };
        if !replacement.is_null() {
            let prior = LIVE_BYTES.fetch_add(new_size, Ordering::Relaxed);
            PEAK_BYTES.fetch_max(prior + new_size, Ordering::Relaxed);
            LIVE_BYTES.fetch_sub(layout.size(), Ordering::Relaxed);
        }
        replacement
    }
}

#[global_allocator]
static ALLOCATOR: CountingAllocator = CountingAllocator;

#[test]
fn validation_discards_siblings_and_never_recurses_per_element() {
    // Input storage predates peak measurement. A retained DOM would allocate
    // many MiB here; streaming scratch stays independent of sibling count.
    let xml = format!(
        "<r>{}</r>",
        "<a xmlns:p='urn:p' p:x='&amp;'>text<![CDATA[ < > ]]><!-- < > --><?pi < > ?></a>"
            .repeat(80_000)
    );
    let before = LIVE_BYTES.load(Ordering::Relaxed);
    PEAK_BYTES.store(before, Ordering::Relaxed);
    assert_eq!(roxmltree::validate(&xml).unwrap(), 2);
    let scratch = PEAK_BYTES.load(Ordering::Relaxed) - before;
    assert!(
        scratch < 128 * 1024,
        "streaming scratch grew with siblings: {scratch}"
    );

    // A declaration at each nesting level must not copy every inherited
    // binding into every retained ancestor's scope (quadratic memory).
    let nested_namespaces = (0..4_000)
        .map(|i| format!("<a xmlns:p{i}='urn:{i}'>"))
        .collect::<String>()
        + &"</a>".repeat(4_000);
    let before = LIVE_BYTES.load(Ordering::Relaxed);
    PEAK_BYTES.store(before, Ordering::Relaxed);
    assert_eq!(roxmltree::validate(&nested_namespaces).unwrap(), 4_000);
    let scratch = PEAK_BYTES.load(Ordering::Relaxed) - before;
    assert!(
        scratch < 4 * 1024 * 1024,
        "namespace scratch grew quadratically: {scratch}"
    );

    // Both valid and malformed extreme nesting must survive a small stack.
    std::thread::Builder::new()
        .stack_size(128 * 1024)
        .spawn(|| {
            let deep = "<a>".repeat(50_000) + &"</a>".repeat(50_000);
            assert!(matches!(
                ooxml_common::depth::parse_guarded(&deep),
                Err(ooxml_common::depth::GuardedParseError::TooDeep)
            ));
            let malformed = format!("<r>{deep}<x a='1' a='2'/></r>");
            assert!(matches!(
                ooxml_common::depth::parse_guarded(&malformed),
                Err(ooxml_common::depth::GuardedParseError::Xml(_))
            ));
        })
        .unwrap()
        .join()
        .unwrap();
}
