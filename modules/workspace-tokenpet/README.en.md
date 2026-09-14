# workspace-tokenpet

> **A standalone project module**: a desktop pet plugin for DSH (DeepSeek Harness) — a floating pet in the
> browser plus usage/context panels. Naming, package metadata, documentation, sources, build output and
> character art are all **self-contained in this directory**: no upstream checkout, no patch application,
> no baseline tracking. The original source project `dsh-token-pet` is referenced only in
> [Acknowledgements](#acknowledgements).

---

## 1. What it is

One DSH plugin with a **host half and a browser half**:

- **Host half** (`lib/`, compiled from `src/*.ts`): exact routes for skin listing and per-file serving,
  usage aggregation, the lifetime ledger, hourly-trend maintenance, index status, and prompt enhancement.
- **Browser half** (`client/client.js`, bundled from `src/client/**` by tsdown): renders the floating pet,
  plays action strips, and provides the "desktop character" settings section and the prompt panel.
- **Pluggable characters**: packs are discovered from the data directory **at runtime** — adding or removing
  a character needs no rebuild and no restart.

## 2. Features

### 2.1 Runtime skin packs
- The host scans `~/.dsh/data/workspace-tokenpet/skins/<pack-id>/`, reads `manifest.json`, and validates
  schema, the action-name whitelist, and **path traversal** (`isSafeSkinId` / `isSafeSkinFile`) before serving.
- Two exact routes: `GET /workspace-tokenpet/skins` (listing) and
  `GET /workspace-tokenpet/skins/file?id=&file=` (one file); a prefix form is also registered for open-web
  carriers. Strips are fetched through the client bridge and handed to the player as **blob URLs**
  (the desktop carrier resolves exact routes only — a static prefix route 404s there).
- An `actionSpecs` prop makes the strip source "current pack first, built-in fallback"; the `rows` field is
  **forwarded** to the client — one built-in action is `cols:16 / rows:2`, so a missing `rows` mis-slices a
  single-row strip at 720px per cell (the "two thin figures" symptom).

### 2.2 Action playback
12 actions (`idle / working / eating / digesting / warning / evolve / click / archive / tool-success /
tool-failure / prompt-enhancing / prompt-ready`), 32 frames at 100ms, per-cell clipping, feet anchoring,
no-canvas playback, with horizontal mirroring and pingPong loops.

### 2.3 Usage and context panels
- `GET /workspace-tokenpet/usage`, plus `POST /usage/reset` (clear) and `POST /usage/restore` (undo);
- lifetime ledger: `GET /usage/lifetime`, `POST /usage/lifetime/clear-history`;
- hourly trend: `GET /usage/trend`, `/usage/trend/status`, `/usage/trend/repair`, `/usage/trend/repair/cancel`
  (guarded by `supportsSnapshots()` so a host without `listSnapshots()` degrades gracefully);
- index maintenance: `GET /index/status`, `POST /index/build`, `/index/sync`, `/index/cancel`.

### 2.4 Prompt enhancement
`POST /workspace-tokenpet/prompt/enhance` — user-triggered; complete prompts are never logged.

### 2.5 Settings and default character
Preferences live in browser localStorage (key `workspace-tokenpet.settings.v1`). The skin panel lists the
available packs with action counts and a preview, and offers "**set as default**" (`defaultSkinId`, kept
separate from the currently used pack).

### 2.6 Bundled art
Three packs under `skins/`, **42 files** in total (each pack: `manifest.json` + 12 action strips + `preview.webp`):

| Pack | Origin | License |
|---|---|---|
| `default` | Upstream built-in character | MIT (see the pack `author` field) |
| `lina-pure` | Art owned by this project | Distributed with this repository; do not redistribute or use commercially without permission |
| `lina-lazy` | Art owned by this project | Same as above |

## 3. Installation

### 3.1 With the integrator (recommended)
The `work-personal-secretary` installer copies `<repoRoot>/modules/workspace-tokenpet` into
`<profile>/node_modules/workspace-tokenpet` and registers it in the profile's `dsh.profile.bundles`
(atomic replace, per-file SHA256 verification, rollback on any failure).

The installer then **deploys the character art** into the runtime directory:

- target: `~/.dsh/data/workspace-tokenpet/skins/<pack-id>/` — **fill gaps only, never overwrite** art the
  user has edited;
- **data-directory migration**: if the new location lacks a pack that exists under the legacy
  `~/.dsh/data/dsh-token-pet/skins/`, it is **copied** over (legacy data is kept; existing content is never
  overwritten);
- a single failing pack only cleans up its own partial copy and **never fails the install**.

### 3.2 Manual mount (development)
~~~powershell
dsh plugin --profile desktop add link:<absolute path to this module>
~~~
Restart DSH Desktop after host-half changes; a page refresh is enough for client-only changes.

### 3.3 Runtime directories
| Path | Purpose |
|---|---|
| `~/.dsh/data/workspace-tokenpet/skins/` | Character packs (read at runtime; add or remove freely) |
| `~/.dsh/data/workspace-tokenpet/` | Runtime data such as the usage baseline |

## 4. Development and build

~~~powershell
npm install
npm run typecheck      # tsc -p tsconfig.json --noEmit && tsc -p tsconfig.client.json --noEmit
npm run build          # build:host (tsc) + build:client (tsdown)
npm test               # build:host first, then node --import tsx --test tests/*.test.mjs
~~~

- `src/**` is the **single source of truth**; `lib/**` (host output) and `client/client.js` (client output)
  ship prebuilt so the plugin works right after install;
- `tsdown.config.mjs` injects the banner
  `window.__ModuleLoader__.load({ id: "workspace-tokenpet", ... })`, which is how the host loads the client half;
- layout: `src/` host sources, `src/client/` browser sources, `tests/` unit tests, `skins/` bundled art.

## 5. Acknowledgements

This module was made standalone from the third-party DSH plugin **dsh-token-pet**; its code, art and design
are the foundation of this module, and we thank its authors:

| Item | Value |
|---|---|
| Project | dsh-token-pet — A bilingual floating pet for DeepSeek Harness |
| Repository | https://github.com/Jimmy0123-ux/dsh-token-pet |
| License | MIT License, Copyright (c) DSH Token Pet contributors |
| Baseline commit | `cc49233f8d951dff7d979ee500ae74918497978e` (v0.2.0; the upstream revision this module started from, kept for traceability only) |

The upstream copyright and MIT license text are **retained verbatim** in `LICENSE` of this directory
(going standalone removes no upstream notice); see `NOTICE` for the full attribution. After going standalone
this module no longer applies upstream patches and no longer follows upstream releases.

## 6. License

Released under the **MIT** license — see `LICENSE` (it carries both the upstream copyright line and this
project's copyright line).
