# R10B controlled backup and restore implementation plan

Status: implementation in progress; no acceptance item below is pre-filled as passing.

## Actual baseline and boundaries

- Baseline: `origin/main` at `7b6dc1b99c91e313a47b42ebd8adbc00adf021cb`.
- The real V2 root is initialized by `DesktopSettingsRuntime.ensureV2Project`, then opened by
  `V2DesktopRuntime.openProject`. The runtime owns the `DatabaseSync` connection and registers only
  `v2:workspace:read` and `v2:workspace:mutate`.
- B1A--B1C already provide versioned snapshot manifests, COMPLETE binding, SQLite validation and
  managed-file inventory. R10B extends them with a restore coordinator; it does not rewrite those
  verified modules.
- Renderer receives display labels, stable status codes and one-time opaque leases only. Absolute
  paths, root identity, database paths, tokens, raw exceptions and credentials remain in main.
- Frozen design source: Figma `aLH4yq5SGE9MLIIwPBtJBT`, page `111:79`, especially nodes `115:79`
  through `117:247`, states `129:89`, `130:111`, `131:97`, compact restore `133:79`, and the
  implementation specification `134:79`. No Figma change is part of R10B implementation.

## State machine and recovery contract

1. `IDLE -> PREVIEWED`: native picker produces a short-lived, single-use main-process lease bound
   to sender/window and the selected directory identity.
2. `PREVIEWED -> READY`: read-only verification proves manifest/COMPLETE/hash/inventory, exact
   compatibility, current-root identity, maintenance safety, controlled target and capacity for both
   protected old root and staging candidate.
3. `READY -> BUILDING_STAGING`: a random operation id creates only owned journal and staging paths.
   Cancellation is accepted at explicit checkpoints before `SWITCHING`.
4. `BUILDING_STAGING -> SWITCHING`: all backup files are rebuilt and verified in isolation before
   the existing root is protected. No operation writes in place.
5. `SWITCHING -> SUCCESS | ROLLBACK | SAFETY_UNPROVEN`: the coordinator records each transition
   durably and verifies the resulting root before resolving. After switching begins cancellation is
   deferred until either verified success or verified rollback.
6. Startup inspects the journal before opening SQLite. It completes a provable recovery or returns
   `SAFETY_UNPROVEN`; that outcome keeps the V2 database closed.

Only operation-owned paths with a revalidated owner marker and node identity may be removed.
User-selected backups are never cleaned automatically. Any unprovable ownership, rename topology,
or resulting root identity is `SAFETY_UNPROVEN`, never a guessed success.

## Compatibility policy

Default compatibility requires exact backup format/policy, app version, data-root format/version,
V2 data version, schema version and migration fingerprint. `buildCommit` is audit-only. A default
empty, explicit policy seam may authorize future entries; there is no implicit cross-version path.
Unknown, downgrade, future, missing, extra, link/reparse, hardlink, TOCTOU or integrity mismatch
fails closed before mutation.

## Change sequence

1. Add restore contracts/coordinator and journal recovery beside the existing storage snapshot
   modules, using isolated synthetic roots for all tests.
2. Add V2 read/mutate DTO parsing, narrow opaque leases and stable error mapping through the two
   existing channels; coordinate runtime close/reopen around destructive replacement.
3. Bind frozen settings/maintenance UI to truthful preview, confirmation, stage and mutually
   exclusive result DTOs, including keyboard, focus and ARIA behavior.
4. Add focused behavior tests, then documentation and final repository gates. Windows smoke uses an
   injected temporary user-data root only.

## Acceptance map

| #   | Required evidence                                                                        | Planned location              | Status  |
| --- | ---------------------------------------------------------------------------------------- | ----------------------------- | ------- |
| 1   | Native picker lease and four backup preconditions                                        | V2 IPC/runtime tests          | PENDING |
| 2   | B1 snapshot runs through V2 adapter and verifies                                         | storage/runtime integration   | PENDING |
| 3   | Snapshot excludes credentials, cache content, paths and unreferenced files               | storage regression            | PENDING |
| 4   | Real stages map cancellation/failure/durability without false success                    | storage/runtime tests         | PENDING |
| 5   | Lease replay, expiry, sender mismatch, links and TOCTOU fail closed                      | V2 IPC tests                  | PENDING |
| 6   | Read-only preflight checks manifest, files and SQLite identity                           | restore-core tests            | PENDING |
| 7   | Exact-version policy blocks downgrade, future and unknown policy                         | restore-core tests            | PENDING |
| 8   | Capacity, maintenance, root identity, protection and cross-volume checks block pre-write | restore-core tests            | PENDING |
| 9   | Confirmation binds preview/root revision and expires on change                           | V2 runtime tests              | PENDING |
| 10  | Candidate staging verifies before protected-root switch                                  | restore fault-injection tests | PENDING |
| 11  | Pre-switch cancellation cleans only owned staging; post-switch cancellation is deferred  | restore fault-injection tests | PENDING |
| 12  | Startup journal recovery proves success/rollback or closes data as safety-unproven       | startup recovery tests        | PENDING |
| 13  | Result DTO/UI variants are mutually exclusive                                            | V2 renderer/runtime tests     | PENDING |
| 14  | Cleanup verifies ownership and never deletes selected backup                             | restore-core tests            | PENDING |
| 15  | Exactly two V2 channels and no sensitive public payload                                  | architecture/egress tests     | PENDING |
| 16  | Frozen desktop/compact UI, focus, Esc, disabled/loading and live regions                 | renderer + isolated smoke     | PENDING |
| 17  | R10C controls are unavailable with no route or handler                                   | renderer/architecture tests   | PENDING |
| 18  | Docs, B1A--B1C and adjacent governance remain aligned at zero external cost              | final gate suite              | PENDING |
