# CLI & Tooling

Lust includes a full suite of developer tooling: the unified CLI runner, multi-backend compiler, bytecode disassembler, C-ABI library generator, package manager, stub generator, and language server.

---

## The Lust CLI

The `lust` executable is the primary entry point for executing scripts, compiling native libraries, and inspecting compilation output:

```text
USAGE:
    lust <script.lust> [--jit=cranelift|auto|off]       Run a Lust script (default auto backend)
    lust run <file> --backend [vm|mir|cranelift|rust|zig|auto] [--strict]
                                                        Run script with specified backend
    lust build <file> --backend [rust|cranelift-aot|zig|mir-zig|mir] [options] [-o <out>]
                                                        Build native binary, object file, Rust crate, or C-ABI library
    lust --disassemble <script.lust>                    Show bytecode disassembly (-d)
    lust --mir <script.lust>                            Run script using Lust MIR pipeline
    lust --strict-mir <script.lust>                     Run with strict MIR (reject fallback/unsupported)
    lust --no-gc <script.lust>                          Run script with cycle collector GC disabled
    lust bindgen <entry.lust>                           Generate checked Rust bindings for @bindgen functions
    lust pkg <command> [options]                        Manage Lust packages
    lust --help, -h                                     Show help message
    lust --version, -v                                  Show version information
```

### Running Scripts with Backends (`lust run` & `--jit`)

You can select the execution backend using `--backend` (or control JIT selection with `--jit=cranelift|auto|off`):

- **`vm`** *(or `--jit=off`)*: Portable register-based Bytecode Virtual Machine with zero native codegen dependencies.
- **`mir`**: Runs through the Lust MIR interpreter pipeline.
- **`cranelift`**: Low-latency Just-In-Time (JIT) machine code compilation through the Lust MIR pipeline using Cranelift. The legacy Dynasm backend has been fully retired.
- **`rust`**: Compiles and executes via the Rust AOT pipeline backed by the `#![no_std]` `lust-aot-rt` runtime crate.
- **`zig`**: Direct Ahead-Of-Time compilation via Zig to native machine code.
- **`auto`** *(default)*: Uses Cranelift JIT where available with automatic fallback to the Bytecode VM.

```bash
# Run with the portable bytecode VM (JIT explicitly disabled)
lust main.lust --jit=off
lust run main.lust --backend vm

# Run with Cranelift JIT in strict MIR mode
lust run main.lust --backend cranelift --strict

# Run with Rust AOT or Zig AOT
lust run main.lust --backend rust
lust run main.lust --backend zig
```

### Ahead-Of-Time Builds (`lust build`)

`lust build` supports three native AOT backends tailored to different deployment profiles:

#### 1. Rust AOT Backend (`--backend rust`)

Compiles Lust programs through MIR, SROA, escape analysis, and CFG structuring into Rust source linked against the zero-dependency `#![no_std] + alloc` runtime crate **`lust-aot-rt`**. Supports native executables, cross-compilation (WASI and bare-metal MCUs), Cargo crate emission, ThinLTO, and Profile-Guided Optimization (PGO):

```bash
# Build a standalone native binary with ThinLTO
lust build app.lust --backend rust --lto=thin -o app

# Emit a standalone Cargo library crate (Cargo.toml + src/lib.rs depending on lust-aot-rt)
lust build lib.lust --backend rust --emit=rust-crate -o out_crate

# Link an external Rust crate with Zero-FFI rlib + ThinLTO interop
lust build app.lust --backend rust --link-crate ./my_native_crate --lto=thin -o app

# Emit #![no_std] code with the StaticSlabAllocator<65536> preamble for embedded targets
lust build firmware.lust --backend rust --no-std --target thumbv7em-none-eabihf --emit-rs -o firmware.rs

# Enable gas metering (none, loop-chunked, exact) and a gas budget
lust build job.lust --backend rust --gas-metering loop-chunked --gas-limit 1000000 -o job

# Profile-Guided Optimization (manual two-stage, sample-based, or automated `--pgo-auto`)
lust build app.lust --backend rust --pgo-generate=/tmp/pgo-data -o app_prof
./app_prof
lust build app.lust --backend rust --pgo-use=/tmp/merged.profdata -o app_opt
lust build app.lust --backend rust --pgo-sample-use=/tmp/sample.prof -o app_sample_opt
lust build app.lust --backend rust --pgo-auto --pgo-workload-args "" --lto=auto -o app_auto_opt
```

