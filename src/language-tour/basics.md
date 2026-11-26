# Variables & Primitives

This chapter introduces Lust's fundamental building blocks: declaring variables, working with primitive types, applying operators, and formatting strings.

---

## Declaring Variables with `local`

> 📂 **Runnable example:** [`examples/basic/02_variables.lust`](https://github.com/ArchangelJTW/lust-lang/blob/master/examples/basic/02_variables.lust)\
> 💻 *Compiler repository file:* `examples/basic/02_variables.lust`

```lust
local score: int = 10
score = 25              -- Reassignment is valid
```

Because Lust is strictly typed, reassigning a variable to a different type is rejected at compile time:

```lust
local count: int = 5
-- count = "five"       -- Compile error: type mismatch
```

---

## Primitive Types

Lust features four core primitive types:

| Type | Description | Examples |
|---|---|---|
| `int` | 64-bit signed integer | `0`, `42`, `-100`, `0xFF` |
| `float` | 64-bit IEEE 754 floating-point number | `3.14`, `-0.001`, `10.0` |
| `bool` | Boolean flag | `true`, `false` |
| `string` | UTF-8 encoded text | `"hello"`, `'world'` |

---

## Type Inference

Type annotations are optional when the compiler can deduce the type from the initial value:

```lust
local age = 30                 -- Inferred as int
local temperature = 98.6       -- Inferred as float
local is_active = true         -- Inferred as bool
local username = "alyssa"      -- Inferred as string
```

You can add explicit annotations (`: type`) whenever you want to clarify intent, make public interfaces explicit, or disambiguate numbers:

```lust
local weight: float = 150.0
local buffer_size: int = 1024
```

---

## Numeric Literals & Radix Bases

Lust provides first-class support for four numeric bases (decimal, hexadecimal, binary, and octal), visual digit separators (`_`), bit pattern semantics, and flexible floating-point representations.

### Radix Notations & Integer Literals

Integer literals default to 64-bit signed integers (`int` / `i64`). You can express integers using any of the four standard radix bases:

| Base | Prefix | Valid Digits | Examples | Description |
|---|---|---|---|---|
| **Decimal** | *(none)* | `0-9` | `42`, `1_000_000`, `42_133_7` | Standard base-10 integers |
| **Hexadecimal** | `0x` or `0X` | `0-9`, `a-f`, `A-F` | `0x0F`, `0xDEAD_BEEF`, `0xFFFF_FFFF_FFFF_FFFF` | Base-16 bit patterns |
| **Binary** | `0b` or `0B` | `0`, `1` | `0b1010_0101`, `0b1111_0000` | Base-2 binary strings |
| **Octal** | `0o` or `0O` | `0-7` | `0o755`, `0o644`, `0o177777` | Base-8 POSIX permission masks |

Both lowercase and uppercase radix prefixes (`0x` / `0X`, `0b` / `0B`, `0o` / `0O`) are fully supported and interchangeable.

### Bit Patterns & Two's Complement Semantics

In Lust, radix literals (`0x`, `0b`, `0o`) are interpreted as 64-bit unsigned register bit patterns (`0x0 ..= 0xFFFF_FFFF_FFFF_FFFF`). The compiler maps the raw bit pattern into Lust's signed 64-bit integer type (`int` / `i64`) using two's complement reinterpretation (`val as i64`):

- **Upper positive boundary (`i64::MAX`)**:\
  `0x7FFF_FFFF_FFFF_FFFF` = `9223372036854775807`
- **Most Significant Bit (MSB) boundary (`i64::MIN`)**:\
  `0x8000_0000_0000_0000` = `-9223372036854775808`
- **All bits set (mask of all ones)**:\
  `0xFFFF_FFFF_FFFF_FFFF` = `-1`

This design provides clean, zero-overhead bit manipulation without requiring special unsigned primitive types:

```lust
local all_ones: int = 0xFFFF_FFFF_FFFF_FFFF  -- Value is -1
local msb_flag: int = 0x8000_0000_0000_0000  -- Value is -9223372036854775808
local max_pos: int  = 0x7FFF_FFFF_FFFF_FFFF  -- Value is 9223372036854775807
```

For standard decimal numbers, Lust directly supports the full 64-bit range from `-9223372036854775808` (`i64::MIN`) to `9223372036854775807` (`i64::MAX`). Values exceeding 64-bit capacity produce a compile-time overflow error.

### Digit Separators (`_`)

To improve readability when writing large numbers or grouped bit patterns, Lust allows underscore (`_`) separators between digits:

```lust
local microsecond_budget = 1_000_000
local subnet_mask = 0b11111111_11111111_11111111_00000000
local hex_magic = 0xCAFE_BABE
```

#### Placement Rules

Digit separators are strictly restricted to positions between digits to prevent ambiguity:
- **Allowed**: Between any two valid digits of the corresponding base (e.g., `1_000_000`, `0xDEAD_BEEF`, `0b1010_0101`, `0o123_456`).
- **Consecutive underscores are prohibited**: `1__0` or `0x1__0` (compile error).
- **Trailing underscores are prohibited**: `100_` or `0xFF_` (compile error).
- **Leading underscore after prefix is prohibited**: `0x_1`, `0b_0`, or `0o_7` (compile error).
- **Adjacency to a decimal point is prohibited**: `1._0` or `1_.0` (compile error).
- **Adjacency to an exponent indicator or sign is prohibited**: `1.0_e3`, `1e_3`, or `1e+_3` (compile error).

### Floating-Point Literals

Floating-point numbers (`float` / `f64`) can be written with a fractional decimal point, scientific notation with an exponent indicator (`e` or `E`), or both:

- **Fractional decimals**: `3.1415_9265`, `1_000.5_0`, `0.001`
- **Scientific notation**: `1e3` ($1000.0$), `1e-3` ($0.001$), `1.0e+6` ($1000000.0$)
- **With separators**: `1e1_0` ($10^{10}$)

Underscores may be used within the integer, fractional, or exponent parts following the same placement rules.

### Complete Executable Example

Below is a complete, executable Lust script demonstrating all numeric literal variants, bit patterns, and assertions:

> 📂 **Runnable example:** [`examples/basic/20_numeric_literals.lust`](https://github.com/ArchangelJTW/lust-lang/blob/master/examples/basic/20_numeric_literals.lust)\
> 💻 *Compiler repository file:* `examples/basic/20_numeric_literals.lust`

```lust
-- 1. Decimal Integers with digit separators and boundary constants
local dec = 1_000_000
local dec_min = -9_223_372_036_854_775_808
local dec_max = 9_223_372_036_854_775_807

assert(dec == 1000000)
assert(dec_min == -9223372036854775808)
assert(dec_max == 9223372036854775807)

-- 2. Hexadecimal literals (0x and 0X) with two's complement MSB reinterpretation
local hex_val = 0xDEAD_BEEF
local hex_upper = 0x7FFF_FFFF_FFFF_FFFF
local hex_min = 0x8000_0000_0000_0000
local hex_all_ones = 0xFFFF_FFFF_FFFF_FFFF
local hex_lower_prefix = 0xcafe
local hex_upper_prefix = 0XCAFE

assert(hex_val == 3735928559)
assert(hex_upper == 9223372036854775807)
assert(hex_min == -9223372036854775808)
assert(hex_all_ones == -1)
assert(hex_lower_prefix == hex_upper_prefix)

-- 3. Binary literals (0b and 0B)
local bin_byte = 0b1010_0101
local bin_nibble = 0B1111_0000
local bin_mask = 0b1111_1111
local bin_all_ones = 0b11111111_11111111_11111111_11111111_11111111_11111111_11111111_11111111

assert(bin_byte == 165)
assert(bin_nibble == 240)
assert(bin_mask == 255)
assert(bin_all_ones == -1)

-- 4. Octal literals (0o and 0O)
local oct_mode = 0o755
local oct_rw = 0O644
local oct_max16 = 0o177777
local oct_all_ones = 0o1777777777777777777777

assert(oct_mode == 493)
assert(oct_rw == 420)
assert(oct_max16 == 65535)
assert(oct_all_ones == -1)

-- 5. Floating point with separators and scientific notation
local pi_approx = 3.1415_9265
local exp_small = 1e-3
local exp_large = 1.0e+6
local exp_sep = 1e1_0
local float_sep = 1_000.5_0

assert(pi_approx == 3.14159265)
assert(exp_small == 0.001)
assert(exp_large == 1000000.0)
assert(exp_sep == 10000000000.0)
assert(float_sep == 1000.5)

-- 6. Bitwise operations and shifts (&, |, ^^, ~, <<, >>)
local shifted = 0xFFFF_FFFF_FFFF_FFFF >> 4
assert(shifted == -1) -- Arithmetic shift on all-ones preserves sign (-1 >> 4 == -1)

local left_shifted = (0x0F << 4) | 0x05
assert(left_shifted == 245)

assert(1 << 64 == 1)
assert(16 >> 64 == 16)
assert(-16 >> 2 == -4)
assert(~0 == -1)

local masked = 0xDEAD_BEEF & 0xFFFF
assert(masked == 0xBEEF)
assert(masked == 48879)

local ored = 0b1010_1010 | 0b0101_0101
assert(ored == 0b1111_1111)
assert(ored == 255)

local xored = 0x5555_5555_5555_5555 ^^ 0xAAAA_AAAA_AAAA_AAAA
assert(xored == -1)
assert(xored == 0xFFFF_FFFF_FFFF_FFFF)

local oct_masked = 0o755 & 0o777
assert(oct_masked == 0o755)
assert(oct_masked == 493)

println("All numeric literal assertions passed!")
```

---

## Arithmetic Operators

Lust provides a complete set of arithmetic operators covering both integer and floating-point computations with 100% parity across the VM, Cranelift JIT, and Zig AOT backends:

```lust
local a: int = 20
local b: int = 6

local sum = a + b              -- 26
local diff = a - b             -- 14
local prod = a * b             -- 120
local quot = a / b             -- 3 (Truncating division to zero)
local floor_quot = a // b      -- 3 (Floor division: rounds towards -infinity)
local remainder = a % b        -- 2 (Truncating remainder, matching Rust %)
local power = 2 ^ 3            -- 8 (Integer exponentiation)
```

### Division and Remainder Semantics

- **Standard Division (`/`)**: Performs truncating division towards zero (e.g., `-5 / 2 == -2`). Division by zero triggers a guaranteed `DivisionByZero` runtime trap across all backends.
- **Floor Division (`//`)**: Rounds quotient strictly down towards $-\infty$:
  - `5 // 2 == 2`
  - `-5 // 2 == -3`
  - `5 // -2 == -3`
  - `-5 // -2 == 2`
- **Modulo (`%`) vs `math.mod(a, b)`**:
  - `%` implements truncating remainder (`wrapping_rem`, e.g., `-5 % 2 == -1`).
  - `math.mod(a, b)` implements floored modulo whose sign matches the divisor $b$. This guarantees the invariant identity:
    $$a == (a // b) * b + math.mod(a, b)$$

### Exponentiation (`^`)

- **Right-associative**: `2 ^ 3 ^ 2 == 2 ^ (3 ^ 2) == 2 ^ 9 == 512`.
- **Precedence higher than unary minus**: `-2 ^ 2 == -(2 ^ 2) == -4`.
- **Integer preservation**: `(int, int) -> int` when the exponent is non-negative ($>= 0$). A negative integer exponent raises a runtime error. `float ^ float` or mixed numeric operations return `float`.

---

## Bitwise Operators

Bitwise operators operate on integer values (`int` / `i64`) with automatic shift amount normalization (`rhs & 63`):

| Operator | Syntax | Description | Example |
|---|---|---|---|
| **AND** | `a & b` | Bitwise conjunction | `0b1100 & 0b1010 == 0b1000` |
| **OR** | `a \| b` | Bitwise disjunction | `0b1100 \| 0b1010 == 0b1110` |
| **XOR** | `a ^^ b` or `a ~ b` | Bitwise exclusive OR | `0b1100 ^^ 0b1010 == 0b0110` |
| **NOT** | `~a` | Unary one's complement (`~x == (-x) - 1`) | `~0 == -1` |
| **SHL** | `a << b` | Left shift (`l << (r & 63)`) | `1 << 4 == 16` |
| **SHR** | `a >> b` | Arithmetic right shift (preserves sign) | `-16 >> 2 == -4` |

> [!NOTE]
> **XOR (`^^` vs `~`) and `~=`:** Lust accepts both `^^` and `~` for binary XOR. However, `^^` is the canonical operator because `^^=` is supported for compound assignment, whereas `~=` is reserved for the inequality comparison operator (`!=`).

---

## Compound Assignment Operators & Single Evaluation

Lust supports in-place compound assignment for all binary arithmetic and bitwise operations:

```lust
local total = 100
total += 25                    -- 125
total -= 15                    -- 110
total *= 2                     -- 220
total /= 4                     -- 55
total //= 2                    -- 27
total %= 10                    -- 7
total ^= 2                     -- 49
total &= 0x0F                  -- 1
total |= 0x10                  -- 17
total ^^= 0x01                 -- 16
total <<= 2                    -- 64
total >>= 3                    -- 8
```

### Guaranteed Single Evaluation
When modifying nested structure fields or array index elements (such as `arr[get_index()] += step` or `target.field += step`), Lust guarantees that the target base and index expressions are evaluated **strictly once**. Side effects in accessor expressions are never duplicated.

---

## Operator Precedence

Lust uses a 12-level precedence hierarchy matching modern systems languages:

| Level | Operators | Associativity | Description |
|:---:|---|:---:|---|
| **12 (Highest)** | `.` (field), `[]` (index), `()` (call), `?` (try-unwrap) | Left | Primary access and error propagation |
| **11** | `^` | **Right** | Exponentiation (`-2 ^ 2 == -4`) |
| **10** | `-` (unary), `not`, `~` (bitwise NOT), `#` | Right | Unary prefixes |
| **9** | `*`, `/`, `//`, `%` | Left | Multiplicative |
| **8** | `+`, `-` | Left | Additive |
| **7** | `..` | **Right** | String concatenation |
| **6** | `<<`, `>>` | Left | Bitwise shifts |
| **5** | `&` | Left | Bitwise AND |
| **4** | `^^`, `~` (binary XOR) | Left | Bitwise XOR |
| **3** | `\|` | Left | Bitwise OR |
| **2** | `==`, `!=`, `~=`, `<`, `<=`, `>`, `>=` | None | Relational comparisons |
| **1 (Lowest)** | `and`, `or` | Left | Short-circuit boolean logic |

---

## Comparison Operators

Comparisons evaluate to `bool`:

```lust
local x = 10
local y = 20

local is_equal = (x == y)      -- false
local is_not_equal = (x != y)  -- true (Lua-style '~=' is also accepted)
local is_less = (x < y)        -- true
local is_less_or_equal = (x <= y)
local is_greater = (x > y)
local is_greater_or_equal = (x >= y)
```

---

## Strings and Concatenation

Lust uses Lua's double-dot (`..`) operator for string concatenation:

```lust
local first_name = "Ada"
local last_name = "Lovelace"
local full_name = first_name .. " " .. last_name
println(full_name)             -- Outputs: Ada Lovelace
```

Primitive types (`int`, `float`, `bool`) implement the `ToString` trait out of the box, meaning they can be concatenated directly into strings without manual conversion:

```lust
local item_count = 3
local price = 19.99
local message = "Ordered " .. item_count .. " items at $" .. price
println(message)
```

You can also explicitly convert values using `tostring(val)`:

```lust
println("Flag is " .. tostring(true))
```

Escape sequences such as `\n` (newline), `\t` (tab), and `\"` (quote) are supported in string literals:

```lust
println("Line 1\nLine 2\tIndented")
```

---

## Comments

```lust
-- This is a single-line comment

--[[
    This is a multi-line
    block comment in Lust.
]]
local answer = 42 -- Comments can appear after statements
```

---

## Next Steps

Now that you know how to declare data, learn how to organize code into functions and control execution in [Functions & Control Flow](./control-flow.md).
