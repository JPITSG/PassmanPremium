# Passman Premium

A Firefox password-manager extension for self-hosted Nextcloud Passman
servers. Passman Premium is an actively maintained fork of the dormant
Nextcloud Passman web extension, carrying it forward with current security,
privacy, localization and accessibility work.

## Features

- **Client-side encrypted vaults** — credentials are encrypted in the browser
  (AES-256-CCM via Stanford's sjcl) before they ever reach your server.
- **Autofill** with origin-scoped matching (scheme + host + port by default),
  an in-field password picker, a right-click context menu, and save/update
  prompts for new or changed logins — including change-password forms.
- **Password generator** with configurable character classes and per-field
  refill; custom fields and OTP/TOTP codes supported.
- **Multiple Nextcloud accounts** and shared (team) credentials.
- **Themes** (system / light / dark), **46 locales**, and a
  keyboard-accessible, ARIA-annotated UI.
- **HTTPS-only** server connections, **no analytics, no telemetry, no
  third-party data flows**.

## Requirements

- Firefox **140 or later** (desktop).
- A Nextcloud server reachable over **HTTPS** with the
  [Passman app](https://apps.nextcloud.com/apps/passman) installed.

## Install

- **From the package:** download `passman-premium.xpi`, then
  `about:addons` → gear icon → *Install Add-on From File…*
- **For development:** `about:debugging` → *This Firefox* →
  *Load Temporary Add-on…* → select `manifest.json` from this directory.

## Build from source

The package is a plain zip of the extension directory (also what CI/release
tooling should produce):

```sh
zip -q -r -X passman-premium.xpi css fonts html icons js _locales LICENSE PRIVACY.md manifest.json
```

The built xpi is intentionally not tracked in git (see `.gitignore`).

## Project layout

- `manifest.json` — MV2 manifest: identity, permissions, data-collection
  declaration, content scripts.
- `js/background/service/` — background service: vault sync, credential
  matching, message routing, context menus, HTTP auth.
- `js/background/inject/` + `js/lib/` — content scripts: form detection,
  autofill, in-field picker buttons, form mining.
- `js/ui/popup/` — browser-action UI (AngularJS): list, search, edit,
  settings, setup wizard, unlock prompt.
- `js/ui/password_picker/`, `js/ui/doorhanger/`, `js/ui/auto_login_popup/` —
  in-page iframes.
- `js/lib/api.js` — Nextcloud Passman API client and the sjcl encryption
  layer.
- `js/vendor/` — third-party libraries: jQuery 3.7.1, AngularJS 1.8.3,
  sjcl 1.0.8, Font Awesome, Material Design Icons.
- `css/`, `html/`, `icons/`, `fonts/`, `_locales/` — styling, views, assets,
  and the 46 locale catalogs.

## Security model

- **Vault contents:** every credential field is encrypted client-side with
  sjcl AES-256-CCM under your vault password; PBKDF2 key derivation with
  per-message embedded parameters (so older data keeps decrypting).
- **Local settings** (including account secrets): encrypted under your master
  password with a hardened 100,000-iteration PBKDF2 profile.
- **Remembered master password:** stored only on-device, encrypted under a
  random per-device key; never transmitted.
- **Fail-closed decryption:** fields that fail authenticated decryption are
  never surfaced as ciphertext, and damaged records cannot be silently
  overwritten.
- **Origin-scoped matching:** scheme + full host + port by default, current
  public-suffix data for tenant separation; secrets are routed only to the
  exact frame that requested them.
- **HTTPS-only servers;** no downgrade paths.

## Privacy

See `PRIVACY.md`. The extension declares `authenticationInfo` and
`browsingActivity` via `data_collection_permissions` in the manifest — data
flows only to the Nextcloud server you configure, nowhere else.

## Localization & accessibility

46 complete locale catalogs (contributions welcome). Controls are keyboard
operable with ARIA roles/labels, visible focus indicators, and focus
management in dialogs.

## Credits

- [Nextcloud Passman web extension](https://github.com/nextcloud/passman-webextension)
  (AGPL) by the Nextcloud community — the upstream project this fork carries
  forward.
- [sjcl](https://github.com/bitwiseshiftleft/sjcl) (BSD/GPL),
  [jQuery](https://jquery.com) (MIT), [AngularJS](https://angularjs.org)
  (MIT), [Font Awesome](https://fontawesome.com) (CC BY 4.0 / SIL OFL),
  [Material Design Icons](https://materialdesignicons.com) (Apache 2.0).

## License

GNU Affero General Public License v3 — see `LICENSE`. Carries forward the
upstream project's terms.