Key `--backend rust` options:
- `--emit=rust-crate` (or `--emit-rust-crate`) — Generates a self-contained Cargo library crate (`Cargo.toml` + `src/lib.rs`) depending on `lust-aot-rt`.
- `--emit-rs` — Emits generated Rust source without invoking `rustc`.
- `--link-crate <dir|rlib>` — Links an external Rust crate directly via Zero-FFI `.rlib` + ThinLTO.
- `--lto=<off|thin|auto>` — Controls ThinLTO across the emitted module, `lust-aot-rt`, and linked crates (`auto` applies a deterministic heuristic for linked crates / PGO builds).
- `--pgo-generate[=<dir>]`, `--pgo-use=<profdata>`, `--pgo-sample-use=<profile>` — Manual instrumented and sample-based PGO pipelines.
- `--pgo-auto` with `--pgo-workload-args <args>` (use `""` for no args) or `--pgo-workload-arg <arg>` — Opt-in two-stage automated PGO pipeline (instrumented build -> workload run -> `llvm-profdata` merge -> optimized rebuild in isolated temp paths, with fail-closed error propagation; verified `-11.5%` on `BENCH-NG-13`: `6.863 ms -> 6.072 ms` with `--lto=auto`).
- `--gas-metering <none|loop-chunked|exact>` & `--gas-limit <units>` — Deterministic execution gas metering.
- `--no-std`, `--target <triple>`, `--cache-dir <dir>` — Cross-target and bare-metal builds.

#### 2. Cranelift Object AOT Backend (`--backend cranelift-aot`)

Compiles Lust MIR directly to native object files or linked executables using `cranelift-object` (no `rustc` or `zig` invocation required), including native `__mir_struct_decode_into:*` lowering with `SEC-02` memory budget enforcement (verified across all 15/15 Suite v2 workloads, achieving `4.46×` speedup on `BENCH-NG-13`: `84.132 ms -> 18.848 ms`, alongside `2.01×` on Cranelift JIT `54.765 ms -> 27.302 ms`, `1.67×` faster than LuaJIT `45.718 ms`). This backend is opt-in and requires building `lust` with `--features cranelift-aot`:

```bash
# Build lust with Cranelift Object AOT enabled
cargo build --release --features cranelift-aot

# Emit a relocatable native object file (triggered by .o or .obj extension)
lust build kernel.lust --backend cranelift-aot -o kernel.o

# Cross-emit an object file for a 64-bit target triple
lust build kernel.lust --backend cranelift-aot --target x86_64-apple-darwin -o kernel_x86_64.o

# Auto-link into a runnable native executable via `cc -llust` (any extension other than .o/.obj)
lust build app.lust --backend cranelift-aot -o app
./app
```

Supported 64-bit object target architectures for `--backend cranelift-aot`: **`aarch64`**, **`x86_64`**, **`riscv64`** (and `s390x`). When `-o` does not end in `.o` or `.obj`, the CLI emits a temporary object file, synthesizes a minimal C entry shim if needed, and links it against `liblust` using the host `cc` linker.

#### 3. Zig AOT & C-ABI Libraries (`--backend zig`)

Lust can compile scripts into standalone native binaries, C-compatible shared/static libraries, and C headers for embedding into C, C++, Rust, Zig, Go, or Python applications:

```bash
# 1. Compile as a C-compatible shared library (.dylib / .so / .dll)
lust build policy.lust --backend zig --cdylib -o libpolicy.dylib

# 2. Compile as a static archive (.a / .lib)
lust build engine.lust --backend zig --staticlib -o libengine.a

# 3. Generate clean, portable C-ABI header files
lust build policy.lust --backend zig --cdylib --emit-h -o libpolicy.dylib

# 4. Limit runtime memory usage with bounded allocator (e.g. 64MB or 512KB)
lust build sandbox.lust --backend zig --cdylib --max-memory 64MB -o libsandbox.dylib
```

---

## WebAssembly & WASI (Preview 1 / Preview 2)

Lust targets WebAssembly **WASI Preview 1** (`wasm32-wasip1`) and **WASI Preview 2** (`wasm32-wasip2`) via the **`--backend rust` (`lust-aot-rt`)** compilation path together with the workspace **`lust-wasi-runner`** harness (embedded Wasmtime 50, supporting both core WASI P1 modules and WASI P2 components).

> [!NOTE]
> The sandboxed WASI guest execution path is **`lust-aot-rt` + `lust-wasi-runner`** (compiling Lust scripts to `.wasm` via `--backend rust --target wasm32-wasip1` or `wasm32-wasip2`). In addition, the root `lust-rs` crate compiles cleanly for `wasm32-wasip1 --no-default-features --features std` (`0` errors) and as a `#![no_std] + alloc` `rlib` on both host and ARM Cortex-M (`thumbv7em-none-eabihf`, `0` errors, zero `#[panic_handler]`/`#[global_allocator]` in `rlib`).

