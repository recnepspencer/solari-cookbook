use std::io::{self, BufRead, Write};

use interface_compiler_worth_runtime_host::protocol::{
    InterfaceCompilerHostInvalidRequestReason, InterfaceCompilerHostResponse,
    MAX_PROCESS_LINE_BYTES,
};
use interface_compiler_worth_runtime_host::{
    InterfaceCompilerWorthHost, INTERFACE_COMPILER_WORTH_PROTOCOL,
};

fn main() {
    if let Err(message) = validate_arguments() {
        eprintln!("{message}");
        std::process::exit(64);
    }

    let host_thread = std::thread::Builder::new()
        .name("interface-compiler-worth-host".to_string())
        .stack_size(16 * 1024 * 1024)
        .spawn(run_host)
        .expect("the WORTH host thread should start");
    if let Err(message) = host_thread
        .join()
        .unwrap_or_else(|_| Err("the WORTH host thread terminated unexpectedly".to_string()))
    {
        eprintln!("{message}");
        std::process::exit(70);
    }
}

fn run_host() -> Result<(), String> {
    let host = match InterfaceCompilerWorthHost::in_memory_demo() {
        Ok(host) => host,
        Err(error) => return Err(format!("Worth Query host failed to initialize: {error}")),
    };
    serve(host).map_err(|error| format!("Worth Query host process failed: {error}"))
}

fn validate_arguments() -> Result<(), String> {
    for argument in std::env::args().skip(1) {
        if argument == "--serve" {
            continue;
        }
        if argument == "--help" {
            println!("Reads newline-delimited Interface Compiler WORTH requests from stdin.");
            println!("Supported operations: read_application, start_execution, complete_execution, publish_domain_event, read_capability, read_active_replay");
            std::process::exit(0);
        }
        return Err(format!("unsupported argument: {argument}"));
    }
    Ok(())
}

fn serve(host: InterfaceCompilerWorthHost) -> io::Result<()> {
    let stdin = io::stdin();
    let mut input = stdin.lock();
    let stdout = io::stdout();
    let mut output = stdout.lock();
    let mut line = Vec::new();
    loop {
        let line_status = read_bounded_line(&mut input, &mut line)?;
        let response = match line_status {
            ProcessLineStatus::End => return Ok(()),
            ProcessLineStatus::TooLarge => InterfaceCompilerHostResponse::InvalidRequest {
                protocol: INTERFACE_COMPILER_WORTH_PROTOCOL,
                request_id: "unknown".to_string(),
                reason: InterfaceCompilerHostInvalidRequestReason::LineTooLarge,
                message: format!(
                    "request line exceeds the {} byte process bound",
                    MAX_PROCESS_LINE_BYTES
                ),
            },
            ProcessLineStatus::Ready => match std::str::from_utf8(&line) {
                Ok(line) => match serde_json::from_str(line.trim_end()) {
                    Ok(request) => {
                        interface_compiler_worth_runtime_host::handle_request(request, &host)
                    }
                    Err(error) => InterfaceCompilerHostResponse::InvalidRequest {
                        protocol: INTERFACE_COMPILER_WORTH_PROTOCOL,
                        request_id: "unknown".to_string(),
                        reason: InterfaceCompilerHostInvalidRequestReason::MalformedJson,
                        message: format!("request JSON is invalid: {error}"),
                    },
                },
                Err(error) => InterfaceCompilerHostResponse::InvalidRequest {
                    protocol: INTERFACE_COMPILER_WORTH_PROTOCOL,
                    request_id: "unknown".to_string(),
                    reason: InterfaceCompilerHostInvalidRequestReason::InvalidUtf8,
                    message: format!("request line is not valid UTF-8: {error}"),
                },
            },
        };
        serde_json::to_writer(&mut output, &response)
            .map_err(|error| io::Error::other(error.to_string()))?;
        output.write_all(b"\n")?;
        output.flush()?;
    }
}

enum ProcessLineStatus {
    End,
    Ready,
    TooLarge,
}

fn read_bounded_line(
    input: &mut impl BufRead,
    line: &mut Vec<u8>,
) -> io::Result<ProcessLineStatus> {
    line.clear();
    let mut too_large = false;
    loop {
        let buffer = input.fill_buf()?;
        if buffer.is_empty() {
            return Ok(if too_large {
                ProcessLineStatus::TooLarge
            } else if line.is_empty() {
                ProcessLineStatus::End
            } else {
                ProcessLineStatus::Ready
            });
        }
        let newline = buffer.iter().position(|byte| *byte == b'\n');
        let content_length = newline.unwrap_or(buffer.len());
        if !too_large {
            let available = MAX_PROCESS_LINE_BYTES.saturating_sub(line.len());
            if content_length > available {
                too_large = true;
            } else {
                line.extend_from_slice(&buffer[..content_length]);
            }
        }
        let consumed = newline.map_or(buffer.len(), |position| position + 1);
        input.consume(consumed);
        if newline.is_some() {
            return Ok(if too_large {
                ProcessLineStatus::TooLarge
            } else {
                ProcessLineStatus::Ready
            });
        }
    }
}
