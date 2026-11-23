# Signing the Windows installer

Today the Windows installer is **not signed**, so Windows SmartScreen says "Windows protected your PC" (**More info → Run anyway**).
The release workflow (`.github/workflows/release.yml`) is already set up to sign: it signs on its own as soon as a signing account is
configured below, and then **checks the signature and stops the release if it is not valid**. With nothing configured it builds
unsigned installers like before and shows a warning in the run.

Signing needs an account in your name, a verified identity and (for most routes) a payment, so only you can set it up. Nobody else can
create it for you. Pick one route.

## Route 1: Azure Trusted Signing (recommended, about $10 a month, works in GitHub Actions)

Microsoft's own signing service. It is the only route where a certificate is kept for you and there is no hardware token. Installers it
signs get Microsoft's reputation straight away, so SmartScreen stops warning much sooner than with a new ordinary certificate.

1. In the Azure portal, create a **Trusted Signing account** (any region; note its endpoint, for example
   `https://eus.codesigning.azure.net`).
2. **Identity validation**: add your identity (an individual in the US or Canada, or an organisation in the US, Canada, the EU or the UK).
   Microsoft checks it; it can take a few days.
3. Create a **certificate profile** of type **Public Trust**.
4. Create an app registration (a service principal) and give it the role **Trusted Signing Certificate Profile Signer** on the
   Trusted Signing account. Make a client secret for it.
5. In the GitHub repository, **Settings → Secrets and variables → Actions**:
   - **Secrets:** `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`
   - **Variables:** `AZURE_SIGNING_ENDPOINT` (the endpoint), `AZURE_SIGNING_ACCOUNT` (the Trusted Signing account name),
     `AZURE_SIGNING_PROFILE` (the certificate profile name), `SIGNING_PUBLISHER_NAME` (the name on the certificate: the subject of the
     certificate profile, exactly as Azure shows it).
6. Push a tag. In the run, the Windows job says "Signing the Windows installer with Azure Trusted Signing" and the step
   **Check the Windows signature** prints `Valid` with the publisher.

## Route 2: SignPath Foundation (free for open-source projects)

The repository is public, so it can apply at signpath.org for free signing of open-source releases. They review the project, then give
you a signing policy and a GitHub Action. That action replaces the build-and-sign step (the installer is built, uploaded to SignPath,
signed and downloaded), so this route needs a small change to the workflow once you have their organisation and project ids. Ask for
that change when you have them.

## Route 3: a certificate file (.pfx)

Since 2023 most authorities keep the private key on a hardware token or in their cloud, so a downloadable `.pfx` is rare. If you do
have one: add the secrets `WIN_CSC_LINK` (the file as base64, or a link to it) and `WIN_CSC_KEY_PASSWORD`. The workflow then signs
with it (electron-builder reads those two names for Windows only). A self-made certificate signs, but Windows still does not trust it
on other computers, so it does not remove the warning.

## After the first signed release

- Remove the sentence about the unsigned installer from `docs/releases/<tag>.md` for new releases.
- To make the self-updater refuse an update that is not signed by you, set `build.win.publisherName` in `package.json` to the same
  name as the certificate. Do it only once a signed release is out, because an installed copy that has it will refuse unsigned updates.
- The Mac installers are separate: they need an Apple Developer account (`CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID` secrets).