```bash
# 1. Compile a Lust script to a WASI Preview 1 or Preview 2 artifact
lust build app.lust --backend rust --target wasm32-wasip1 -o app_p1.wasm
lust build app.lust --backend rust --target wasm32-wasip2 -o app_p2.wasm

# 2. Execute in a capability-scoped Wasmtime sandbox with lust-wasi-runner
lust-wasi-runner \
    --fuel 1000000 \
    --timeout-ms 500 \
    --env APP_MODE=sandbox \
    --dir-ro ./fixtures::/fixtures \
    --deny-stdio \
    app_p2.wasm
```

`lust-wasi-runner` CLI options:

| Flag | Description |
|---|---|
| `--fuel <N>` | Caps WebAssembly instruction fuel consumption via Wasmtime fuel metering. |
| `--timeout-ms <MS>` | Enforces a wall-clock deadline via Wasmtime epoch interruption. |
| `--env <K=V>` | Injects an explicit allowlisted environment variable into the WASI guest. |
| `--dir <HOST::GUEST>` | Preopens a read-write host directory mapped to the guest path. |
| `--dir-ro <HOST::GUEST>` | Preopens a read-only host directory mapped to the guest path. |
| `--deny-stdio` | Disables inheriting host `stdin`/`stdout`/`stderr` in the guest context. |

### Zero-GC Execution Mode (`--no-gc`)

In latency-critical, real-time, or deterministic workloads, you can completely bypass the cycle-collecting garbage collector:

```bash
lust --no-gc server.lust
# Or via environment variable:
LUST_NO_GC=1 lust server.lust
```

### Bytecode Disassembly

To inspect the generated bytecode instructions, constant pools, and register allocations:

```bash
lust --disassemble main.lust
# or use the short flag:
lust -d main.lust
```

---

## Package Management (`lust pkg`)

The Lust CLI includes an integrated package manager for distributing, installing, and managing reusable libraries and native extensions:

| Command | Description |
|---|---|
| `lust pkg add <name[@version]>` | Add a dependency to the project manifest. |
| `lust pkg remove <name>` | Remove a dependency. |
| `lust pkg sync` | Download and synchronize dependencies listed in `lust-config.toml`. |
| `lust pkg login` | Authenticate with the package registry using an API token. |
| `lust pkg logout` | Remove stored registry authentication credentials. |
| `lust pkg publish` | Package and upload the current library to the registry. |

### Adding a Package

```bash
lust pkg add json@1.2.0
lust pkg add my-utils --registry https://packages.lust-lang.dev
```

### Publishing a Package

```bash
lust pkg publish --manifest-path ./lust-config.toml --readme ./README.md
```

---

## Project Configuration: `lust-config.toml`

A `lust-config.toml` file in your project root configures compiler flags, standard library modules, and dependencies.

### Full Configuration Reference

```toml
[settings]
# List of optional standard library modules to enable
stdlib_modules = ["io", "os"]

# Enable or disable Cranelift JIT compilation (default: true)
jit = true

# Memory optimization options for embedded environments (e.g. ESP32, no_std)
low_memory_mode = false
minimal_runtime_types = false

[dependencies]
# Native Rust extension crate
lust-double = { path = "extensions/double", kind = "rust" }

# Lua 5.1 C dynamic library
socket = { path = "/usr/local/lib/lua/5.1/socket/core.so", kind = "lua" }

# Registry Lust package
json = { version = "1.0.0" }
```

---

## Generating Extern Stubs (`--dump-externs`)

When integrating native Rust extensions or Lua C libraries, you can generate typed Lust extern declarations automatically:

```bash
lust --dump-externs main.lust
```

The CLI compiles each extension declared in `lust-config.toml`, inspects its exported types and functions, and writes typed `.lust` stub files under the `externs/` directory. This allows the Lust typechecker to validate native calls at compile time.

---

## IDE & Editor Support

### Language Server (`lust-analyzer`)

Install the official language server:

```bash
cargo install lust-analyzer
```

`lust-analyzer` implements the Language Server Protocol (LSP), providing (`54/54` tests PASS):
- Real-time syntax, type, and lifetime (`E4G001`–`E4G006`) diagnostics.
- Workspace symbol indexing, go-to-definition, hover, and cross-file autocompletion across functions, structs, enums, traits, `schema` declarations, `type` aliases, `test`, and `suite` blocks.
- Range-accurate, semantics-preserving `textDocument/codeAction` quick-fixes strictly backed by compiler diagnostics.

### Tree-Sitter (`tree-sitter-lust`) & Zed Extension (`zed-extension`)

`tree-sitter-lust` and `zed-extension` track full Waves 5–18 language syntax and highlighting parity (effects, `defer`/`errdefer`/`scoped`, `schema`, `type` aliases, `typeof`, regex literals, pipe `|>`, borrowed views `&T`/`&mut T`, `test`/`suite`, `#` comments, and Lua 5.4 operators), verified across `102/102` repository examples with `0` `ERROR` parse nodes for Zed, Neovim, Helix, Emacs, and VS Code.
