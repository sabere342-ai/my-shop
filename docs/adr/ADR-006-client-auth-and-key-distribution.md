# ADR-006 — Client authentication: keystore-only token custody, pinned snapshot key, bound-session grace

**Status:** Accepted
**Decided in:** Master Plan §13.6, §6.10, §38.16.2–§38.16.3, §40.6 (row M2-S7)
**Implement in:** M2-S7
**Revisit at:** M9 (app lock) and whenever the key-distribution posture changes

## Context

M2-S7 delivers the client's authentication flow: sign-in, session store, secure
token storage, device enrollment, and the grace-window UX on start. The
governing acceptance is one sentence: **a token is never written outside the
platform secure storage** (§13.6, §6.10). Everything else in the slice — the
transport, the screens, the verifier — is built around making that sentence
true by construction and by test.

Three decisions had to be made before the code could exist:

1. Which keystore dependency backs the §13.6 port, and what the store does
   when the platform answers with garbage.
2. How the client obtains the public key it needs to verify the server's
   signed authorization snapshot (§38.16.3) — the M1b-S8 verifier port has a
   hard rule (**no accepting default**, M1b-S8 D-2) that a concrete
   implementation must not erode.
3. Where the grace record's device fact comes from, given that the server's
   snapshot deliberately carries no device id (§38.16.3 as shipped in M2-S3).

## Decision

### D-A — `flutter_secure_storage` behind the keystore port; one record; fail closed

The `Keystore` port is implemented by `FlutterSecureKeystore`
(Windows DPAPI / Android Keystore via `flutter_secure_storage`). All token
material — access token, refresh token, the identity that owns them — lives in
**one** keystore record under the single key `auth.access_token`, stored as a
JSON envelope. One record means one write, one wipe, and no partially-updated
token state.

Failure posture is fail-closed in both directions:

- A failed **write or read** surfaces as `SecureKeystoreException` and the
  session reports unauthenticated. There is no plaintext fallback, no
  preferences fallback, no database fallback — the cross-check test (AC-1)
  proves no token byte ever reaches a file, a Drift table, or a plain map.
- A **corrupted** record (undecodable JSON) is wiped best-effort and then
  throws `SecureKeystoreException(corrupted)`. The client never invents a
  session from half a record, and never leaves a poisoned record in place to
  be re-read forever.

Sign-out wipes the token record, the installation identity, and the grace
record locally **regardless of the server logout outcome** — a network failure
during sign-out must never leave credentials on the disk.

### D-B — Key distribution by build pin; absence is honest, never accepting

The SPKI public key for snapshot verification is compiled into the binary via
the `MY_SHOP_SNAPSHOT_PUBLIC_KEY` dart-define. This is **optional by design**:

- With the key present, the verifier checks RS256 signatures against the
  pinned deployment key — no key discovery, no TOFU, no runtime key fetch that
  an attacker could influence.
- With the key **absent**, the client still signs in and works online, but no
  offline grace record can ever verify, so no offline session is established.
  The shell's grace line stays honestly neutral (§38.31). This is the
  no-accepting-default rule applied at composition: a client that cannot
  verify signatures refuses every grace record rather than trusting unsigned
  material.

The server origin is likewise a build input: `MY_SHOP_API_BASE_URL` is
**required**, and composition fails fast naming the define rather than
inventing a default origin. A client binary is compiled for the deployment it
belongs to; there is no "localhost fallback" to silently point a till at the
wrong server.

### D-C — The grace record's device fact comes from the bound session

The signed snapshot carries the authorization facts (permission set,
`permissions_version`, catalog version, organization, expiry — §38.17) but
**not** a device id; device identity rides in the access token's `did` claim
(M2-S3's recorded decision). The client therefore establishes its offline
grace record from two verified sources joined locally: the **signature covers
the authorization facts**, while the record's `deviceId` field carries exactly
the **server-issued bound device id** from the `bind-session` response — never
a client-invented id. Install locality is then enforced by the store's
existing establish-time and every-admission binding checks (M1b-S8).

**Residual, stated not hidden:** the JWS signature itself does not bind the
device id, so a snapshot copied between two enrolled devices of the same
organization would still verify. The exposure is bounded: both devices are
already authenticated members of the same organization, and every admission
still re-checks the local binding. §38.16.3's device-id-in-signature
refinement is a server-side contract change, out of a client-only slice's
scope, and is deferred with this record as its decision point.

### D-D — Organization selection is derived, never asserted

The organization-setup screen offers exactly the memberships the verified
`/auth/me` response returned — no new backend route, no client-side org
discovery, no free-text tenant id. §9.3's rule (tenant identity derived from
verified credentials) is enforced by the UI offering nothing else.

## Consequences

- Token custody is provable by a negative test: the AC-1 cross-check scans
  every non-keystore persistence seam the app has and finds no token material.
  Any future store that wants to persist session-shaped data must fail this
  test first.
- A deployment that forgets the public-key define gets a working online client
  with **no offline grace** — visible in the shell's honest neutral line, not
  a crash and not a silent trust decision. Deployment checklists must treat
  the define as part of release configuration (revisit at M10 / release).
- The `did`-in-token / authorization-in-snapshot split means the client's
  offline admission is only as device-specific as the binding store is. The
  binding store's keys are server-issued and owned by the outbox module; the
  slice adds no new private-key spelling (stage-24 posture preserved).
- The corrupted-record wipe is best-effort by necessity (the keystore may be
  the thing that is failing). The exception still propagates — the session is
  unauthenticated until a successful sign-in rewrites the record.

## Rejected alternatives

| Option | Why rejected |
| --- | --- |
| SharedPreferences / Drift / file-backed token store | Directly violates the governing acceptance (§13.6). A POS device image is enumerable; a token in a SQLite file is a breach waiting for a backup job. |
| Separate keystore keys per token field | Three writes and three wipes invite partial states; one envelope record makes "no token" a single observable fact. |
| Runtime key discovery (JWKS fetch, TOFU) | The verifier's trust root would become network-influenced at exactly the moment (offline boot) it must be strongest; also breaks the no-accepting-default rule the first time a fetch fails open. |
| Hardcoded development key as a default | One accepting default is enough to forge a grace record on any device that ships with it. Refused by M1b-S8 D-2. |
| Minting grace records at `POST /auth/login` | Requires a backend contract change a client-only slice must not make (§40.6 row M2-S7 scope); the M2-S3 snapshot plus the bound session is sufficient and already shipped. |
| A free-text organization picker | Would let the client assert a tenant id it was never verified to belong to (§9.3). |
