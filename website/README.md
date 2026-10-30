# Scorpion website

The public site for Scorpion: home page, updates, install guide, and a store
where people pay once and download, or order Scorpion on a USB stick.

Plain HTML, CSS and JavaScript with no build step and no npm packages. Payments
go through Stripe Checkout, so card details never touch this site.

| Page | What it is |
|---|---|
| `index.html` | Home: features, privacy, pricing, latest updates |
| `download.html` | Editions, comparison, USB sticks, checkout dialog |
| `updates.html` | News and release notes, filterable |
| `guide.html` | Install steps (Windows, Mac, USB), requirements, FAQ |
| `success.html` | Where Stripe sends buyers back: their download links and USB status |

## The ORB

The home page shows the real Interact orb from the app. `assets/orb/orb.js` is
an exact copy of `src/renderer/orb.js` (a test fails if they differ, so copy it
again after changing the app's orb), and `assets/orb-site.js` puts it on the
page. three.js 0.186.1, the same version the app uses, loads from jsDelivr.
Each orb renders only while it's on screen.

## Change prices, editions or USB sticks

Edit [`data/catalog.js`](data/catalog.js). The pages and the checkout API both
read it, and the API always charges the catalog price, never a price sent by the
browser. `CURRENT_VERSION` is the version on sale.

## Post an update

Add an entry at the top of [`data/updates.js`](data/updates.js). It shows on the
Updates page and the newest three show on the home page.

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

## How buying works

1. The buyer picks an edition (and, for Standard, Windows, Mac or Linux), optionally a
   USB stick, and clicks **Continue to secure payment**.
2. `POST /api/checkout` prices the order from the catalog and creates a Stripe
   Checkout Session. USB orders also collect a shipping address and speed.
3. After paying, Stripe sends the buyer to `success.html?session_id=...`, which
   calls `GET /api/order` to show what they bought.
4. Each download button is `GET /api/download?session_id=...&file=win`. It asks
   Stripe that the order is paid and includes that file, then redirects to
   `<DOWNLOAD_BASE_URL>/<version>/<file name>`.

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
the Windows name into dots, so rename it back). `OS_VERSION` is in
`data/catalog.js`, since Scorpion OS is versioned apart from the app.

The redirect reveals the final file address, so anyone a buyer shares it with
can download too. If that matters, host the files somewhere that issues
short-lived signed links (S3, R2) and sign them in `api/download.js`.

## Deploy (Vercel)

1. Create a Vercel project with **Root Directory** set to `website`.
2. Add the environment variables from `.env.example`.
3. Deploy. `api/*.js` become serverless functions; everything else is static.

In the Stripe dashboard, turn on **Settings → Customer emails → Successful
payments** so buyers get the receipt the site mentions.

Before going live, replace the placeholder support address
(`support@scorpion.app`) in `assets/site.js` and `success.html`, and check the
refund promise in the Download page FAQ matches your policy.
