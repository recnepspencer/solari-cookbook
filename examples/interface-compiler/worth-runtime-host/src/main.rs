const UNAVAILABLE_EXIT_CODE: i32 = 78;

fn main() -> ! {
    eprintln!("Worth Query Interface Compiler demo host: unavailable (fail closed).");
    eprintln!(
        "No supported executable or serialized worth-query-host transport is configured in this worktree."
    );
    eprintln!("No fallback state, marker-only binding, or local authority is started.");
    eprintln!(
        "See examples/interface-compiler/WORTH_BRIDGE_EVIDENCE.md for the blocking evidence."
    );
    std::process::exit(UNAVAILABLE_EXIT_CODE);
}
