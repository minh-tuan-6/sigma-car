# SIGMA CAR — Deploying the API on Cloudflare Workers + D1

Commands are for **Windows PowerShell**, run from the repository root.

- Use `npx.cmd` because PowerShell may block `npx.ps1`.
- Wrangler is a pinned dev dependency (`wrangler@4.154.0`), so run `npm ci` once.
- `<…>` marks a value you must replace.
- **PLACEHOLDER** marks a line in `wrangler.api.toml` that you must edit.

**Status:** nothing has been deployed. Every remote step below needs your Cloudflare login and, for production, your
explicit approval (audit §9, P1–P5).

## 0. Requirements

| Item | Why |
|---|---|
| Cloudflare plan | **Free is the target** (course project): see `CLOUDFLARE_FREE_PLAN.md`. Everything fits the Free limits except password hashing (scrypt ≈ 33–48 ms CPU per hash in `workerd` vs 10 ms per request), which must be verified on Cloudflare (`CLOUDFLARE_FREE_PLAN.md` §6 step 7, fallbacks §7). Workers Paid removes that question but is not required to deploy. |
| Wrangler login with access to the account that owns the Pages project `sigma-car` | `npx.cmd wrangler login` |
| Node.js 24 (CI) or 23+ | tools and tests |

## 1. Local development and checks (no account needed)

```powershell
npm ci
npm test                      # Node: unit + integration + security (+ D1/Worker unit tests)
npm run test:worker-runtime   # integration + security suites through the Worker runtime + D1 driver
npm run test:workers          # Node vs Worker contract test in workerd (wrangler dev) + local D1
npm run build                 # Pages bundle (dist/)
npx.cmd wrangler d1 migrations apply DB --local -c wrangler.api.toml
npx.cmd wrangler dev -c wrangler.api.toml --port 8787   # API on http://127.0.0.1:8787/api/v1/health (dev seed)
```

The local Worker seeds the demo data into an empty local D1, the same way Node seeds a missing JSON file in
development.

## 2. Create the staging database

```powershell
npx.cmd wrangler login
npx.cmd wrangler d1 create sigmacar-staging
```

Copy the printed `database_id` into `wrangler.api.toml`, under `[[env.staging.d1_databases]]`, replacing
`REPLACE-WITH-STAGING-D1-DATABASE-ID`. Then apply the schema:

```powershell
npx.cmd wrangler d1 migrations apply DB --env staging --remote -c wrangler.api.toml
```

## 3. Secrets (staging)

Secrets never go into the repository or `wrangler.api.toml`. Generate random values with Node, which is
cryptographically secure:

```powershell
# JWT signing key (>= 32 chars).
node -e "process.stdout.write(require('crypto').randomBytes(48).toString('base64url'))" | npx.cmd wrangler secret put JWT_SECRET --env staging -c wrangler.api.toml

# Proxy secret shared with the Pages Function (defence in depth; the Worker has no public URL).
$s = node -e "process.stdout.write(require('crypto').randomBytes(48).toString('base64url'))"
$s | npx.cmd wrangler secret put PROXY_SHARED_SECRET --env staging -c wrangler.api.toml
# Set the same value as SIGMA_PROXY_SHARED_SECRET for the Pages *Preview* environment in the dashboard (§6).
Set-Clipboard -Value $s; Remove-Variable s

# Payment webhook HMAC key. Recommended: without it the gateway falls back to a public default (audit S1).
node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))" | npx.cmd wrangler secret put PAYMENT_WEBHOOK_SECRET --env staging -c wrangler.api.toml
```

Optional secrets, only if the features are used:

- `GEMINI_API_KEY`, `GROQ_API_KEY`, `OPENAI_API_KEY` (AI; without them the local fallback answers);
- `EMAIL_WEBHOOK_URL`, `EMAIL_WEBHOOK_SECRET` (e-mail through an HTTP provider; SMTP is unverified on Workers);
- `SIGMACAR_USDZ_PUBLIC_BASE_URL` (a var, not a secret: an external host for USDZ files > 25 MiB).

