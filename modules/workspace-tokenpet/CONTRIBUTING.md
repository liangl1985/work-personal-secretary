# Contributing

Thanks for improving workspace-tokenpet.

## Development setup

```powershell
git clone https://github.com/liangl1985/work-personal-secretary.git
Set-Location work-personal-secretary/modules/workspace-tokenpet
npm install
npm run build
```

Node.js `>=22.19` is required.

## Required checks

Before opening a pull request:

```powershell
npm run typecheck
npm test
npm run build
npm pack --dry-run --json
```

## Pull requests

- Keep each PR focused on one behavior or maintenance concern.
- Explain user-visible effects and migration impact.
- Add or update tests for behavior changes.
- Do not commit generated videos, ZIP files, local session data, credentials, npm tokens, recovery codes, or build output.
- UI changes should include privacy-safe screenshots from the real DSH interface where possible.
- Animation changes must preserve 32 frames, 100ms timing, feet anchoring, per-cell clipping, and no-canvas playback.
- Skin packs live in `skins/<pack-id>/`; a pack is a directory with `manifest.json` plus one strip per action, deployed at install time to `~/.dsh/data/workspace-tokenpet/skins/`.

## Commit style

Use short imperative subjects, for example:

```text
Fix prompt action hand-off
Add index timeout regression
Update skin pack discovery
```

## Reporting bugs

Use GitHub Issues for ordinary bugs and feature requests. Security issues must follow [SECURITY.md](SECURITY.md).
