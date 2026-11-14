# SIGMA CAR — Synthetic demo data

This guide covers generating, loading and removing the synthetic demo dataset (PLAN.md §I, tasks T5.1–T5.5).
Commands are for **Windows PowerShell** from the repository root.

**Status:**
- **Generation** is local and offline.
- **Loading into any Cloudflare database (T5.4)** has not been done. It needs explicit approval, and production is
  out of scope.

## 1. What the dataset contains

| Collection | Records | Notes |
|---|---:|---|
| `users` | 80 | Humorous Vietnamese names (e.g. *Nguyễn Văn Tốc Độ*, *Lê Văn Hết Pin*), role `buyer` |
| `orders` | 120 | 90 Delivered/Completed, 20 Confirmed (deposit), 10 Cancelled; real catalog vehicles and prices |
| `reviews` | 200 | About 60% realistic and 40% humorous text |
| `questions` | 40 | Each has one staff answer |
| `appointments` | 60 | Test drives, showroom and home |
| `supportTickets` | 40 | |
| `warranties` | 90 | One per delivered order |
| `serviceRecords` / `serviceAppointments` | 120 / 30 | |
| `analyticsEvents` | 3,000 | Funnel-shaped, `source: "demo"` |
| `notifications` | 150 | In-app only, `deliveryStatus: "demo_not_sent"` |

The same seed and `--now` always produce the same file.

## 2. Isolation rules

`tests/unit/demo_data.test.js` checks each of these.

- **Marking:** every record has `isDemo: true` and `demoBatchId`, and its id starts with `demo-`/`DEMO-`.
- **No logins:** demo users cannot log in. They are disabled and have a random password hash that no password
  produces.
- **No contact:** demo users cannot be contacted:
  - e-mails use the reserved `.invalid` domain;
  - phones are `0900 000 xxx`;
  - `marketingConsent` is `false`.
- **No messages or money:** the generator creates no outbox events, campaigns, payment intents, ledger entries,
  webhooks or refunds, so nothing is sent and no money moves.
- **Verified purchases are real relationships:** a review is "verified" only if a Delivered or Completed demo order
  exists for the same demo user and vehicle. The site shows these reviews as **"Đã mua hàng xác minh · Demo"**.
- **Kept out of real metrics:**
  - Revenue, orders, rankings and the funnel ignore `isDemo` records (T5.2).
  - An admin can include them with `?includeDemo=true` on `/api/v1/analytics/overview`, `/analytics/export` and
    `/analytics/top-products`.
  - The funnel always ignores them.
- **No real people:** no real customer's name, e-mail, phone or VIN is used. VINs start with `DEMO`.

## 3. Generate (local, no database)

```powershell
node scripts/demo/generate-demo-data.js --seed 2026 --batch demo-2026
# → data/demo/sigmacar_demo_demo-2026.json  (git-ignored)
node scripts/d1/json-to-d1.js --validate --source data/demo/sigmacar_demo_demo-2026.json
```

The validator warns "unknown vehicle". That is expected: the demo file has no catalog of its own, and it refers to
vehicles that already exist in the target database.

## 4. Load into a non-production D1 (T5.4 — needs approval)

Do these steps **in order**:

1. Confirm the target environment and its `database_id` in `wrangler.api.toml`.
2. Back up the database (`docs/CLOUDFLARE_WORKERS_DEPLOYMENT.md` §7).
3. Dry run, and read the report:

   ```powershell
   node scripts/d1/json-to-d1.js --dry-run --source data/demo/sigmacar_demo_demo-2026.json --merge --report docs/D1_DEMO_IMPORT_REPORT.md
   ```

4. Only after approval, run the import:

   ```powershell
   node scripts/d1/json-to-d1.js --execute --env staging --source data/demo/sigmacar_demo_demo-2026.json --merge
   ```

**How `--merge` behaves:**
- It never overwrites existing rows.
- The importer's normalisation also adds the store's standard default rows (for example the default policies and
  promotions). With `--merge`, a row that already exists in the target is skipped.
- Check the dry-run report for anything that is not `demo-…`.

## 5. Remove a batch (T5.5)

```powershell
node scripts/demo/remove-demo-data.js --batch demo-2026
# prints a read-only COUNT command and the wrangler command that applies .d1-migration/remove-demo-2026.sql
```

**What the SQL does:**
- It bumps `state_revision` by one.
- It records every removed row in `state_deletions`.
- It deletes only rows whose JSON has `isDemo = 1` and the given `demoBatchId`.

Running Workers then drop the rows on their next incremental sync. A plain `DELETE` would leave cached copies in
running Workers.

**If something goes wrong:** D1 Time Travel can restore the database; the Free plan keeps 7 days.
