# Deterministic Simulation Testing (DST)

Lust is engineered for mission-critical embedding, deterministic execution, and formal safety. To guarantee that complex interactions between structured concurrency (fibers, scopes, cancellation masks), reactive streams (Rx), first-class algebraic effects, and tracing JIT compilation remain bug-free, Lust incorporates a comprehensive **Deterministic Simulation Testing (DST)** subsystem inspired by the testing methodologies of FoundationDB, TigerBeetle, and Antithesis.

DST replaces non-deterministic operating system primitives (physical wall clocks, hardware timers, OS threads, random entropy, and host filesystem I/O) with pure, controllable, seed-driven discrete-event simulations. Under DST, entire multi-fiber distributed workflows, network/disk faults, and preemptive execution races execute inside an in-memory virtual sandbox where **any failure is 100% reproducible bit-for-bit**.

---

## 1. Introduction & The DRS 100/100 Benchmark

### 1.1 The Challenge of Concurrency Heisenbugs

Traditional integration tests rely on real operating system threads and wall-clock sleeps (`std::thread::sleep`). These tests suffer from three fatal flaws:
1. **Flakiness & Race Conditions:** Thread scheduling depends on OS load and hardware interrupts. Rare race conditions ("Heisenbugs") may appear once in 100,000 runs and vanish when run under a debugger.
2. **Slow Wall-Clock Execution:** Testing timeouts (e.g. testing a 24-hour token expiry or 30-second backoff) requires either waiting real time or introducing mocking hacks that drift from production semantics.
3. **Non-Reproducibility:** When a CI run fails, reproducing the exact interleaving of operations that triggered the bug is virtually impossible.

DST solves this by running the entire runtime inside a single-threaded **Discrete-Event Simulation (DES)** loop driven by a pseudo-random number generator (PRNG) initialized with an explicit 64-bit seed:

$$\text{Seed} + \text{Inputs} \implies \text{100\% Identical Execution Trace}$$

### 1.2 The DST-Readiness Score (DRS)

Lust measures its simulation maturity using the formal **DST-Readiness Score (DRS)** rubric (developed under the `$mb3-dst` specification). DRS assesses 8 fundamental dimensions of determinism ($D1$–$D8$) and thread/process state containment ($TP$):

$$\text{DRS} = 100 - (D3_{FAIL} \times 30) - (D1_{FAIL} \times 15) - (D2_{FAIL} \times 15) - (D8_{VACUOUS} \times 10) - (D7_{UNINSTR} \times 5) - (TP_{hazards} \times 5)$$

```
                                 LUST DRS PROGRESSION
 100 ┼───────────────────────────────────────────────────● 100 (DST-READY)
     │                                                   │
  80 ┼───────────────────────────────●───────────────────┤ 85 (Core Seams)
     │                               │
  60 ┼───────────────●───────────────┤ 55
     │               │
  40 ┼───●───────────┤ 40
     │   │
  20 ┼───┴───────────┴───────────────┴───────────────────┘ 20 (DST-HOSTILE)
     Baseline     Phase 1         Phase 3             Phases 5–6
```

| Dimension | Subsystem | Penalty Weight | Status in Lust | Validation Test |
|---|---|:---:|:---:|---|
| **$D1$** | **Clocks & Timers** | 15 | **PASS (0)** | `tests/dst_clock_determinism.rs`, `tests/dst_stdlib_time.rs` |
| **$D2$** | **Entropy & PRNG** | 15 | **PASS (0)** | `tests/dst_state_isolation.rs` |
| **$D3$** | **Storage & VFS** | 30 | **PASS (0)** | `tests/dst_vfs_contract.rs`, `tests/dst_vfs_bypass_negative.rs` |
| **$D4$** | **DES & Preemption** | 0* | **PASS (0)** | `tests/dst_fiber_quantum.rs`, `tests/dst_fiber_interleaving.rs` |
| **$TP$** | **MIR & State Containment**| 5 | **PASS (0)** | `tests/dst_mir_isolation.rs`, `tests/dst_tls_reentrancy.rs` |
| **$D7$** | **Invariant Oracles** | 5 | **PASS (0)** | `tests/dst_invariants_teeth.rs` (18 formal teeth tests) |
| **$D8$** | **Faults, Mutants & Replay**| 10 | **PASS (0)** | `tests/dst_mutation_gate.rs`, `tests/dst_replay_bundle.rs` |
| **TOTAL** | **Full Simulation Readiness** | — | **100 / 100** | **`DST-READY (Full Capability Confirmed)`** |

*\* $D4$ is an architectural prerequisite for multi-fiber exploration and carries 0 penalty weight in the baseline formula.*

---

## 2. State & Environmental Isolation Architecture

For deterministic replay to hold, **every source of external entropy and non-determinism must be mediated by the runtime**.