Non-secret settings are already in `wrangler.api.toml` `[env.*.vars]`:

- `NODE_ENV=production`;
- `TRUST_PROXY=true`;
- `PAYMENT_GATEWAY_SANDBOX=true`;
- `SIGMACAR_ALLOW_DEV_SEED=false`.

A production Worker without a valid `JWT_SECRET` answers every request with `503 CONFIG_ERROR`, as Node refuses to
boot.

## 4. Load data into staging

Production must not contain the demo accounts. Staging should be prepared the same way:

```powershell
node scripts/d1/json-to-d1.js --validate
node scripts/d1/json-to-d1.js --execute --env staging --catalog-only --exclude-demo-accounts --report docs/D1_DATA_MIGRATION_REPORT_staging.md
$env:SIGMA_ADMIN_PASSWORD = '<long admin password>'
node scripts/d1/create-admin.js --email <admin e-mail> --name "<name>" --env staging
Remove-Item Env:SIGMA_ADMIN_PASSWORD
```

The import:

- refuses a non-empty database unless you pass `--merge`;
- never overwrites rows;
- verifies counts, ids, content hashes, money totals and auth fields after loading.

`.d1-migration/` holds the generated SQL. It contains password hashes, is git-ignored, and should be deleted after
use.

## 5. Deploy the staging Worker

```powershell
npx.cmd wrangler deploy --env staging -c wrangler.api.toml --dry-run --outdir .d1-migration\bundle   # build check
npx.cmd wrangler deploy --env staging -c wrangler.api.toml
```

`workers_dev = false` and no routes, so the Worker `sigmacar-api-staging` gets no public URL.

## 6. Connect staging to a Pages preview and test it

Production Pages stays untouched. In the dashboard, go to **Workers & Pages → sigma-car → Settings → Bindings →
Preview → Add → Service binding** and set:

- Variable name `SIGMA_API`;
- Service `sigmacar-api-staging`.

Add the Preview variable `SIGMA_PROXY_SHARED_SECRET` with the value from §3. Then deploy a preview branch:

```powershell
npm run build
npx.cmd wrangler pages deploy dist --project-name sigma-car --branch staging
$B = 'https://staging.sigma-car.pages.dev'   # the preview URL printed by the command
Invoke-RestMethod "$B/api/v1/health"                                   # data.storageMode must be "d1"
Invoke-RestMethod "$B/api/v1/vehicles/tesla-cybertruck/ar-manifest" | Select-Object -ExpandProperty data | Select-Object vehicleId, schemaVersion
$login = Invoke-RestMethod "$B/api/v1/auth/login" -Method Post -ContentType 'application/json' -Body (@{ email = '<admin e-mail>'; password = '<password>' } | ConvertTo-Json)
Invoke-RestMethod "$B/api/v1/admin/users" -Headers @{ Authorization = "Bearer $($login.data.token)" } | Select-Object -ExpandProperty data | Measure-Object
```

Then go through the staging checklist in `CLOUDFLARE_WORKERS_TEST_REPORT.md` §7:

- catalog, AR page, register/login, cart, checkout;
- sandbox payment simulation (admin);
- media upload;
- admin pages;
- Worker logs: `npx.cmd wrangler tail sigmacar-api-staging`.

## 7. Back up before any production change

```powershell
npx.cmd wrangler d1 time-travel info sigmacar-production                  # note the bookmark
npx.cmd wrangler d1 export sigmacar-production --remote --output backups\d1-production-<date>.sql
node scripts/d1/json-to-d1.js --export-json backups\store-production-<date>.json --env production
```

