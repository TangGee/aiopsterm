# Official Website

This document records the source ownership, runtime boundaries, and maintainer workflow for the aiopsterm website. The website is a separate project and is not built or packaged as part of the desktop application.

## Repositories And Endpoints

| Purpose | Location |
| --- | --- |
| Production website | `https://aiopsterm.com` |
| Website alias | `https://www.aiopsterm.com` |
| Website API | `https://api.aiopsterm.com` |
| Website source | `https://github.com/TangGee/aiopsterm-web` |
| Desktop public source | `https://github.com/TangGee/aiopsterm` |
| Desktop Gitee remote | `https://gitee.com/tanggee2/aiopsterm` |
| Product support | `support@aiopsterm.com` |
| Private security reports | `security@aiopsterm.com` |
| Privacy requests | `privacy@aiopsterm.com` |

Maintainers commonly keep the repositories as sibling checkouts:

```text
workspace/
  aiopsterm/
  aiopsterm-web/
```

The repositories have independent dependencies, build outputs, and release history. The current desktop build does not import or package website source files. The website consumes published release metadata and links to published desktop artifacts instead.

## Website Architecture

The `aiopsterm-web` repository contains two deployment surfaces:

- An Astro static site under `src/pages/`, `src/components/`, and `src/layouts/`. English pages use the root paths and Chinese pages use `/zh-cn/`.
- A Cloudflare Worker in `worker/index.ts`. Wrangler serves the generated `dist/` directory and routes `/v1/*` through the Worker before static assets.

The Worker uses a Cloudflare D1 database whose schema and migrations live under `migrations/`. The current API surface is:

| Method and path | Responsibility |
| --- | --- |
| `POST /v1/telemetry/active` | Record consented anonymous activity after hashing the installation identifier. |
| `POST /v1/telemetry/revoke` | Remove activity associated with an installation identifier. |
| `POST /v1/events/download` | Record aggregate download source information. |
| `GET /v1/releases/stable` | Return the stable release manifest used by the download page. |
| `GET /v1/admin/metrics` | Return protected aggregate metrics for the maintainer dashboard. |

The scheduled Worker cleanup retains recent activity and download events for the periods implemented in `worker/index.ts`. The `/stats/` dashboard must remain behind Cloudflare Access because it calls the protected administrator endpoint.

## Local Development And Verification

Run website commands from the independent website checkout:

```bash
cd ../aiopsterm-web
npm ci
npm run build
npm test
npm run worker:test
```

Use `npm run dev` for the Astro development server and `npm run worker:dev` for the local Worker runtime. The normal build runs Astro validation, Worker TypeScript checking, and the static site build.

The generated `.astro/`, `dist/`, and `.wrangler/` directories are local artifacts and must not be committed.

## Cloudflare Configuration And Deployment

`wrangler.example.toml` is the committed configuration template. Production `wrangler.toml` is intentionally ignored because it contains the account-specific D1 database identifier. Create or update it locally from the template, then confirm these bindings before deployment:

- Custom domains for `aiopsterm.com`, `www.aiopsterm.com`, and `api.aiopsterm.com`.
- Static assets from `./dist` with `/v1/*` handled by the Worker first.
- D1 binding `DB` for the `aiopsterm-analytics` database.
- The migrations directory `migrations`.
- The scheduled cleanup trigger.
- Allowed production origins.

Local `.dev.vars` is also ignored. It contains these required secret names and must never be committed:

- `INSTALL_ID_HMAC_SECRET`
- `ADMIN_API_TOKEN`

The static build also accepts optional public values `PUBLIC_DISCORD_URL` and `PUBLIC_WECHAT_QR_URL` for community links. Because these values are embedded into generated pages, do not use them for secrets.

Configure production secrets through Wrangler rather than placing their values in tracked files:

```bash
npx wrangler secret put INSTALL_ID_HMAC_SECRET
npx wrangler secret put ADMIN_API_TOKEN
```

For a new D1 database, apply the committed migrations before the first deployment:

```bash
npx wrangler d1 migrations apply aiopsterm-analytics --remote
```

The deployment gate is:

```bash
npm ci
npm run build
npm test
npm run worker:test
npx wrangler deploy
```

After deployment, verify the English and Chinese home pages, the download page, and `GET https://api.aiopsterm.com/v1/releases/stable`. Also confirm that the administrator metrics endpoint rejects requests without the configured bearer token.

## Desktop Release Integration

The website download page does not discover desktop artifacts directly from a repository. It reads the stable release manifest from the website API. The Worker resolves that manifest in this order:

1. The `stable` row in the D1 `release_manifests` table.
2. The `RELEASE_MANIFEST_JSON` Wrangler variable.
3. A safe unavailable response with no artifacts.

Each published artifact entry supports `platform`, `arch`, `kind`, `sha256`, `urlGlobal`, and `urlChina`. Download URLs must use HTTPS. Keep the published SHA-256 value aligned with the package verification result from the desktop repository; see [Package Verification](../usage/package-verification.md).

Do not mark a release available until its artifacts are uploaded, their checksums are verified, and both global and mainland China URLs intended for publication are reachable.
