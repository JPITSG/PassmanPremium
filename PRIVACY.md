# Privacy Policy — Passman Premium

_Last updated: 2026-07-21_

Passman Premium ("the extension") is a password manager developed by JP IT
Services Pte. Ltd. This policy explains what data the extension handles, where
it goes, and what never leaves your browser.

## Data the extension transmits

The extension sends data to exactly one destination: **the Nextcloud server
that you configure yourself** (self-hosted or chosen by you). Nothing is sent
to JP IT Services or to any third party.

Specifically, the following data is transmitted to your configured Nextcloud
server:

- **Account authentication information** — the server address, username and
  password you enter when adding an account, used to authenticate against
  your Nextcloud server.
- **Vault contents** — the credentials stored in your vaults: labels,
  usernames, passwords, email addresses, URLs, notes, custom fields, file
  references and one-time-password (OTP) secrets, including entries the
  extension offers to save when you log in to websites.
- **Website addresses (URLs)** — the addresses of pages for which you save or
  update a credential, so the extension can suggest matching logins later.

Credential fields above are encrypted in the extension before transmission
using your vault password; your Nextcloud server stores them encrypted.

## Data stored locally, never transmitted

- Your **settings**, including account configuration, are stored encrypted in
  the extension's local storage under your master password.
- If you enable **remember master password**, the master password is stored
  only on your device, encrypted under a random per-device key. It is never
  transmitted anywhere.
- Extension preferences (theme, matching options, ignored sites) are stored
  locally in the browser.

## What the extension does not do

- No analytics, telemetry, crash reporting or usage metrics.
- No advertising, no tracking, no cookies set by the extension.
- No data is sold, rented or shared with third parties.
- No data is sent to the extension developer.

## Retention and deletion

- Using **Reset extension** (from the unlock screen) erases all locally stored
  settings, accounts and the remembered master password.
- Credentials and vaults stored on your Nextcloud server remain under your
  control and are governed by your own Nextcloud instance's policies; the
  extension does not retain copies beyond its local cache, which is cleared
  on lock and on reset.

## Changes

If this policy changes, the updated version will ship with the extension.

## Contact

JP IT Services Pte. Ltd. — privacy questions about this extension may be
raised through the extension's support channel listed on its add-on page.