```
+---------------------------------------------------------------------------------+
|                                 LUST RUNTIME (VM)                               |
+---------------------------------------------------------------------------------+
|  +--------------------+  +--------------------+  +---------------------------+  |
|  |     LustClock      |  |       VM.rng       |  |        MirContext         |  |
|  | (Wall / Monotonic /|  | (StdRng / Pcg64    |  | (GAS, MEMORY, STATUS,     |  |
|  |    TimerQueue)     |  |  Per-Instance)     |  |  CURRENT_MIR_STACK)       |  |
|  +--------------------+  +--------------------+  +---------------------------+  |
|  +--------------------+  +--------------------+  +---------------------------+  |
|  |    MemFs (VFS)     |  |     VirtualEnv     |  |      VirtualConsole       |  |
|  | (12 POSIX Methods, |  | (Isolated EnvVars) |  | (Captured Stdin / Stdout/ |  |
|  |   /workspace Root) |  |                    |  |   Stderr Buffers)         |  |
|  +--------------------+  +--------------------+  +---------------------------+  |
+---------------------------------------------------------------------------------+
                                      │
                         [Clippy Compile-Time Gate]
                         [OsFs DirectHostFsBypassPanic]
                                      ▼
                        HOST OPERATING SYSTEM / DISK
                                 (BLOCKED)
```

### 2.1 Virtual Clocks & Timers (`src/sim/clock.rs`)

Lust strictly segregates calendar time from deadline timers through three traits:

1. **`WallClock`**: Provides Unix epoch nanoseconds (`now_epoch_nanos()`). Used by `os.time()` and `os.date()`. In simulation, this advances deterministically without drift.
2. **`MonotonicClock`**: Strictly non-decreasing nanosecond counter (`now_nanos()`) used for task deadlines, retry delays, and scheduler timeouts.
3. **`TimerControl`**: Management interface accessible to the test harness (`advance(duration)`, `now_nanos()`, `next_deadline()`).

```rust
pub struct LustClock {
    wall: Arc<dyn WallClock>,
    monotonic: Arc<dyn MonotonicClock>,
    control: Option<Arc<dyn TimerControl>>,
    timers: TimerQueue,
}
```

#### Non-Blocking Virtual Sleep
In standard mode, `os.sleep(ms)` would block an OS thread. In simulated mode:
1. The VM executes `os.sleep` and translates it into `NativeCallResult::YieldTimer(TimerId)`.
2. The executing fiber yields with `TaskState::Yielded(YieldReason::Timer(tid))`.
3. The fiber is registered in `TimerQueue` with its exact deadline and generation token.
4. The simulation scheduler instantly advances virtual time to `next_deadline()` in $0\text{ ms}$ of real time.
5. A scenario sleeping for **24 virtual hours** executes in **under 100 simulation steps (< 15 ms wall-clock time)**.

### 2.2 Localized Entropy & Seeded PRNG (`src/vm/stdlib.rs`)

Global static RNGs (`static RNG: Mutex<StdRng>`) are forbidden in Lust. All pseudo-random generation is encapsulated within the `VM` instance:

```rust
pub struct VM {
    // Isolated PRNG instance per VM
    pub rng: core::cell::RefCell<Box<dyn rand::Rng + Send>>,
    // ...
}
```

Constructing `VM::with_seed(seed)` or `MinimalSimScheduler::with_seed(seed)` initializes the generator with a deterministic seed. Calls to `math.random()` and `math.randomseed(seed)` in Lust mutate only the local VM generator. Multiple concurrent VMs executing on the same OS thread exhibit zero cross-talk.

### 2.3 MIR Context & Process State Containment (`src/mir/runtime_helpers.rs`)

During JIT and MIR optimization, execution accounting requires rapid access to gas counters and memory budgets. Instead of global static atomics, Lust stores these metrics inside `MirContext`:

```rust
pub struct MirContext {
    pub gas_remaining: AtomicI64,
    pub memory_used: AtomicI64,
    pub last_status: AtomicI64,
    pub max_memory_limit: AtomicI64,
}
```

To support re-entrant FFI calls and multi-VM concurrency on a single OS thread, active contexts are managed through a thread-local RAII stack: `CURRENT_MIR_STACK`. Entering a context pushes a guard:

```rust
let _guard = lust::mir::enter_mir_context(&my_context);
// All MIR helper calls on this thread now atomically update my_context
```

### 2.4 Compile-Time & Runtime Host I/O Gates

To guarantee that code under test cannot bypass simulation seams, Lust enforces a dual defense:

#### 1. Compile-Time Blacklist Gate (`clippy.toml`)
All direct references to `std::fs` methods and types are denied at compile time across all targets:

```toml
# clippy.toml
disallowed-methods = [
    "std::fs::read",
    "std::fs::read_to_string",
    "std::fs::write",
    "std::fs::create_dir_all",
    "std::fs::remove_file",
    "std::fs::rename",
    "std::path::Path::exists",
    "std::path::Path::canonicalize",
    "std::fs::File::open",
    "std::fs::File::create",
    # ... all 38 std::fs method variants
]
disallowed-types = [
    "std::fs::File",
    "std::fs::OpenOptions",
    "std::fs::Metadata",
    "std::fs::DirEntry"
]
```

