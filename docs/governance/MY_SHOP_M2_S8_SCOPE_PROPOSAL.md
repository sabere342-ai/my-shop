# MY SHOP M2-S8 - Roadmap audit and scope proposal

Status: **PROPOSAL - NOT AUTHORIZED.** This record is a governance audit, not a slice
declaration. Under §40.1 a slice is the unit of authorization; nothing in this document
authorizes a slice, and no implementation has been performed under the M2-S8 label.

## 1. The audit finding

The authoritative plan ([`MY_SHOP_MASTER_PLAN.md`](MY_SHOP_MASTER_PLAN.md)) defines the M2
phase (§40.6) as exactly seven slices, S1 through S7. There is **no M2-S8 row anywhere in
the plan**, and a full-repository search for `M2-S8` (all documents, all ADRs, all slice
records) returns no definition. The two literal "M2b" strings in the plan (§3 V1-38 row,
§41 preamble) are dependency-era references from the plan's numbering history, not phase
tables: no M2b phase decomposition exists, and row V1-38 (offline authenticated grace and
the cached authorization snapshot) is delivered by M1b-S8 and M2-S3/M2-S7 as implemented.

M2's next-phase dependency edge (§40 roadmap: M3 depends on M2) is the only pointer for
what follows the phase. The honest reading of the mandate to "execute M2-S8" is therefore
route 23 of §3 of the execution contract: no authoritative definition exists, so a large
feature is not invented under that label. This record audits the roadmap and prepares a
proposed scope for owner decision.

## 2. Verified repository state (read-only, audited 2026-10-19)

| Item | Verified value |
| --- | --- |
| Local HEAD == remote branch head | `d08a6bbdac611278f4d5c17520206de2fda58b83` on `codex/my-shop-m2-s7-flutter-auth-session` |
| Predecessor PR | #23, OPEN, base `codex/my-shop-m2-s6-audit-streams` (stack intact) |
| Grand-predecessor PR | #22, OPEN, head `3d1ce8fd36fb224ecd4bda0a43266541b8e15ec4` (unchanged) |
| Final-HEAD CI, push event | run `39262363810`, conclusion success, 7/7 jobs |
| Final-HEAD CI, PR event | run `39262372433`, conclusion success, 7/7 jobs |
| Working tree | clean |
| Local re-verification | toolchain pin PASS; all 9 root gates green; Flutter analyze clean (`--fatal-infos`); Flutter suite 403 passed / 1 skipped / 0 failed |
| The one skip | `T-O6` `DEFERRED_BY_PLAN` (pull-path client transport and resume), unchanged from its governing reference |

The accepted M2-S7 evidence is reconfirmed on this machine exactly as it was reported:
nothing drifted, and the baseline claims - keystore-only token custody, fail-closed
verification, sign-out wiping regardless of server response - are covered by the suites
re-run above and require no source change to keep.

## 3. Where the roadmap actually stands

- **M2 is implemented, not closed.** All seven M2 slices exist as stacked, open PRs
  (#4, #5, #6 for M1's tail; #22, #23 for M2's last two). §43.2 P-1 closes a phase only
  when its slices are **merged**, and §43.1 G-12 reserves every merge to the owner. No PR
  in this repository has ever been merged with automation; that stays the owner's call.
- **The next authoritative slice is M3-S1** (§40.7): typed organization settings covering
  every §22.2 field, `settings_version`, and `offline_grace_duration` (§22.4), with
  validation and audit. Its dependencies are all satisfied by M2 (organizations,
  memberships, permissions, audit streams, the tenancy predicate, and the devices that
  read settings offline).
- **Recorded deferrals with a governing reference stay where the plan put them.**
  - `T-O6` (client pull transport and resume): deferred by plan to the slice that owns
    the client pull path; the skip remains explicit and labeled.
  - The §38.16.3 device-id-in-signature refinement of the grace record: deferred with a
    recorded residual in ADR-006 (D-C); it has a home in the ADR, not this proposal.
  - M2-S6's service-row HTTP-route footnote is a server-surface note inside that slice's
    record; it does not constitute an unowned milestone.

## 4. Proposed M2-S8 (for owner decision only)

**Recommendation: do not authorize an M2-S8 slice. Authorize M3-S1 instead.**
M2's roadmap rows are complete; inventing an eighth row would either duplicate recorded
deferrals or expand scope without a plan basis, and §40.1 authorizes slices by plan row.

If the owner nonetheless wants a bridge slice before M3-S1, the only plan-grounded
candidate is an **M2 phase-closure review**: a read-only audit that walks the phase's
endpoints and permissions against §43.2 P-4 (the phase security review) and re-evidences
the P-gates for the still-open stack, explicitly excluding any merge (G-12). It would be
declared like any slice - scope, non-scope, allowed paths, tests, acceptance - before
work begins. Until the owner picks, the correct state is: **no M2-S8 slice exists.**

## 5. Why no code was written under this label

Every §43.1 gate presumes a declared slice. G-1 and G-2 cannot be satisfied from a label
alone; an un-authorized implementation would violate the plan's core discipline (§40.1:
the declaration precedes any file touch). This record is the declaration-shaped artifact
that an unassigned label can produce without inventing requirements: the audit, the
verified baseline, and the proposed scope. It is stacked as PR-over-PR exactly like every
slice, and its only change is this document.

## 6. Acceptance status

**Not applicable - this is a proposal, not an accepted milestone.** No PASS token is
issued for M2-S8: the milestone is formally absent from the governing plan, and establish-
ing it requires an owner decision recorded in the plan (§43.1 G-11/G-12 discipline). The
baseline of M2-S7 stands as accepted and untouched.
