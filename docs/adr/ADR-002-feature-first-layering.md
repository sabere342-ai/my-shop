# ADR-002 — Feature-first layering with CI-enforced import boundaries; domain is pure Dart

**Status:** Accepted
**Decided in:** Master Plan §6.3, §41
**Implement in:** M1-S1 (structure), enforced from M1-S4 (CI stage 11)
**Revisit at:** M10

## Context

Master Plan §5.4 records that the legacy application's `database_helper.dart` reached
**3,926 lines** and was imported by **31 of its 165** `lib` files. That single file
held the schema, every SQL query, tenant scoping, permission gates, licensing gates,
sync enqueue, and cost-history recording.

The consequence was not the line count. It was that every pricing, discount, and costing
rule was entangled with a database call, so none of them could be tested without one.

## Decision

Vertical slices, not horizontal layers across the whole app:

```
features/sales/
  data/          sales_api.dart, sales_dto.dart, sales_mapper.dart
  domain/        sale.dart, sale_line.dart, sale_policy.dart, create_sale.dart
  presentation/  sales_screen.dart, cart_screen.dart, sale_controller.dart
```

Dependency direction:

| From | To | Allowed |
|---|---|---|
| `presentation` | `domain` | yes |
| `data` | `domain` | yes |
| `presentation` | `data` | only through an injected repository interface |
| `domain` | `data` | **forbidden** |
| `domain` | `flutter` | **forbidden** |

Enforced by a custom lint **and** by CI import-boundary stage (§37.2 stage 11), because
a rule only one mechanism checks is a rule that eventually stops being checked.

## Rationale

This is described in Master Plan §6.3 as the single highest-leverage decision in the
client architecture, and the reason is specific: it makes every pricing mode (§17),
discount authority rule (§18), settings rule (§22), and rounding rule (§30) **pure Dart**,
unit-testable with no widget tree, no database, and no network.

The legacy failure is specifically that this was not true. `DatabaseHelper.instance` was
a global mutable singleton behind seven static seams, so a costing rule could not be
exercised without a live SQLite file.

## Consequences

- Money is a value type in `core/money`, not a number in a row (Master Plan §30.1,
  integer minor units). That is only possible because `domain` cannot reach a database.
- The layering cost is real: a domain type that needs a persisted identifier carries an
  id value object rather than the ORM model. This is the intended trade.
- `presentation` reaching `data` only through an injected interface is what makes widget
  tests possible with faked repositories (Master Plan §6.11).

## Rejected alternatives

| Option | Why rejected |
|---|---|
| Horizontal layers (`data/`, `domain/`, `presentation/` at the root) | Every feature's data layer can import every other feature's domain. A shop with twenty features gets a hundred ways to couple, and nothing in the structure resists it. |
| Convention instead of enforcement | The legacy application had a nominal architecture and a 3,926-line god object. Documented conventions do not survive contact with a deadline. |