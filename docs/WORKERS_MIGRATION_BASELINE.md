# SIGMA CAR — Workers Migration Baseline (before any code change)

Recorded 2026-11-14 at commit `746889f` with a clean working tree, Node v23.11.0, Windows 11. Nothing had been
modified yet when these ran. The only setup change was installing the pinned `wrangler@4.154.0` dev dependency,
which no test uses.

## Results

| Command | Result | Notes |
|---|---|---|
| `npm test` (unit + integration + security, `node --test tests/**/*.test.js`) | **209 / 209 pass**, 30 suites, 0 fail, 2.4 s | Rewrites `data/sigmacar_store.json` as a side effect (pre-existing); restored with `git checkout -- data/sigmacar_store.json`. |
| `npm run build` | **OK** | 24 static AR manifests; 45 USDZ files > 25 MiB kept out of `dist/`; "Zero private store leaks, all files within Cloudflare Pages 25 MiB limit". |
| `npm run test:e2e` (playwright-core 1.49.1, real Chrome) | **19 / 19 pass** | AR flow, colour bar, Quick Look launch, Android/desktop message, showroom, cart regression. |
| `node tests/test_ar_full_suite.js` | 7 / 7 | |
| `node tests/test_ar_phase1.js` | 6 / 6 | |
| `node tests/test_models.js` | 10 / 10 | |
| `node tests/test_viewer_camera_integration.js` | 8 / 8 | |
| `node tests/test_gyro.js` | 12 / 12 | |
| `node scripts/migrate-json-to-sql.js --dry-run` (CI step) | OK | Exports to an in-memory SQLite. |

No pre-existing failures. Any later failure is a regression unless shown otherwise.

## Recorded API behaviour

The API behaviour baseline is the Node backend itself. `tests/workers/contract.test.js` runs one scripted sequence
of requests against a fresh Node server and the Worker (both seeded from the same data) and compares status
codes, headers and normalised JSON bodies. See `CLOUDFLARE_WORKERS_TEST_REPORT.md`.

## Production baseline

Production `/api/v1/*` on Pages returns `503 BACKEND_NOT_CONFIGURED`: no backend origin is configured, so there is
no production API traffic and no production data to protect or migrate.
