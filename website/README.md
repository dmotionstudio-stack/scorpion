# Scorpion website

The public site for Scorpion (**scorpionai.tech**): home page, updates, install guide, free downloads of the Windows and
Mac installers, and a store where people pay once for more (Scorpion OS, the offline model pack) or order Scorpion on a USB
stick, then sign in to download again.

Plain HTML, CSS and JavaScript with no build step and no npm packages. It runs on Cloudflare (see
[Cloudflare](#cloudflare-the-site-its-backend-and-the-files)). Payments go through Stripe Checkout, so card details never
touch this site.

| Page | What it is |
|---|---|
| `index.html` | Home: the hero (the orb that turns into the humanoid and back), what the humanoid can do, ways to run it, pricing, latest updates |
| `download.html` | The free Windows and Mac downloads (always the newest release), the editions, comparison, USB sticks, checkout dialog |
| `features.html`, `orb.html`, `os.html` | What Scorpion does, the ORB (the live orb, the humanoid and the transformation between them), and Scorpion OS |
| `account.html` | My downloads: sign in with an email and a code to see paid orders and download again (see *Customer sign-in*) |
| `usb.html` | The USB stick product page: images, both sizes side by side, what is on it, ordering. `assets/usb-*.svg` are the product images; `usb-*-listing.svg` are the same on white for marketplace listings |
| `updates.html` | News and release notes, filterable |
| `guide.html` | Install steps (Windows, Mac, USB), requirements, FAQ |
| `success.html` | Where Stripe sends buyers back: their download links and USB status |

## The ORB and the humanoid

The site shows the real Interact orb and the real orb humanoid from the app, running live in the page. three.js 0.186.1, the same
version the app uses, loads from jsDelivr (the pages that show them have an import map). Each one renders only while it is on screen,
and visitors who prefer reduced motion get the quiet version.

| File | What it is |
|---|---|
| `assets/orb/orb.js` | An exact copy of `src/renderer/orb.js`, the orb sphere. A test fails if they differ: copy it again after changing the app's orb. |
| `assets/orb/humanoid.js` | An exact copy of `src/renderer/humanoid.js`, the humanoid, kept the same way by a test. |
| `assets/forms-core.js` | One orb or humanoid in a box, and the **slow transformation** between them (the app's `switchLook`: the orb folds into a point of light and the humanoid grows from it, and back). It also gives them states, the voice level, the gaze and a pointer. |
| `assets/forms-site.js` | The "orb or humanoid" section: state buttons (Standby, Listening, Thinking, Speaking), a Transform button, a replay of the humanoid's random entrance, a caption and the voice commands that do the same in the app. It follows the pointer. |
| `assets/orb-site.js` | The **home page hero** and the **ORB page demo**. The hero's orb rises over the horizon, drifts through its states, and now and then turns into the humanoid standing on the horizon, and back. The demo is the orb with the apps ring: pick a state, spin it, click a shortcut. |
| `assets/orb-shortcuts.js` | The apps that orbit the orb (Chat, Agent, Voice, Documents, Memory, Agents, Schedule, People), used by the demo and by the orb in the "orb or humanoid" section. The humanoid has none. They are left out on phone widths. |

Where it appears: the home page (hero, then "What the humanoid can do": listens, talks, sees you, follows your hands, reacts, does as
you say) and the ORB page (the state demo, the orb or humanoid section, what each state means, the gesture table, the orb as the system).

## Languages and voice on the site

The pages say what the app does, so they change when it does: the Guide's FAQ lists the languages (38: natural built-in voices for
English, French, Spanish, Italian, Portuguese, Hindi and Haitian Creole; small downloads for German, Russian, Arabic, Vietnamese,
Korean, Romanian and Yoruba; the computer's own voice for the rest), better listening, waking by claps and snaps, and the voice
commands that switch things. `assets/orb-shortcuts.js` carries the language count too.

## Change prices, editions or USB sticks

Edit [`data/catalog.js`](data/catalog.js). The pages and the checkout API both
read it, and the API always charges the catalog price, never a price sent by the
browser. `CURRENT_VERSION` is the version on sale.

## Post an update

Add an entry at the top of [`data/updates.js`](data/updates.js). It shows on the
Updates page and the newest three show on the home page. Each release has its notes in the app's repo
(`docs/releases/vX.Y.Z.md`); an entry summarizes a few releases that belong together rather than repeating every one. The
Windows and Mac installers on the Download page need no entry: they follow the newest GitHub release by themselves.

## Run it locally

```bash
node dev-server.mjs
```

Then open http://localhost:4321. Without a Stripe key the checkout button says
payments aren't switched on yet (demo mode). To test real checkout, use a Stripe
test key and card `4242 4242 4242 4242`:

```bash
STRIPE_SECRET_KEY=sk_test_... DOWNLOAD_BASE_URL=https://your-file-host/scorpion node dev-server.mjs
```

## Free downloads

The top of the Download page offers the Windows and Mac installers (Apple Silicon and Intel) to everyone, always the newest
version, with no update to the site needed:

- `GET /api/latest` reads the newest GitHub release (the repo is public; Cloudflare caches the answer for ten minutes; set
  `GITHUB_TOKEN` for a higher rate limit, `GITHUB_REPO` to point at another repo) and lists its installers. The page
  (`assets/latest.js`) draws a card for each, with its size. If GitHub cannot be reached it shows a link to the release page.
- `GET /dl/win`, `/dl/mac-arm`, `/dl/mac-intel` send the visitor to the file: from our own bucket when the release workflow
  has copied it there (streamed by the Worker), from the GitHub release otherwise.
- The Mac installers from 0.1.65 on are signed with an Apple Developer ID and notarized, so they open without the "unidentified
  developer" warning, and installed Mac copies update themselves like Windows ones (the release carries the `.zip` files and
  `latest-mac.yml` for that; see `docs/signing-mac.md` in the app's repo). The Install guide's Mac steps say so; the "Open Anyway"
  steps are kept for older versions.
- Only these three are free. The OS image, the model pack, Linux packages and USB sticks are in the editions (`/dl/os`
  and the rest answer 404).

## How buying works

1. The buyer picks an edition (and, for Standard, Windows, Mac or Linux), optionally a
   USB stick, and clicks **Continue to secure payment**.
2. `POST /api/checkout` prices the order from the catalog and creates a Stripe
   Checkout Session. USB orders also collect a shipping address and speed.
3. After paying, Stripe sends the buyer to `success.html?session_id=...`, which
   calls `GET /api/order` to show what they bought.
4. Each download button is `GET /api/download?session_id=...&file=win`. It asks
   Stripe that the order is paid and includes that file, then redirects to
   `<DOWNLOAD_BASE_URL>/<version>/<file name>` (the Scorpion OS image: `<DOWNLOAD_BASE_URL>/os/<file name>`). With
   `DOWNLOAD_BASE_URL = r2://<bucket>` (the Worker) the bucket stays private and the Worker streams the file itself, with
   resume, so the address is never shared.

Standard and Complete download the version they bought, forever. Lifetime always
gets `CURRENT_VERSION`. USB orders show up in the Stripe dashboard with the
shipping address; fulfil them from there.

## Files to upload

For each version, put these in `<DOWNLOAD_BASE_URL>/<version>/`:

- `Scorpion Setup <version>.exe` (Windows)
- `Scorpion-<version>-arm64.dmg` (Apple Silicon) and `Scorpion-<version>.dmg` (Intel)
- `scorpion_<version>_amd64.deb` and `Scorpion-<version>.AppImage` (Linux)
- `scorpion-os-<OS_VERSION>-amd64.iso` (Scorpion OS, for Complete and Lifetime)
- `Scorpion-<version>-model-pack.zip` (the `.gguf` files for Complete and Lifetime)

These are the names the builds write (the GitHub release turns the spaces in
the Windows name into dots; the release workflow puts it in the bucket under the name above). `OS_VERSION` is in
`data/catalog.js`, since Scorpion OS is versioned apart from the app, and the Scorpion OS image lives under `os/`.

You do not upload these by hand: with the Cloudflare secrets set, GitHub copies each release and the OS image to the bucket
(see below). With a public `https://` `DOWNLOAD_BASE_URL` instead of `r2://`, the redirect reveals the file address, so
anyone a buyer shares it with can download too; the private bucket does not.

## Cloudflare: the site, its backend and the files

The whole site runs on Cloudflare: `worker.js` is one Worker that serves the `/api` functions and `/dl` (the files are the
same Web `Request` to `Response` functions used everywhere), the pages go out as static assets (`.assetsignore` keeps the
server code and tooling out), `wrangler.toml` holds the settings (the custom domains `scorpionai.tech` and
`www.scorpionai.tech`, the private R2 bucket `DOWNLOADS`, the KV namespace `AUTH_KV` for sign-in).

```bash
cd website
npx wrangler deploy                          # once by hand, or let GitHub do it
npx wrangler secret put STRIPE_SECRET_KEY    # and the other secrets listed under Customer sign-in
```

On Windows PowerShell use `npx.cmd` in place of `npx` (a Windows setting blocks `npx.ps1`). The Website workflow deploys by itself whenever
`website/` changes on `main` (it needs the repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`). Secrets saved with
`wrangler secret put` stay on the Worker; a deploy does not remove them. Stripe keys: the secret key starts `sk_live_` (or a restricted
`rk_live_` with Checkout Sessions = Write), never the publishable `pk_`; the webhook secret is the endpoint's `whsec_`.

GitHub does the rest when you release (the secrets to set once, and the full picture, are in
[../docs/cloudflare-downloads.md](../docs/cloudflare-downloads.md)):

- a `v*` tag: the Release workflow publishes the GitHub release, copies the installers to the bucket, sets
  `CURRENT_VERSION` here, and starts the Website workflow;
- the Scorpion OS workflow: copies the ISO to the bucket, sets `OS_VERSION`, starts the Website workflow;
- any change under `website/` on `main`: the Website workflow tests the Worker and deploys it.

Each workflow skips its Cloudflare steps, with a yellow warning on its run, when its secrets are not set.

## Other places to run it (Hugging Face, Vercel)

These serve the pages and the checkout, order and download functions, but not what needs the Worker: the `r2://` private
bucket, the free `/dl` route and sign-in (KV). Cloudflare is the supported home.

## Deploy (Hugging Face Space)

The site runs as a Docker Space: `Dockerfile` starts `dev-server.mjs` on port
7860, so the pages and the `/api` checkout functions both work.

1. Create a Space at huggingface.co/new-space with the **Docker** SDK (Blank).
2. Push this folder's files to the Space's git repository, with
   `hf-space/README.md` as the Space's `README.md` (Hugging Face reads its
   settings from that file's header).
3. In the Space's **Settings → Variables and secrets**, add `STRIPE_SECRET_KEY`,
   `DOWNLOAD_BASE_URL` and `SITE_URL` as secrets.

## Deploy (Vercel)

1. Create a Vercel project with **Root Directory** set to `website`.
2. Add the environment variables from `.env.example`.
3. Deploy. `api/*.js` become serverless functions; everything else is static.

In the Stripe dashboard, turn on **Settings → Customer emails → Successful
payments** so buyers get the receipt the site mentions.

The support address is `support@scorpionai.tech` (a Zoho Mail mailbox) in `assets/site.js`, `success.html` and `lib/mailer.js`
(where it is also the Reply-To of the sign-in code emails, which are sent from `login@scorpionai.tech`). Before going live, check the
refund promise in the Download page FAQ matches your policy.

## Photo credit

`assets/usb-photo.jpg` on the USB page is "black thumb drive" by Sara Kurfeß on
Unsplash (https://unsplash.com/photos/black-thumb-drive-9Eid2zc_Veo), free to use
under the Unsplash license. It's a stand-in: replace it with a photo of the real
Scorpion stick when you have one.

## Customer sign-in (My downloads)

`account.html` lets a customer sign in with their email and a 6-digit code (no password) and see every paid
order with its download links, whenever they want to download again.

- **How it works:** `POST /api/auth-request` emails a code (only to an address that has paid; the answer is the
  same either way), `POST /api/auth-verify` checks it and sets a signed cookie for 30 days, `GET /api/library`
  lists the signed-in customer's orders, `POST /api/auth-logout` signs out. A code works once for 10 minutes, five
  wrong guesses throw it away, and requests are rate limited. The code itself is never stored, only a hash.
- **Where the orders come from:** a Stripe webhook (`POST /api/stripe-webhook`) and the payment-success page add
  each paid order to an index in KV (by lowercase email); Stripe is asked too when the index can't be trusted yet.
- **Setup:** `AUTH_KV` (KV namespace, created by `wrangler deploy`), and the secrets `RESEND_API_KEY`,
  `SESSION_SECRET`, `STRIPE_WEBHOOK_SECRET`, plus `MAIL_FROM` (see `.env.example`). Resend must have the sending
  domain verified. In Stripe add a webhook to `https://<your site>/api/stripe-webhook` for
  `checkout.session.completed` and `checkout.session.async_payment_succeeded`.
- Without those, the page says signing in isn't switched on yet. Only the Worker keeps its data in KV; the local
  preview server (`node dev-server.mjs`) keeps it in memory, so try it with `STRIPE_API_BASE` and
  `RESEND_API_BASE` pointed at fakes (see `test/website-auth.test.js` for what the fakes answer).
