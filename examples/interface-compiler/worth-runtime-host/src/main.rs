#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Persistence {
    ProcessLocalInMemory,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct DemoHostManifest {
    authority_boundary: &'static str,
    persistence: Persistence,
    node_binding: &'static str,
}

impl DemoHostManifest {
    const fn in_memory() -> Self {
        Self {
            authority_boundary: "worth-query-host::facade",
            persistence: Persistence::ProcessLocalInMemory,
            node_binding: "unavailable; TypeScript bridge must fail closed",
        }
    }
}

fn main() {
    let manifest = DemoHostManifest::in_memory();

    println!("Worth Query demo-runtime host manifest");
    println!("authority boundary: {}", manifest.authority_boundary);
    println!("backing: {:?}", manifest.persistence);
    println!("Node binding: {}", manifest.node_binding);
    println!("No HTTP, RPC, or process protocol is provided.");
    println!("No local lifecycle, replay, evidence, health, or projection authority is provided.");
    println!("Persistence across a full runtime restart is out of scope.");
}