Verification command:
```bash
cargo clippy --all-targets -- -D clippy::disallowed_methods -D clippy::disallowed_types
```
*(Result: 0 errors across entire codebase).*

#### 2. Runtime Facade Guard (`src/vfs/os_fs.rs`)
The only file permitted to touch host I/O is `os_fs.rs`. Before every operation, `OsFs` verifies whether the simulation mode is active (via `sim::is_simulated_mode()` or `clock.is_simulated()`). If host I/O is attempted within simulation, the guard triggers a fail-closed panic:

```rust
if self.is_simulated() {
    std::panic::panic_any(DirectHostFsBypassPanic);
}
```

---

## 3. In-Memory Virtual File System (MemFs & VFS)

Filesystem operations in Lust are abstracted through the `VirtualFileSystem` trait (`src/vfs/mod.rs`), defining **exactly 12 core methods**:

```rust
pub trait VirtualFileSystem: Send + Sync {
    fn read(&self, path: &Path) -> Result<Vec<u8>, std::io::Error>;
    fn read_to_string(&self, path: &Path) -> Result<String, std::io::Error>;
    fn write(&self, path: &Path, contents: &[u8]) -> Result<(), std::io::Error>;
    fn append(&self, path: &Path, contents: &[u8]) -> Result<(), std::io::Error>;
    fn create_dir_all(&self, path: &Path) -> Result<(), std::io::Error>;
    fn remove_file(&self, path: &Path) -> Result<(), std::io::Error>;
    fn remove_dir_all(&self, path: &Path) -> Result<(), std::io::Error>;
    fn rename(&self, from: &Path, to: &Path) -> Result<(), std::io::Error>;
    fn read_dir(&self, path: &Path) -> Result<Vec<PathBuf>, std::io::Error>;
    fn metadata(&self, path: &Path) -> Result<VfsMetadata, std::io::Error>;
    fn canonicalize(&self, path: &Path) -> Result<PathBuf, std::io::Error>;
    fn exists(&self, path: &Path) -> bool;
}
```

### 3.1 Path Normalization & The POSIX Sandbox (`/workspace`)

In simulated mode (`MemFs`), the entire filesystem lives in memory. All paths are normalized via `normalize_virtual_path`:
- The root of the virtual filesystem is strictly pinned to `/workspace`.
- Relative paths (`config.json`, `./scripts/main.lust`) are anchored to `/workspace/...`.
- `.` and `..` segments are resolved purely in memory.
- **Directory Traversal Protection:** Escaping above the sandbox root is strictly prohibited. Traversal attempts such as `../../etc/passwd` or `/workspace/../../file.txt` are safely clamped to `/workspace/file.txt`.
- Nested `workspace` directory components (e.g. `/workspace/workspace/app.lust`) are accurately preserved without collapsing.

### 3.2 Deterministic Directory Traversal
Unlike physical filesystems (where `readdir` order depends on OS inode allocation and filesystem b-trees), `MemFs::read_dir` **guarantees strictly lexicographical sorting** of returned paths. This prevents hash-iteration nondeterminism from affecting module loaders or batch processing scripts.

### 3.3 State Snapshot & Bitwise Restoration
`MemFs` provides instant atomic snapshots:
```rust
let snapshot: Vec<(PathBuf, Vec<u8>)> = mem_fs.snapshot();
// ... execute destructive file modifications ...
mem_fs.restore_snapshot(&snapshot);
```
This capability allows the Replay Bundle engine to package the entire filesystem alongside the event trace.

---

## 4. Discrete-Event Fiber Scheduler (DES) & Fuel Preemption

Lust models concurrency through cooperative and preemptive green threads (**Fibers**). Under production execution, fibers run cooperatively or leverage Cranelift JIT compilation. Under DST, the runtime switches to the **Discrete-Event Simulation (DES)** engine (`src/sim/scheduler.rs`).

```
+---------------------------------------------------------------------------------+
|                       PreemptiveExplorationScheduler                            |
+---------------------------------------------------------------------------------+
|                                                                                 |
|   Ready Queue: [ Fiber #3, Fiber #1, Fiber #2 ]                                 |
|                      │                                                          |
|                      ▼ (PRNG Fisher-Yates Shuffle)                              |
|   Selected Fiber:  Fiber #1                                                     |
|   Random Quantum:  3 instructions (1 ..= max_quantum)                           |
|                      │                                                          |
|                      ▼                                                          |
|   Execute 3 bytecodes ──► [Gas Consumed] ──► [INV-BUDGET-01 Checked]            |
|                      │                                                          |
|   Fuel Exhausted? ───► FiberContinuation Captured (CallStack, IP, Registers)     |
|                      │                                                          |
|                      ▼                                                          |
|   Re-enqueue Fiber #1 in Ready Queue or TimerQueue                              |
+---------------------------------------------------------------------------------+
```

### 4.1 Fuel-Based Preemption & Continuation Capture

