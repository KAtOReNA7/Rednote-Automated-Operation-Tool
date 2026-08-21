# R10B controlled backup and restore implementation plan

Status: implementation ready for review; Draft PR #26, not merged.

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

| #   | Required evidence                                                                        | Verified evidence                                                                                                                              | Status |
| --- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1   | Native picker lease and four backup preconditions                                        | `r10b-controlled-restore`: runtime reports all four facts; `r10b1c-backup-orchestration`: path, capacity and maintenance failures fail closed. | PASS   |
| 2   | B1 snapshot runs through V2 adapter and verifies                                         | `r10b1c-backup-orchestration` creates a generated snapshot and verifies it read-only.                                                          | PASS   |
| 3   | Snapshot excludes credentials, cache content, paths and unreferenced files               | `r10b1b-sqlite-inventory` excludes authorization/cache state; B1C excludes unreferenced cache and result paths.                                | PASS   |
| 4   | Real stages map cancellation/failure/durability without false success                    | B1C cancellation/durability cases plus R10B runtime stage polling.                                                                             | PASS   |
| 5   | Lease replay, expiry, sender mismatch, links and TOCTOU fail closed                      | `r10b-controlled-restore` binds/expires leases; B1C rejects links and invalid selected roots.                                                  | PASS   |
| 6   | Read-only preflight checks manifest, files and SQLite identity                           | R10B restore preflight and B1C inventory/manifest verification tests.                                                                          | PASS   |
| 7   | Exact-version policy blocks downgrade, future and unknown policy                         | `r10b-controlled-restore` blocks version mismatch before staging.                                                                              | PASS   |
| 8   | Capacity, maintenance, root identity, protection and cross-volume checks block pre-write | R10B preview/execute capacity tests and B1C selected-root checks.                                                                              | PASS   |
| 9   | Confirmation binds preview/root revision and expires on change                           | Runtime lease expiry, caller binding and confirmation revalidation tests.                                                                      | PASS   |
| 10  | Candidate staging verifies before protected-root switch                                  | `rebuilds and verifies an isolated candidate before a same-parent protected switch`.                                                           | PASS   |
| 11  | Pre-switch cancellation cleans only owned staging; post-switch cancellation is deferred  | R10B cancellation and B1C asynchronous copy-cancellation cases.                                                                                | PASS   |
| 12  | Startup journal recovery proves success/rollback or closes data as safety-unproven       | R10B startup-journal, recovery and contradictory-topology cases.                                                                               | PASS   |
| 13  | Result DTO/UI variants are mutually exclusive                                            | `v2-persistence` renders each restore result variant without its incompatible variant.                                                         | PASS   |
| 14  | Cleanup verifies ownership and never deletes selected backup                             | B1C owned-staging canary test; R10B recovery cleanup cases.                                                                                    | PASS   |
| 15  | Exactly two V2 channels and no sensitive public payload                                  | `v2-persistence` IPC/bridge tests and path-free public-failure case.                                                                           | PASS   |
| 16  | Frozen desktop/compact UI, focus, Esc, disabled/loading and live regions                 | Figma nodes `115:79`, `117:79`--`117:247`, `129:89`, `130:111`, `131:97`, `133:79`, `134:79`; renderer and 1280/1440 isolated smoke.           | PASS   |
| 17  | R10C controls are unavailable with no route or handler                                   | `forbidden-scope.architecture` and V2 route/IPC tests retain no R10C control surface.                                                          | PASS   |
| 18  | Docs, B1A--B1C and adjacent governance remain aligned at zero external cost              | `repository-documentation`, R10B focused suites and repository constraints use synthetic local fixtures only.                                  | PASS   |

Physical power-loss durability remains **UNKNOWN**: the result exposes only completed sync requests,
directory-sync unavailability, or published durability unknown. It is not presented as a successful
power-loss guarantee.
