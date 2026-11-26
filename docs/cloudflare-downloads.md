# Downloads from the website (Cloudflare R2)

The website (on Vercel) sells and serves Scorpion. The files themselves live in a
Cloudflare R2 bucket: R2 has no per-file size limit (a GitHub release holds 2 GB, and
the Scorpion OS image with its models is bigger), 10 GB free storage, and **no download
fees**.

```
<bucket>/
  0.1.55/Scorpion Setup 0.1.55.exe        <- the Release workflow, on every v* tag
  0.1.55/Scorpion-0.1.55-arm64.dmg
  0.1.55/Scorpion-0.1.55.dmg
  os/scorpion-os-0.1-amd64.iso            <- the Scorpion OS workflow
  os/scorpion-os-0.1-amd64.iso.sha256
```

The website's download function (`website/api/download.js`) sends a buyer to
`<DOWNLOAD_BASE_URL>/<version>/<file>`, or `<DOWNLOAD_BASE_URL>/os/<file>` for the OS.

## One-time setup (about 15 minutes, in your own accounts)

### 1. Cloudflare R2

1. In the Cloudflare dashboard open **R2 Object Storage** and create a bucket, for
   example `scorpion-downloads`. (R2 asks for a payment card to switch on, and stays
   free within 10 GB.)
2. Make the files reachable by link. Pick one:
   - **Custom domain (best):** bucket **Settings → Custom Domains → Connect domain**,
     e.g. `downloads.yourdomain.com` (the domain must be on Cloudflare).
   - **Quick start:** bucket **Settings → Public Development URL → Enable**, which gives a
     `https://pub-….r2.dev` address (fine to start, rate-limited).
3. **R2 → Manage API tokens → Create API token**, permission **Object Read & Write**,
   limited to that bucket. Keep the **Access Key ID**, **Secret Access Key** and your
   **Account ID** (shown on the R2 overview page).

### 2. GitHub secrets

In the repo: **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Value |
|---|---|
| `R2_ACCOUNT_ID` | your Cloudflare account ID |
| `R2_ACCESS_KEY_ID` | the token's Access Key ID |
| `R2_SECRET_ACCESS_KEY` | the token's Secret Access Key |
| `R2_BUCKET` | the bucket name, e.g. `scorpion-downloads` |

Until all four are set, the workflows skip the R2 steps and nothing else changes.

### 3. The website and its backend on Cloudflare (a Worker)

The whole site runs on Cloudflare: the pages as static assets, and the three `/api` functions (checkout, order,
download) in one Worker, `website/worker.js`. They are the same Web `Request` to `Response` functions Vercel ran, so
nothing was rewritten. The Worker is also what keeps the bucket private: after the payment check it streams the file
out of R2 itself (with resume), so the file address never leaves the site.

1. In `website/wrangler.toml` the bucket name is `scorpion-downloads`; change both places if yours differs.
   Leave `DOWNLOAD_BASE_URL = "r2://scorpion-downloads"` for a private bucket. (To serve from a public bucket or custom
   domain instead, set it to that https address and remove the `[[r2_buckets]]` block.)
2. Deploy once from your computer (it asks you to sign in to Cloudflare in the browser):

   ```powershell
   cd website
   npx wrangler deploy
   npx wrangler secret put STRIPE_SECRET_KEY
   ```

   (`npx` downloads Wrangler, the Cloudflare tool, about 100 MB the first time.) The site is then live at
   `scorpion-website.<your account>.workers.dev`; **Workers & Pages → scorpion-website → Settings → Domains** adds your
   own domain.
3. For automatic deploys, add two more GitHub secrets, `CLOUDFLARE_API_TOKEN` (a token with the **Edit Cloudflare
   Workers** template) and `CLOUDFLARE_ACCOUNT_ID`. The Website workflow then deploys whenever `website/` changes on
   `main`, including the version bump a release makes.

With the Worker streaming the files, the bucket needs **no public address**: skip step 1.2's public URL if you only
sell through the site.

## What GitHub does by itself, once the six secrets are set

| You push | GitHub then |
|---|---|
| a tag `v0.1.61` | builds Windows and Mac, publishes the GitHub release, copies the installers to the bucket (`0.1.61/`), sets the website's version, and deploys the website |
| a tag `os-v0.2` (or runs the Scorpion OS workflow) | builds the OS image, boots it in the QEMU test, copies the ISO to the bucket (`os/`), sets the website's OS version, and deploys the website |
| any change under `website/` to `main` | deploys the website |

The six secrets (**Settings → Secrets and variables → Actions**): `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
`R2_BUCKET` (the bucket and what goes in it) and `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` (deploying the site). A workflow
whose secrets are missing skips its Cloudflare steps and says so in a yellow warning on the run's page, so a release never fails
for want of them. The Windows and Mac installers on the Download page also follow every GitHub release by themselves, with or
without the bucket.

## What happens on a release

- **Push a `v*` tag.** The Release workflow builds the installers, publishes the GitHub
  release, copies the installers to `<bucket>/<version>/`, and then commits
  `CURRENT_VERSION` in `website/data/catalog.js` to `main`. The Website workflow redeploys, and the site
  now sells and serves that version.
- **Run the Scorpion OS workflow** (or push an `os-v*` tag). After the ISO has booted in
  the QEMU test, it is copied to `<bucket>/os/`. Set `OS_VERSION` in
  `website/data/catalog.js` to the version you built so the file name matches
  (`scorpion-os-<OS_VERSION>-amd64.iso`).
- **Release notes on the Updates page** are still written by hand: add an entry at the top
  of `website/data/updates.js`.

## Free downloads instead of paid

The Stripe checkout is unchanged. To offer a free download, point a button at
`<DOWNLOAD_BASE_URL>/<version>/<file>` directly instead of calling `/api/download`.
Remember that anyone with the link (or the bucket's public address) can download, and the
paid editions only protect the link, not the file.

## Linux packages

The `.deb` and AppImage come from the Scorpion OS workflow's first job; they are not copied
to R2 yet.
