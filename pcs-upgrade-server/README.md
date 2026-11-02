# HS PCS Upgrade Server

Production: https://cpeng.uk

This is the cloud adaptation of `HS_PCS_PC/PcsUpgradeServer`. Its HS management pages and UARTGrapher upgrade protocol are preserved. Cloudflare Workers runs the API, D1 stores releases and sessions, and private R2 stores packages. No local computer needs to stay online. The original C# project remains in the local source directory; ASP.NET itself cannot run directly in Workers.

## Active source and access

`worker.js` implements the cloud API. `wwwroot/` contains HS login and software/firmware management. The old root `public/` and `worker/` directories are historical and are not deployed.

Account: `HS`. Password: existing Worker secret `ADMIN_PASSWORD`. `SESSION_SECRET` signs eight-hour sessions, revoked on logout. No default password is shipped. Management and the license tool require login. Version and download APIs remain public for existing clients.

The license generator contains license key material. Its HTML is excluded from this public repository and all static assets. Private R2 object `pcs/private/registry.html` serves it only after authentication. Upload the trusted local generator page to that object to update it.

## Client APIs

Set the upper-computer server address to `https://cpeng.uk`.

- `GET /api/manifest`
- `GET /api/software/versions`
- `GET /api/software/latest`
- `GET /api/firmware/releases`
- `GET /api/firmware/latest`
- `GET /download/software/{fileName}`
- `GET /download/firmware-release/{fileName}`

Metadata includes `fileSize`, `md5`, `publishedAt`, `url`, and firmware `components`. New packages use 8 MiB multipart uploads. Server-side MD5 is calculated before publishing; application size limit is 2 GiB, subject to Cloudflare execution limits.

## Deploy

Run from the repository root:

```sh
npm ci
npx wrangler login
npx wrangler d1 migrations apply firmware-manage-db --remote
npm run deploy
```

Resources: Worker `firmware-manage-web`, D1 `firmware-manage-db`, R2 `firmware-manage-files`. The Worker name is retained to preserve domain and secrets. Code is stored in GitHub. Automatic push deployment requires connecting this repository to Workers Builds, production branch `main`, build `npm ci`, deploy `npx wrangler deploy`. Until connected, deploy explicitly.

## Verify locally

```sh
npx wrangler d1 migrations apply firmware-manage-db --local
npx wrangler dev --port 8787 --var ADMIN_PASSWORD:pcs-local-test --var SESSION_SECRET:pcs-local-test-session-secret
```

In another terminal run `node pcs-upgrade-server/test-local.mjs`. It only permits localhost and checks login, authorization, multipart publishing, MD5, duplicate names, version queries, public downloads, ranges and deletion with generated test data.

## Import releases

Run `node pcs-upgrade-server/prepare-import.mjs <local-PcsUpgradeServer-directory>`. It verifies size/MD5 and writes ignored `pcs-upgrade-server/import.sql`. Upload packages to the printed R2 keys, then run `npx wrangler d1 execute firmware-manage-db --remote --file pcs-upgrade-server/import.sql`. Repeated imports preserve existing release names. Packages and secrets are never committed.