D1 Time Travel can restore to any minute of the last 30 days on Workers Paid (7 days on Free). `backups\` holds user
data: keep it outside the repository or encrypted.

## 8. Production (only after explicit approval)

The steps are the same as staging, with `production`:

```powershell
npx.cmd wrangler d1 create sigmacar-production       # then edit the PLACEHOLDER id in [[env.production.d1_databases]]
npx.cmd wrangler d1 migrations apply DB --env production --remote -c wrangler.api.toml
# secrets: repeat §3 with --env production (new values; never reuse staging secrets)
node scripts/d1/json-to-d1.js --execute --env production --confirm-production --catalog-only --exclude-demo-accounts --report docs/D1_DATA_MIGRATION_REPORT_production.md
$env:SIGMA_ADMIN_PASSWORD = '<long admin password>'
node scripts/d1/create-admin.js --email <admin e-mail> --name "<name>" --env production --confirm-production
Remove-Item Env:SIGMA_ADMIN_PASSWORD
npx.cmd wrangler deploy --env production -c wrangler.api.toml
```

## 9. Switch Pages production traffic to the Worker (cutover)

Current production state: `/api/v1/*` answers `503 BACKEND_NOT_CONFIGURED`.

1. Dashboard: go to **sigma-car → Settings → Bindings → Production → Add → Service binding** and set `SIGMA_API` → `sigmacar-api`.
2. Add the Production secret `SIGMA_PROXY_SHARED_SECRET`, with the value you generated as the production
   `PROXY_SHARED_SECRET` in §8. Do this before running `Remove-Variable s`:
   `$s | npx.cmd wrangler pages secret put SIGMA_PROXY_SHARED_SECRET --project-name sigma-car`.
3. Redeploy Pages so the binding is active:

   ```powershell
   npm run build
   npx.cmd wrangler pages deploy dist --project-name sigma-car
   ```

4. Check:

   ```powershell
   Invoke-RestMethod https://sigma-car.pages.dev/api/v1/health
   ```

   `storageMode` must be `"d1"`, and the response header `X-Sigma-Proxy` must be `1`.

The Pages Function uses the binding when it exists and otherwise the previous `SIGMA_BACKEND_ORIGIN` proxy, so there
is never a second handler for `/api/v1/*`. Rollback: `CLOUDFLARE_WORKERS_ROLLBACK.md`.

## 10. Production cutover checklist

| ✔ | Item |
|---|---|
| ☐ | Approval for production deployment and data import (P1, P3, P5) |
| ☐ | Plan decided: Free with the hashing check of `CLOUDFLARE_FREE_PLAN.md` §6 step 7 passed (or a §7 fallback chosen), or Workers Paid |
| ☐ | Staging passed §6 and the test-report checklist; `wrangler tail` shows no errors |
| ☐ | `JWT_SECRET`, `PROXY_SHARED_SECRET`, `PAYMENT_WEBHOOK_SECRET` set on the production Worker; `SIGMA_PROXY_SHARED_SECRET` on Pages Production |
| ☐ | Production import report: 0 errors, verification passed; no demo accounts (`--exclude-demo-accounts`) |
| ☐ | First admin created with `create-admin.js` and able to log in |
| ☐ | Time Travel bookmark noted; SQL and JSON exports stored safely (§7) |
| ☐ | `PAYMENT_GATEWAY_SANDBOX=true` (no live payment provider exists in the code) |
| ☐ | Monitoring: `[observability] enabled = true` in `wrangler.api.toml`; `npx.cmd wrangler tail sigmacar-api` during cutover |
| ☐ | Rollback steps in `CLOUDFLARE_WORKERS_ROLLBACK.md` read and the people responsible know them |

## 11. Optional

- **Rate limiting:** to add a cross-isolate limit, uncomment `[[ratelimits]]` in `wrangler.api.toml`. It is counted
  per Cloudflare location.
- **Cron:** outbox, campaign queue, reconciliation and media purge still run only when an admin calls their endpoint,
  exactly as before. A Cron Trigger would change behaviour and is not configured.
- **AR:** the Worker serves the same AR manifest as the static snapshots in `dist/data/ar/`. USDZ files > 25 MiB
  still need `SIGMACAR_USDZ_PUBLIC_BASE_URL` (optional), or they are converted on the device, as before.
