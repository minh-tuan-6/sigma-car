# SIGMA CAR — JSON → D1 Data Migration Report

Runs of `scripts/d1/json-to-d1.js` on 2026-11-14 against **local D1** (Miniflare, the D1 simulator shipped with
Wrangler 4.154.0). **No remote (staging or production) D1 database was created or written.** No production data
exists (audit §1), so the only source is the repository snapshot `data/sigmacar_store.json`.

## 1. Source

| Property | Value |
|---|---|
| File | `data/sigmacar_store.json`, 203,436 bytes |
| SHA-256 | `7625267844e37bbaa321b9fc09754ae789dcdecec0f0deab4e166e157c04a99d` |
| Opened | read-only (the tool swaps in an `fs` that refuses every write; a unit test checks hash and mtime before and after) |
| Normalisation | the same `ensureExtendedCollections()` that Node runs at boot (adds 145 branch-inventory rows, 8 accessories, 3 promotions, 2 policies). Rows it creates are stamped with the source's `meta.lastSavedAt`, so the import is reproducible |
| Content | catalog, plus demo records; **all 4 users are demo accounts** (public salt `a1b2c3d4e5f60718`, passwords in `storage-engine.js`) |

## 2. Validation result (source)

0 errors. 6 warnings, all **already present in the source**, and reported without being changed:

- `orders ORD-9020/9021/9022/9023.vehicleId` → `model-e`, `vision-s`, `x-series-gt`, `city-g`, which are not in the catalog;
- `reviews REV-1001/1002.vehicleId` → `model-e`, `x-series-gt`.

These come from the legacy demo archive (`meta.legacyVehicleArchives`). The Node backend returns them as they are,
and so does the Worker.

## 3. Full import (`--execute --local`)

217 rows in 18 collections plus `meta`. SQL file: 238,214 bytes. Verification: **passed — D1 matches the source
exactly.**

| Collection | Rows | Verified (count · id set · content + order hash) | Extra checks |
|---|---|---|---|
| accessories | 8 | ✅ | |
| auditLogs | 1 | ✅ | |
| branchInventory | 145 | ✅ | |
| certifiedVehicles | 5 | ✅ | |
| emailCampaigns | 3 | ✅ | |
| faqs | 7 | ✅ | |
| orders | 4 | ✅ | money: `unitPrice` 7,310,000,000 · `depositAmount` 230,000,000 — equal |
| policyVersions | 2 | ✅ | |
| promotions | 3 | ✅ | |
| questions | 1 | ✅ | |
| returnRequests | 2 | ✅ | |
| reviews | 2 | ✅ | |
| serviceAppointments | 1 | ✅ | |
| serviceRecords | 2 | ✅ | |
| supportTickets | 2 | ✅ | |
| users | 4 | ✅ | id, e-mail, password hash, `sessionVersion`, role, `disabledAt` — equal |
| vehicles | 24 | ✅ | |
| warranties | 1 | ✅ | |
| `meta` | 1 value | ✅ | |

Verification compares, per collection, the row count, a hash of the sorted ids, and a hash of the ordered
`(key, JSON)` pairs (so any changed byte or changed order fails). It also compares money totals and an auth-field
hash for users. Referential checks run on the data that is imported.

## 4. Idempotency and safety

| Check | Result |
|---|---|
| Second `--execute` without `--merge` | refused: "Target D1 already holds 217 rows" |
| Second `--execute --merge` | 217 rows (unchanged), 1 `data_migrations` record, verification passed |
| Row modified after import, then re-import (unit test) | the modified row is kept (`ON CONFLICT DO NOTHING`) |
| Later `--verify` (separate run) | passed: normalisation is deterministic |
| Corrupt source (unit test) | refused before anything is written |
| Quotes / SQL in ids and values (unit test) | stored verbatim, no injection |
| Tampered order amount / deleted FAQ (unit test) | verification reports `orderedSha256`, money totals and count differences |

## 5. Production-style import (`--catalog-only --exclude-demo-accounts`)

194 rows, 0 errors, 0 warnings, verification passed. Not imported:

- users (4)
- orders (4)
- returnRequests (2)
- warranties (1)
- serviceRecords (2)
- serviceAppointments (1)
- reviews (2)
- questions (1)
- supportTickets (2)
- emailCampaigns (3)
- auditLogs (1)

`--exclude-demo-accounts` without `--catalog-only` is refused: the demo orders, returns and reviews would still
reference the removed users (36 references found).

The first administrator is then created with `scripts/d1/create-admin.js`:

- It builds the record with `UserRepository.create()` and scrypt, the same code path as the API.
- The password comes from `SIGMA_ADMIN_PASSWORD`, at least 12 characters, and never from the command line.
- Run locally, it created the account. A second run with the same e-mail in different case changed nothing.
- `--env production` without `--confirm-production` was refused.

## 6. Reverse export (rollback path)

`--export-json` rebuilt a JSON store from the imported local D1. The result is **deep-equal** (`assert.deepStrictEqual`)
to the normalised source: 19 top-level keys. The Node backend can start from that file (rollback drill:
`CLOUDFLARE_WORKERS_ROLLBACK.md` §4).

## 7. Not done

- No remote import: it needs Cloudflare credentials and approval (P2, P3).
- The real staging and production imports must be re-run with `--env staging` / `--env production --confirm-production`
  and their reports kept: `--report docs/D1_DATA_MIGRATION_REPORT_<env>.md`.
