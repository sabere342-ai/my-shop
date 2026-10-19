# MY SHOP M3-S1 — Final acceptance

Slice: **typed organization settings** (Master Plan §40.7 row M3-S1; §22.2/§22.4
inventory, `settings_version` per §38.18, `offline_grace_duration` per §22.4,
validation and audit — §22.1's governance posture: invalid values rejected; every
change audited).

Record: [`MY_SHOP_M3_S1_SLICE_RECORD.md`](MY_SHOP_M3_S1_SLICE_RECORD.md)
(declaration in commit `c374270`; implementation through `e2da979`; decisions in
[ADR-023](../adr/ADR-023-typed-organization-settings.md)).

## Verified acceptance state

| Item | Evidence |
| --- | --- |
| Governing acceptance | Invalid values rejected — DB CHECKs and the service layer refuse every §22.2/§22.4 bound (db-spec "CHECK refusals" tests); every change audited — `SETTINGS_UPDATED` committed in the same transaction as the change (class A), proved by the db-spec acceptance tests |
| Inventory faithfulness | All §22.2/§22.4 fields implemented exactly, incl. owner-exclusive `minorUnitExponent`, `roundingMode`, `offlineGraceDurationSeconds` (default 259 200 s = 72 h, max 2 592 000 s = 30 days), `reservedBlockSize`, and the owner-gated empty feature-flag vocabulary; `allow_negative_stock` absent (M0-P2 amendment removal), `app_lock_enabled` absent (per-device, M9) |
| Versioning | `settings_version` monotonic ≥ 1; stale token → `409 SETTINGS_VERSION_CONFLICT` with no partial write; concurrent writers serialized; every accepted write bumps exactly one version, refused writes never do |
| Tenancy and RLS | Both new tables ENABLE + FORCE row-level security inside migration `0012`; cross-tenant insert/update/delete/move refused; reads/writes run inside the trusted tenant transaction |
| Migration discipline | `0012` forward-only and additive; migrations `0001`–`0011` byte-untouched (migration-immutability gate: 12 migration paths, none rewritten) |
| Local suites | Unit 40 suites / 495 tests; integration 7 suites / 60 tests; database (real PostgreSQL 18, serial) 4 suites / 164 tests — all passed on the recorded head |
| Flutter untouched | `flutter:test` 403 passed / 1 skipped / 0 failed; `flutter analyze --fatal-infos` clean |
| Remote CI (exact head SHA `e2da9793932e838a30a83dc3d419f1e639ba0db3`) | push run `39293919766` and PR run `39294212261`, both **success, 7/7 jobs** (fast-checks, backend-unit, backend-integration-database, contract-drift, dependency-audit, flutter-build-windows, flutter-build-android) |
| Stacked publication | PR **#25** OPEN, head `codex/my-shop-m3-s1-typed-organization-settings` at the SHA above, base `codex/my-shop-m2-s7-flutter-auth-session` (whose head `d08a6bbd…` is verified unchanged, as is PR #22/#23's stack); no merge performed by this slice |

On the §43.1 gates: **G-12 is NOT SATISFIED by this slice by design** — the pull
request is left open and no merge was performed. Only every CI job required by
G-1 is green, on the exact head SHA above. The merge decision belongs to the
owner alone.

## Verdict

```
NO MERGE PERFORMED — OWNER MERGE AUTHORIZATION REQUIRED
PASS_MY_SHOP_M3_S1_TYPED_SETTINGS_REMOTE_LOCKED
```
