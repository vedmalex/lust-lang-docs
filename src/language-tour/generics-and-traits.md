# Generics & Traits

Lust combines compile-time generics with Rust-style nominal traits. Generics enable flexible, reusable components without runtime overhead, while traits define shared interfaces and dynamic contracts.

---

## Generics

Lust generics are **statically checked and runtime-erased**. A generic function or method compiles to a single bytecode body, while the typechecker infers and validates concrete types at each call site. The trace JIT can then specialize that code for observed machine types at runtime.

### Declaration-Scoped Type Parameters

Type parameters are declared within angle brackets `<...>` immediately following the declaration name. Multi-letter PascalCase names (e.g. `Item`, `Element`, `Key`, `Val`) are recommended:

```lust
function identity<Item>(value: Item): Item
    return value
end

function first<Item>(values: Array<Item>): Item
    return values[0]:unwrap()
end
```

### Type Inference and Explicit Arguments

In most cases, type parameters are inferred from the arguments:

```lust
local n = identity(42)              -- Inferred as int
local s = identity("hello")         -- Inferred as string

local numbers: Array<int> = [10, 20, 30]
local first_num = first(numbers)    -- Inferred as int
```

When a generic parameter cannot be inferred, specify it explicitly. The `<` must directly follow the identifier without whitespace:

```lust
local text = identity<string>("hello")
```

---

## Generic Structs and `impl` Blocks

You can parameterize structs and implement generic methods:

```lust
struct Box<Item>
    value: Item
end

impl<Item> Box<Item>
    function get(self): Item
        return self.value
    end

    function set(self, new_val: Item)
        self.value = new_val
    end
end

local int_box: Box<int> = Box { value = 100 }
println("Box contains: " .. int_box:get()) -- 100
```

> [!NOTE]
> **Universal Impls Only:** Lust supports universal impl blocks (`impl<Item> Box<Item>`). Specialized impls (such as `impl Box<int>`) and conditional impls are not supported.

---

## Traits

Traits define nominal contracts that specify required methods. A type conforms to a trait only through an explicit `impl Trait for Type` block:

> 📂 **Runnable example:** [`examples/traits/01_basic_trait.lust`](https://github.com/ArchangelJTW/lust-lang/blob/master/examples/traits/01_basic_trait.lust)\
> 💻 *Compiler repository file:* `examples/traits/01_basic_trait.lust`

```lust
trait Drawable
    function draw(self)
end

struct Circle
    radius: float
end

struct Rectangle
    width: float
    height: float
end

impl Drawable for Circle
    function draw(self)
        println("Drawing circle with radius: " .. tostring(self.radius))
    end
end

impl Drawable for Rectangle
    function draw(self)
        println("Drawing rectangle: " .. tostring(self.width) .. "x" .. tostring(self.height))
    end
end
```

### Trait Bounds on Generics

Constrain generic parameters to types that implement specific traits using `<Parameter: TraitName>`:

> 📂 **Runnable example:** [`examples/traits/02_trait_bounds.lust`](https://github.com/ArchangelJTW/lust-lang/blob/master/examples/traits/02_trait_bounds.lust)\
> 💻 *Compiler repository file:* `examples/traits/02_trait_bounds.lust`

```lust
function render<T: Drawable>(shape: T)
    shape:draw()
end

local c = Circle { radius = 5.0 }
local r = Rectangle { width = 10.0, height = 20.0 }

render(c)
render(r)
```

Trait bounds are enforced statically at compile time with zero runtime dispatch cost.

### Default Trait Methods

Traits can supply default method bodies that reference `self`, other trait methods, and `Self`. Implementing types inherit default methods automatically or override them explicitly; missing required methods and ambiguous/conflicting trait method dispatch are rejected at compile time:

```lust
trait Describable
    function tag(self): string

    function describe(self): string
        return "[" .. self:tag() .. "]"
    end
end

struct Sensor
    name: string
end

impl Describable for Sensor
    function tag(self): string
        return self.name
    end
    -- Inherits `describe(self)` automatically
end
```

### Generic Traits

Traits can be parameterized over type arguments (`trait Mapper<T>`, `trait Converter<In, Out>`). `impl` blocks supply concrete type arguments, and generic functions can constrain parameters with parameterized trait bounds. The typechecker enforces arity checks and coherence (rejecting duplicate or overlapping implementations):

```lust
trait Mapper<T>
    function map(self, value: T): T

    function map_twice(self, value: T): T
        local once: T = self:map(value)
        return self:map(once)
    end
end

struct Doubler
    factor: int
end

impl Mapper<int> for Doubler
    function map(self, value: int): int
        return value * self.factor
    end
end

function apply_int_mapper<X: Mapper<int>>(m: X, v: int): int
    return m:map_twice(v)
end
```

### Associated Types

Traits can declare abstract or defaulted associated types (`type Item;`, `type Label = string;`), bound in each `impl` block (`type Item = int;`). Associated types can be projected through `Self::Item`, bounded type parameters (`C::Item`), concrete types (`IntBox::Item`), or disambiguated trait paths (`<Dual as LeftAssoc>::Item`). Cyclic, unresolved, or ambiguous projections fail closed during typechecking, and `LBC1` bytecode wire serialization preserves associated-type projections (wire tag `29`):

```lust
trait Container
    type Item;
    type Label = string;

    function get(self): Self::Item
    function get_default(self): Self::Item
        local v: Self::Item = self:get()
        return v
    end
    function label(self): Self::Label
end

struct IntBox
    value: int
end

impl Container for IntBox
    type Item = int;

    function get(self): Self::Item
        return self.value
    end

    function label(self): Self::Label
        return "intbox"
    end
end

function extract<C: Container>(c: C): C::Item
    return c:get_default()
end
```

Default trait methods, generic traits, and associated types execute with byte-exact parity across all three runtime backends: Bytecode VM, native Cranelift JIT, and Rust AOT (`0` `unsafe`).

---

## Dynamic Trait Objects & Narrowing

A bare trait name can also be used as a dynamic constraint type. When handling dynamic or `unknown` objects, use the `is` operator to test and narrow to a trait at runtime:

```lust
function process_object(obj: unknown)
    if obj is Drawable then
        println("Object conforms to Drawable:")
        obj:draw() -- Safe to call after narrowing!
    else
        println("Object is not drawable")
    end
end

process_object(c)   -- Draws circle
process_object(123) -- Prints: Object is not drawable
```

---

## Automatic String Concatenation with `ToString`

Lust provides a built-in `ToString` trait. Any type that implements `ToString` automatically participates in string concatenation via the `..` operator:

```lust
struct Point
    x: int
    y: int
end

impl ToString for Point
    function to_string(self): string
        return "(" .. tostring(self.x) .. ", " .. tostring(self.y) .. ")"
    end
end

local pt = Point { x = 12, y = 34 }

-- 'pt' is automatically converted to string via to_string()!
println("Target location: " .. pt) -- Outputs: Target location: (12, 34)
```

---

## Current Restrictions

Because Lust generics are statically erased:
- Trait methods currently require a leading `self` parameter.
- `is` and `as` cannot target an erased type parameter (e.g. `val is Item` is rejected; test against concrete types or traits instead).

---

## Next Steps

Now learn how to structure multi-file projects with [Modules & Organization](./modules.md).
