# SIGMA CAR — Rolling back the Workers + D1 migration

Windows PowerShell, from the repository root. Nothing in the migration deletes or rewrites the previous
architecture:

- `server.js`, the JSON storage engine, `data/sigmacar_store.json`, the Dockerfile and the HTTP proxy path of
  `functions/api/v1/[[path]].js` are all still there and covered by `npm test`.

Pick the smallest step that fixes the problem.

## 1. Return API traffic to the previous path (seconds, no data change)

The Pages Function uses the `SIGMA_API` service binding when it exists, and the `SIGMA_BACKEND_ORIGIN` HTTP proxy
otherwise.

1. Go to **Dashboard → Workers & Pages → sigma-car → Settings → Bindings → Production**, and remove the `SIGMA_API`
   service binding.
2. Redeploy Pages:

   ```powershell
   npm run build
   npx.cmd wrangler pages deploy dist --project-name sigma-car
   ```

3. Check the result:

   ```powershell
   Invoke-RestMethod https://sigma-car.pages.dev/api/v1/health
   ```

   - With `SIGMA_BACKEND_ORIGIN` pointing at a running Node backend, it answers with `storageMode: "json"`.
   - Without it, it answers `503 BACKEND_NOT_CONFIGURED`. That was the production state before the migration.

The frontend and AR pages are static and keep working throughout. The AR page falls back to the static manifests
in `dist/data/ar/`.

## 2. Roll back the Worker code only (data unchanged)

```powershell
npx.cmd wrangler deployments list --env production -c wrangler.api.toml
npx.cmd wrangler rollback --env production -c wrangler.api.toml          # previous version, or pass a version id
```

## 3. Restore D1 data (destructive for later writes)

```powershell
npx.cmd wrangler d1 time-travel info sigmacar-production --timestamp "<RFC3339 time before the problem>"
npx.cmd wrangler d1 time-travel restore sigmacar-production --bookmark <bookmark>
```

- Time Travel covers 30 days on Workers Paid and 7 days on Free.
- A restore overwrites the database in place. It prints the previous bookmark, so the restore itself can be undone.
- Running Workers notice the change through `state_revision` only if the restored revision differs from the one
  they hold. Redeploy the Worker (`wrangler deploy`) after a restore so every isolate reloads.

From an SQL export (`CLOUDFLARE_WORKERS_DEPLOYMENT.md` §7), restore into a **new** database and point
`wrangler.api.toml` at it:

```powershell
npx.cmd wrangler d1 create sigmacar-production-restore
npx.cmd wrangler d1 execute sigmacar-production-restore --remote --file backups\d1-production-<date>.sql
```

## 4. Move the data back to the Node backend (full rollback)

```powershell
node scripts/d1/json-to-d1.js --export-json backups\sigmacar_store.json --env production
# copy the file to the Node host's volume as SIGMACAR_DATA_FILE, start the container (Dockerfile) with the SAME JWT_SECRET
# set SIGMA_BACKEND_ORIGIN (+ SIGMA_PROXY_SHARED_SECRET) on Pages, then do step 1
```

- The export holds exactly what the Worker wrote: every collection, in order, and `meta`.
- Keep the same `JWT_SECRET`, so users' tokens stay valid. Password hashes are the same scrypt format.

**Drill (executed locally, 2026-11-14 — `tests/workers/rollback-drill.workers.js`).** This was run against local
`workerd` and Node, not production. The steps:

1. A catalog-only D1 with no demo accounts, plus a first admin created with `create-admin.js`.
2. The Worker in production mode accepted a registration, a cart and a checkout.
3. D1 was exported to JSON.
4. `node server.js` (production mode) was started from that file.

Results:

- The demo admin login was refused on the Worker (401).
- The Worker-issued buyer token was accepted by Node.
- The order created on Workers was listed by Node.
- The admin user list was identical.
- The buyer's password, hashed by the Worker, verified on Node.

Results: `CLOUDFLARE_WORKERS_TEST_REPORT.md`.

## 5. What is never touched

- `data/sigmacar_store.json`: the import opens it read-only.
- Existing D1 rows during re-imports (`ON CONFLICT DO NOTHING`).
- Production DNS, routes, payment settings: none are changed by any script in this repository.