In order to explore race conditions at the instruction level, Lust introduces **fuel-based quantum preemption**:
1. When running under the simulation scheduler, the VM sets `quantum_fuel = Some(quantum)`.
2. JIT execution is bypassed (`effective_jit_enabled() == false`) whenever fuel is active, ensuring every single bytecode instruction is intercepted.
3. Every executed opcode decrements `quantum_fuel`.
4. When `quantum_fuel == 0`, the VM suspends execution and serializes a complete, resumable `FiberContinuation`:

```rust
pub struct FiberContinuation {
    pub call_stack: Vec<Box<CallFrame>>,      // Activation frames with local registers
    pub ip: usize,                            // Precise instruction pointer
    pub pending_return_value: Option<Value>,  // Return register destination
    pub pending_return_dest: Option<Register>,
    pub yield_dest: Option<Register>,
    pub fiber_context: FiberContext,          // Interrupt masks, pending cancels, scope_id
    pub upvalues: Vec<Rc<RefCell<Upvalue>>>,  // Open/closed closure captures
}
```

### 4.2 `PreemptiveExplorationScheduler`

> 📂 **Runnable example:** [`examples/simulation/01_deterministic_scheduler.rs`](https://github.com/ArchangelJTW/lust-lang/blob/master/examples/simulation/01_deterministic_scheduler.rs)\
> 💻 *Compiler repository file:* `examples/simulation/01_deterministic_scheduler.rs`

The exploration scheduler orchestrates multi-fiber workloads:
- **Ready Queue Shuffle:** Before selecting the next task, the ready queue is deterministically shuffled using Fisher-Yates driven by `StdRng` / `Pcg64`.
- **Randomized Quantum:** Each step picks a quantum $Q \in [1, \text{max\\_quantum}]$ instructions.
- **Zero-Wait Time Jumping:** If the ready queue is empty, the scheduler immediately advances virtual time to the next pending timer deadline (`advance_to_next_deadline()`), waking expired timers and placing fibers back in the ready queue.

### 4.3 Deterministic Race Condition Detection

Consider two fibers performing a non-atomic Read-Modify-Write operation on a shared array counter:

```lust
-- Fiber A and Fiber B both run:
local count = shared_array[0]
count = count + 1
shared_array[0] = count
```

- In sequential execution (or cooperative scheduling), $5 + 5$ increments always equals $10$.
- Under `PreemptiveExplorationScheduler`, preemption strikes between `GetIndex` and `SetIndex`, triggering a classic **lost update**.
- In `tests/dst_fiber_interleaving.rs`, the scheduler **guarantees detection of the race condition within 500 seeds**, records the exact failing seed, and re-running with that seed **reproduces the identical lost update and trace bit-for-bit**.

---

## 5. Invariant Engine & Fault Injection

Testing is vacuous without rigorous oracles. Lust implements a dual-clause invariant engine providing both **Safety** ("bad things never happen") and **Liveness** ("good things eventually happen"):

> 📂 **Runnable example:** [`examples/simulation/02_fault_injection_vfs.rs`](https://github.com/ArchangelJTW/lust-lang/blob/master/examples/simulation/02_fault_injection_vfs.rs)\
> 💻 *Compiler repository file:* `examples/simulation/02_fault_injection_vfs.rs`

```
+------------------------------------------------------------------------------------+
|                                HIGH-TEETH INVARIANTS                               |
+----------------------+-----------------------------+-------------------------------+
| Oracle ID            | Safety Invariant            | Liveness Invariant            |
+----------------------+-----------------------------+-------------------------------+
| INV-FIBER-01         | Exactly-Once: Each resource | Completion: All registered    |
| (LIFO Finalization)  | finalized strictly once in  | finalizers execute before     |
|                      | reverse (LIFO) order.       | scope closes.                 |
+----------------------+-----------------------------+-------------------------------+
| INV-FIBER-02         | Preserved Delivery: Pending | Safe Point Bound: Delivery    |
| (Masking Safe Point) | cancel never lost while     | occurs at exactly N=1 opcode  |
|                      | interrupt mask is active.   | after unmasking.              |
+----------------------+-----------------------------+-------------------------------+
| INV-FIBER-03         | Full Quiescence: Scope cannot| Termination Bound: Children   |
| (Teardown Quiescence)| close while children are in | must terminate within         |
|                      | active or yielded states.   | max_execution_steps limit.    |
+----------------------+-----------------------------+-------------------------------+
| INV-RX-01            | Zero-Leak: No callback      | Active Rejection: Subscribing |
| (Rx Quiescence)      | writes to sink after join() | to a closed scope is rejected |
|                      | commits.                    | immediately.                  |
+----------------------+-----------------------------+-------------------------------+
| INV-BUDGET-01        | Progress Accounting: Gas    | Non-Stall: Gas strictly       |
| (Gas Monotonicity)   | increases monotonically on  | increases with instruction    |
|                      | instruction execution.      | progress.                     |
+----------------------+-----------------------------+-------------------------------+
```

### 5.1 Independent StepCounter Watchdog
To prevent bugs in user scripts or mutated bytecode from causing infinite simulation loops, the scheduler tracks physical loop iterations via `StepCounterWatchdog`. If `step_counter >= max_execution_steps`, the simulation halts immediately with `EXHAUSTION_LIMIT_REACHED`.

### 5.2 Deterministic Fault Injection (`FaultConfiguration`)

The fault injection engine (`src/sim/fault.rs`) injects deterministic failures into the virtual environment based on pseudo-random seeds:

1. **VFS I/O Faults (`FaultInjectedVfs`)**: Intercepts any of the 12 VFS methods matching regex path patterns (e.g., inject `ErrorKind::PermissionDenied` on `*.lock` or `ErrorKind::UnexpectedEof` on read).
2. **Memory Exhaustion (OOM)**: Simulates allocation caps (`MaxAllocBytes`), step-based OOM triggers, or probabilistic allocation failures.
3. **Spontaneous Interrupts**: Injects `InterruptReason::Cancelled` into specific fibers at predefined simulation step numbers to stress structured teardown paths.

```rust
let config = Arc::new(Mutex::new(
    FaultConfiguration::new(42)
        .with_vfs_read_error("database.json", ErrorKind::BrokenPipe)
        .with_vfs_write_error("logs/", ErrorKind::DiskFull)
));
let faulted_vfs = FaultInjectedVfs::new(mem_fs, config);
```

### 5.3 The Mutation Acceptance Gate (M1–M3)

A test suite cannot be trusted if it cannot detect real bugs. Lust mandates a **Mutation Acceptance Gate** (`scripts/run_dst_mutation_gate.sh`):

$$\text{Baseline GREEN} \longrightarrow \text{Inject Mutation} \longrightarrow \text{Confirm Execution Witness} \longrightarrow \text{Specific Oracle RED}$$

- **Mutant M1 (Gas Accounting Bypass):** Injects code in `src/vm/execution.rs` omitting gas deduction.
  - *Oracle Triggered:* `INV-BUDGET-01` fails immediately (instruction executed with zero gas consumption).
- **Mutant M2 (Panic Finalizer Skip):** Omits LIFO resource finalization when a task fails.
  - *Oracle Triggered:* `INV-FIBER-01-EXACTLY-ONCE` fails (registered cleanup actions != executed cleanup actions).
- **Mutant M3 (Rx Quiescence Race):** Bypasses closed-scope admission check in reactive streams.
  - *Oracle Triggered:* `INV-RX-01` fails (sink write attempted after scope join completed).

All 3 mutants are killed 100% with verified execution witnesses (`witness > 0`).

---

## 6. Autonomous Replay Bundle & Shrinker

When a simulation discovers an invariant violation among millions of seeds, diagnosing it requires more than a simple log message. Lust generates an autonomous, self-contained **Replay Bundle** (`src/sim/replay.rs`).

```
                              REPLAY BUNDLE (.tar)
+─────────────────────────────────────────────────────────────────────────────+
|  manifest.json    - Seed, toolchain version, commit SHA, violated oracle    |
|  events.jsonl     - Line-delimited JSON stream of all scheduler events      |
|  initial_vfs/     - Complete snapshot of MemFs before the run started       |
+─────────────────────────────────────────────────────────────────────────────+
```

### 6.1 Bundle Structure & `manifest.json`

Bundles are packaged as standard POSIX ustar `.tar` archives:

```json
{
  "seed": 25,
  "version": "3.5.8",
  "target_name": "campaign_target",
  "fault_config": "VfsReadError(/data.txt)",
  "invariant_oracle_name": "INV-BUDGET-01",
  "step_count": 84,
  "commit_sha": "c88c32c",
  "timestamp": 1700000000
}
```

The accompanying `events.jsonl` records every discrete transition:
```json
{"step":1,"nanos":0,"kind":{"kind":"TaskScheduled","detail":{"task_id":1,"quantum":3}}}
{"step":2,"nanos":0,"kind":{"kind":"GasBurned","detail":{"task_id":1,"gas_delta":12,"total_gas":12}}}
{"step":3,"nanos":0,"kind":{"kind":"VfsOperation","detail":{"op":"read","path":"/workspace/data.txt","success":false,"bytes":0}}}
{"step":4,"nanos":50000000,"kind":{"kind":"TimeAdvanced","detail":{"delta_nanos":50000000,"now_nanos":50000000}}}
```

### 6.2 Bit-for-Bit Replay (`ReplayEngine`)

Any developer or CI agent can take a `.tar` bundle, unpack it in an isolated environment with network disabled, and execute:

```rust
let bundle = ReplayBundle::from_tar_file("artifacts/replays/failure_25.tar")?;
let result = ReplayEngine::verify_replay(&bundle)?;
assert_eq!(result, ReplayResult::BitwiseIdentical);
```

If the code has changed or exhibits non-determinism, `ReplayEngine` pinpoints the exact divergent step:
```
ReplayError::TraceDivergence {
    step: 42,
    expected: "TaskScheduled(task_id: 1, quantum: 3)",
    actual: "TaskScheduled(task_id: 2, quantum: 1)"
}
```

### 6.3 The Shrinker Engine

Raw simulation runs can take thousands of steps before hitting an invariant violation. The **`Shrinker`** employs a deterministic binary search over execution step bounds:
1. Identifies the step $N$ where the failure occurred.
2. Halves the execution budget $[0, N/2]$ and tests if the invariant is still violated.
3. Automatically strips irrelevant tasks and operations.
4. Returns a `ShrunkReplay` containing the **minimal step prefix** necessary to trigger the bug.

---

## 7. CI Campaigns, Matrix Scaling & Zero-Cost TOST Equivalence

### 7.1 Nightly Matrix Campaign (`.github/workflows/dst_nightly.yml`)

Lust executes a scaled simulation campaign every night across **10 parallel GitHub Actions shards**:
- Total Seeds: **100,000 seeds** (10,000 seeds per matrix worker).
- Throughput: **7,000 to 10,000 seeds per second per worker**.
- On any failure, the workflow automatically captures and uploads the `dst-replay-bundle-shard-*.tar` artifact with 14-day retention.

```bash
# Run local campaign:
./scripts/run_dst_campaign.sh --seeds 1..10000 --workers 8 --artifact-dir artifacts/replays
```

### 7.2 Zero-Cost JIT & TOST Statistical Equivalence

A critical architectural requirement was that DST abstractions (pluggable clocks, VFS, continuation frames) must impose **zero performance penalty in production builds**.

Lust verifies this using **Two One-Sided T-tests (TOST)** statistical equivalence testing (`scripts/run_dst_tost_equivalence.sh`) across Criterion benchmarks **B01–B15**:
- Sample Size: $N = 30$ independent runs per benchmark.
- Confidence Level: $95\%$ ($\alpha = 0.05$).
- Equivalence Boundary: $\Delta \in [-1.5\%, +1.5\%]$.

```
+-----+--------------------------------------+----------+----------+---------+--------------------+--------------+
| ID  | Benchmark Name                       | Base(ns) | Cand(ns) | Delta%  | 95% CI Boundary    | TOST Verdict |
+-----+--------------------------------------+----------+----------+---------+--------------------+--------------+
| B01 | Direct Native Loop Baseline          |     0.32 |     0.32 |  -0.26% | [-0.46%, -0.05%]   | PASS         |
| B02 | LustEffectDescriptor (C-ABI Invoke)  |     0.32 |     0.32 |  -0.10% | [-0.18%, -0.01%]   | PASS         |
| B03 | StackContextProjection<1> Lookup     |     0.31 |     0.31 |  -0.00% | [-0.11%, +0.11%]   | PASS         |
| B04 | StackContextProjection<2> Lookup     |     0.31 |     0.31 |  +0.00% | [-0.11%, +0.11%]   | PASS         |
| B05 | StackContextProjection<4> Lookup     |     0.31 |     0.31 |  +0.05% | [-0.02%, +0.11%]   | PASS         |
| B06 | ScheduleKind::step (recurs)          |     4.45 |     4.43 |  -0.06% | [-0.20%, +0.08%]   | PASS         |
| B07 | ScheduleKind::step (exponential)     |    23.43 |    23.36 |  -0.14% | [-0.31%, +0.03%]   | PASS         |
| B08 | retry (immediate recurs, 2 fails)    |     4.84 |     4.82 |  +0.01% | [-0.35%, +0.37%]   | PASS         |
| B09 | retry (spaced backoff, 2 fails)      |     4.71 |     4.71 |  +0.03% | [-0.05%, +0.12%]   | PASS         |
| B10 | retry (exponential, 2 fails)         |    13.86 |    13.88 |  -0.02% | [-0.06%, +0.02%]   | PASS         |
| B11 | repeat (recurs 5 executions)         |     9.08 |     9.12 |  +0.17% | [+0.04%, +0.30%]   | PASS         |
| B12 | effect_timeout (success deadline)    |     0.45 |     0.45 |  +0.02% | [-0.10%, +0.14%]   | PASS         |
| B13 | effect_timeout (cutoff interrupt)    |     0.42 |     0.42 |  -0.10% | [-0.27%, +0.06%]   | PASS         |
| B14 | acquire_release + Masking            |     1.33 |     1.33 |  -0.10% | [-0.27%, +0.07%]   | PASS         |
| B15 | Scope Lifecycle (2 children + 2 fin) |    56.85 |    56.65 |  -0.03% | [-0.15%, +0.09%]   | PASS         |
+-----+--------------------------------------+----------+----------+---------+--------------------+--------------+
```

Every benchmark falls strictly within the $\pm 1.5\%$ margin. Production builds use monomorphized function pointers and stack-only projections with zero dynamic dispatch (`dyn`) on runtime hot paths.

---

## 8. Practical Code Examples

### 8.1 Writing Simulation-Aware Lust Scripts

Lust scripts do not require special branches to run under simulation. Standard stdlib modules (`os`, `io`, `task`) seamlessly adapt:

```lust
-- scripts/resilient_service.lust
use std.os
use std.io

function process_work_order(order_id: int): string
    -- 1. Deterministic file access via VFS
    local file_path = "/workspace/orders/" .. tostring(order_id) .. ".json"

    local read_res = io.read_file(file_path)
    if read_res is Err(_) then
        return "OrderNotFound"
    end
    local content = read_res:unwrap()

    -- 2. Virtual sleep: in simulation, advances virtual clock instantaneously!
    os.sleep(5.0) -- 5 seconds

    -- 3. Write processed result
    io.write_file("/workspace/results/" .. tostring(order_id) .. ".done", "PROCESSED: " .. content)
    return "Success"
end

function main(): string
    return process_work_order(101)
end
```

### 8.2 Driving Simulations from Rust Host Code

Here is how a Rust application sets up an end-to-end simulation harness with fault injection, step limiting, and invariant monitoring:

> 📂 **Runnable example:** [`examples/simulation/03_replay_bundle_export.rs`](https://github.com/ArchangelJTW/lust-lang/blob/master/examples/simulation/03_replay_bundle_export.rs)\
> 💻 *Compiler repository file:* `examples/simulation/03_replay_bundle_export.rs`

```rust
use std::io::ErrorKind;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use lust::sim::fault::{FaultConfiguration, FaultInjectedVfs};
use lust::sim::invariants::{InvBudget01Oracle, InvariantViolation};
use lust::sim::replay::{ReplayBundle, ReplayManifest};
use lust::sim::{PreemptiveExplorationScheduler, LustClock};
use lust::vfs::{MemFs, VirtualFileSystem};
use lust::bytecode::Value;

fn run_simulation_campaign_seed(seed: u64) -> Result<(), String> {
    // 1. Initialize simulation scheduler with deterministic seed
    let mut scheduler = PreemptiveExplorationScheduler::with_seed(seed)
        .with_max_quantum(4)
        .with_step_limit(10_000)
        .with_event_log();

    // 2. Setup in-memory filesystem with test fixtures
    let mem_fs = Arc::new(MemFs::new());
    mem_fs.create_dir_all(Path::new("/workspace/orders")).unwrap();
    mem_fs.write(
        Path::new("/workspace/orders/101.json"),
        b"{\"item\": \"Widget\", \"qty\": 42}"
    ).unwrap();

    // 3. Configure deterministic fault injection
    // Inject PermissionDenied on order #999, but order #101 will succeed
    let fault_config = Arc::new(Mutex::new(
        FaultConfiguration::new(seed)
            .with_vfs_read_error("999.json", ErrorKind::PermissionDenied)
    ));
    scheduler.vm.vfs = Arc::new(FaultInjectedVfs::new(mem_fs.clone(), fault_config));

    // 4. Compile and load Lust script
    let script = r#"
        use std.io
        use std.os

        function worker(): string
            local path = "/workspace/orders/101.json"
            local read_res = io.read_file(path)
            if read_res is Ok(data) then
                os.sleep(1.0) -- 1.0 second virtual sleep
                io.write_file("/workspace/orders/101.done", data)
                return "DONE"
            end
            return "MISSING"
        end
    "#;

    // Load compiled script into VM
    // (Assuming script compiled into bytecode function index 0)
    let func_val = Value::Function(0);
    let handle = scheduler.spawn_fiber(func_val, vec![]).map_err(|e| e.to_string())?;

    // 5. Initialize invariant monitor
    let initial_gas = scheduler.vm.gas_used();
    let mut gas_oracle = InvBudget01Oracle::new(initial_gas);

    // 6. Execute discrete steps
    while !scheduler.is_quiescent() {
        let gas_before = scheduler.vm.gas_used();

        match scheduler.step_one() {
            Ok(Some((task_handle, state))) => {
                let gas_after = scheduler.vm.gas_used();

                // Verify safety invariant INV-BUDGET-01
                if gas_after > gas_before {
                    if let Err(err) = gas_oracle.verify_step_progress(gas_after, 1) {
                        // Invariant violated! Pack Replay Bundle
                        let events = scheduler.take_event_log().unwrap_or_default();
                        let manifest = ReplayManifest::new(seed, "order_worker", scheduler.step_counter as u64)
                            .with_oracle("INV-BUDGET-01");
                        let bundle = ReplayBundle::from_simulation(manifest, events, &mem_fs);
                        bundle.write_tar("artifacts/replays/failure.tar").unwrap();
                        return Err(format!("Invariant violation: {}", err));
                    }
                }
            }
            Ok(None) => break, // Quiescent
            Err(e) => return Err(format!("Runtime error: {}", e)),
        }
    }

    // 7. Verify result file was written into MemFs
    assert!(mem_fs.exists(Path::new("/workspace/orders/101.done")));
    println!("Seed {} PASSED cleanly!", seed);
    Ok(())
}
```

---

## 9. Summary & Further Reading

With Deterministic Simulation Testing, Lust bridges the gap between high-level scripting ergonomics and aerospace-grade runtime resilience:
- **100% Determinism:** Any race condition or bug reproduced on seed $S$ will reproduce on seed $S$ everywhere, forever.
- **Zero-Cost Abstractions:** 0 runtime overhead on production builds verified by rigorous TOST statistical testing.
- **Autonomous Debugging:** Replay Bundles turn elusive production bugs into single-command offline repros.

For detailed architecture specifications and reports, see:
- Architecture & Roadmap: [`DST_ARCHITECTURE_AND_ROADMAP.md`](https://github.com/ArchangelJTW/lust-lang/blob/master/docs/DST_ARCHITECTURE_AND_ROADMAP.md)
- Runtime Verification Report: [`LUST_RUNTIME_STABILITY_AND_DST_VERIFICATION_REPORT.md`](https://github.com/ArchangelJTW/lust-lang/blob/master/docs/LUST_RUNTIME_STABILITY_AND_DST_VERIFICATION_REPORT.md)

---

## 10. Tier-3 Embedded `#![no_std]` DST (`DST-T3`)

Beyond host-side simulation, Lust ships a zero-OS-dependency **`#![no_std] + alloc`** deterministic simulation core (`src/no_std/trace.rs`, re-exported under `lust::no_std`) together with budgeted embedded allocators (`src/alloc_budget.rs` and `lust-aot-rt`), allowing bare-metal firmware and cross-compiled Rust AOT artifacts to produce and replay bit-identical traces without host clocks, filesystems, or threads.

### 10.1 Core `no_std` Primitives

| Component | Location | Role |
| --- | --- | --- |
| `DeterministicScheduler` | `src/no_std/trace.rs` | Pure `core + alloc` task scheduler driven by `SplitMix64` (zero host entropy), executing `SimTaskSpec` workloads and recording `TraceV1`. |
| `CanonicalTraceCodec` | `src/no_std/trace.rs` | Deterministic little-endian binary codec (`SCHEMA_VERSION_V1 = 1`, `CANONICAL_ENCODING_ID = "lust-dst-v1-le"`) for cross-architecture trace serialization and decoding. |
| `DeterministicScheduler::replay_verify` | `src/no_std/trace.rs` | Strict replay verifier that consumes recorded `SchedulingChoice` decisions without re-rolling the PRNG, returning `ReplayMismatch` on any header, logical-time, actor, or outcome divergence. |
| `StaticSlabAllocator<N>` | `src/alloc_budget.rs` & `lust-aot-rt` | Fixed-size `UnsafeCell<[u8; N]>` bump slab allocator for bare-metal targets (emitted automatically by `lust build --backend rust --no-std` as `StaticSlabAllocator<65536>`). |
| `LustBudgetAlloc` | `src/alloc_budget.rs` & `lust-aot-rt` | `Cell<usize>`-backed budgeted `Allocator` enforcing hard memory ceilings and returning `BudgetAllocError` / `AotError::OutOfMemory`. |
| `AotError::OutOfGas` | `crates/lust-aot-rt` | Deterministic gas-exhaustion error enforced identically across host and bare-metal AOT builds. |

### 10.2 Live Bare-Metal QEMU Verification (ARM Cortex-M4 & RISC-V 32)

The embedded Rust AOT + `DST-T3` stack is compiled offline with `rust-lld` and verified live inside real hardware emulators:

- **ARM Cortex-M4 (`thumbv7em-none-eabihf` via `qemu-system-arm`):** Integration suite `tests/ng_w18_dst_t3_qemu.rs` (fixture `tests/fixtures/w18_dst_t3_arm`) boots a `#![no_std]` Cortex-M4 (`lm3s6965evb`) ELF firmware running Lust Rust AOT functions, verifying:
  1. Bit-exact `TraceV1` execution and `CanonicalTraceCodec` round-trip (`replay_verify`),
  2. `StaticSlabAllocator` / `LustBudgetAlloc` bounded allocation behavior, and
  3. Deterministic `AotError::OutOfGas` exhaustion enforcement.
- **RISC-V 32 (`riscv32imafc-unknown-none-elf` via `qemu-system-riscv32`):** Integration suite `tests/ng_w18_rv32_qemu.rs` (fixture `tests/fixtures/w18_rv32_qemu`) compiles and executes the same Rust AOT + `DST-T3` suite on a 32-bit RISC-V bare-metal target, verifying cross-run determinism across independent `qemu-system-riscv32` invocations and `AotError::OutOfGas` enforcement.

---

## 11. Runnable Wave 4 `.lust` DST Examples (`EX-D`)

The following standalone `.lust` scripts complement the Rust host DST harnesses and execute deterministically under `lust run --backend mir`:
- `examples/simulation/01_deterministic_scheduler.lust` — deterministic seed `42` trace parity vs divergent seed `43`.
- `examples/simulation/02_fault_injection_vfs.lust` — deterministic VFS permission/read-only fault injection matrix.
- `examples/simulation/03_replay_bundle_export.lust` — replay manifest, event log, and payload roundtrip verification.

See also [Pure Core & Effects](./effects.md), [Embedding Lust](./embedding.md), and [CLI & Tooling](./tooling.md).
