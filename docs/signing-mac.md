# Signing the Mac app (Apple Developer ID)

Without this, the Mac app is signed "ad hoc": it runs, but macOS can't verify who made it, so it cannot replace itself.
Scorpion tells you a new version is out and opens the download, and you drag the new app over the old one.

With an Apple **Developer ID** the release workflow signs and **notarizes** both Mac builds (Apple Silicon and Intel). Then:

- installed Mac copies update themselves like Windows ones do: the new version downloads in the background and installs when Scorpion
  restarts (or with "Restart and update" in Settings → General → Updates);
- macOS opens the app without the "unidentified developer" warning.

Scorpion checks its own signature when it starts (`codesign`). A copy that isn't Developer-ID-signed keeps the download-it-yourself
behaviour, so nothing breaks for people on older, unsigned installs.

## What you need (once)

1. **Join the Apple Developer Program** (developer.apple.com/programs, about 99 USD a year). Note your **Team ID** (Membership details).
2. **Create the certificate.** On a Mac: Xcode → Settings → Accounts → Manage Certificates → **+** → **Developer ID Application**.
   (Or developer.apple.com → Certificates → Developer ID Application, with a certificate request from Keychain Access.)
3. **Export it.** Keychain Access → My Certificates → right-click "Developer ID Application: …" → Export → a `.p12` file with a password.
   Make it a single line of text:

   ```
   base64 -i certificate.p12 | pbcopy
   ```
4. **An app-specific password** for notarization: appleid.apple.com → Sign-In and Security → App-Specific Passwords.
5. **Add five secrets** to the GitHub repository (Settings → Secrets and variables → Actions → New repository secret):

   | Secret | Value |
   |---|---|
   | `MAC_CSC_LINK` | the base64 text of the `.p12` |
   | `MAC_CSC_KEY_PASSWORD` | the `.p12`'s password |
   | `APPLE_ID` | the Apple ID's email |
   | `APPLE_APP_SPECIFIC_PASSWORD` | the app-specific password |
   | `APPLE_TEAM_ID` | the Team ID |

That's all. The next tagged release signs and notarizes by itself (notarization adds a few minutes to each Mac job).
With any of the five missing, the workflow warns and builds the ad-hoc copy as before.

## How the release uses it

- `.github/workflows/release.yml` gives the secrets to the Mac jobs only (never the Windows one), builds with `-c.mac.notarize=true`, then
  **checks** the result (`codesign`, `stapler validate`, `spctl`): a certificate set up wrongly stops the release instead of shipping a
  Mac app that Gatekeeper rejects.
- Each Mac build also makes a `.zip` (what the updater downloads) and a `latest-mac.yml`. The two architectures write their own, so the
  publish job renames them and `scripts/merge-mac-yml.mjs` merges them into the one `latest-mac.yml` on the release.

## One manual step for current Mac users

An installed copy that was signed ad hoc cannot update itself into a signed one: the first Developer-ID release has to be downloaded
and dragged into Applications once, as before. From then on, updates install by themselves.

## Checking by hand

```
codesign -dv --verbose=2 /Applications/Scorpion.app 2>&1 | grep Authority   # Developer ID Application: …
spctl -a -t exec -vv /Applications/Scorpion.app                              # accepted, source=Notarized Developer ID
```
