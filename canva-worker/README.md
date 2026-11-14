# Kotybook Canva Worker (isolated)

This is a separate GitHub Actions worker. It does not modify or call the existing
Kotybook Flow workflow (`.github/workflows/main.yml`).

## Files
- `.github/workflows/canva-worker.yml` — manual GitHub Actions workflow.
- `canva-worker/worker.js` — Playwright browser worker.

## Required GitHub secret
Create or reuse the repository secret named `CANVA_AUTH_STATE_JSON`.
Its value must be the Canva Playwright storage-state JSON object. Never paste
its contents into chat, commit it, or print it in workflow logs.

## First test
1. Upload these files to the same private repository, preserving their paths.
2. In GitHub, open Actions → Kotybook Canva Worker → Run workflow.
3. Enter a short test prompt. Use a non-customer test story first.
4. When the run ends, download the artifact `kotybook-canva-worker-output`.
5. Check `canva-worker/output/` for the PDF. If the worker cannot recognize a
   Canva control, inspect the diagnostics screenshot and text in the artifact.

## Important limitations
Canva changes its interface and accessible labels. This first version uses
conservative visible-control detection; it may stop and save diagnostics if
the current Canva UI does not expose the expected editor, send, download, or
PDF controls. It does not retry blindly.

The PDF is saved as a GitHub Actions artifact only. There is no Google Drive
upload, no Canva API use, and no change to the existing Flow workflow.

The workflow requires the repository to already contain the root `package.json`
and a working GitHub Actions environment. It installs Playwright directly
without changing the repository's package files.
