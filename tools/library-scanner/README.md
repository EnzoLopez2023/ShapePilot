# ShapePilot Library organizer

Runs on the Mac that holds your print files. It indexes every STL / 3MF, files
new downloads into your library, and keeps ShapePilot's **Library** in sync.
Model files never leave the Mac; ShapePilot only receives metadata and thumbnails.

The Library lived in Workshop until October 2026. `~/.workshop-library.json`,
the launch-agent labels and `workshopVersion` in each model.json keep their old
names so a Mac that ran it there carries on with the same settings and history.

## Library layout

```
OneDrive/Documents/3D Print/
├── _Inbox/<Model>/        new downloads land here, one folder per model
├── <Category>/<Model>/    Festool, Skadis, X2D, … (top-level folders are categories)
│   ├── <files>.3mf / .stl
│   └── model.json         identity + title, status, tags, notes (synced with ShapePilot)
├── ShapePilot/<Model>/    ShapePilot exports are recognized and filed here
├── _Archive/<Model>/      skipped / superseded models
└── _Library/              move logs (undo), the current reorganization plan
```

## Setup

1. In ShapePilot → Settings → **Library**, create a device token.
2. In this repository on the Mac (it uses the repository's own dependencies):

```bash
npm install
npm run library -- connect <token>
npm run library -- sync
npm run library -- install
```

`install` adds two launch agents: one watches `~/Downloads` and
`OneDrive/Downloads` (and runs every 15 minutes) to file new models and sync;
the other keeps the local helper running so the Library's buttons (Open in Bambu
Studio, Reveal in Finder, Move, Organize, Undo) work in the browser on this Mac.
macOS may ask once whether Node may access Downloads and OneDrive.

## Commands

| Command | What it does |
|---|---|
| `scan` | Index everything and print totals (read-only) |
| `plan [out.json]` | Write the reorganization plan; nothing moves |
| `apply [plan] <ids…> \| --all [--dry-run]` | Apply approved plan entries |
| `intake [--dry-run]` | File settled downloads into `_Inbox/` |
| `sync` | Pull app edits into `model.json`, push the index + plan |
| `run` | `intake` then `sync` (what the launch agent runs) |
| `serve` | Local helper on `http://localhost:47821` |
| `batches` / `undo <batch>` | List logged changes / reverse one |
| `status` | Show the effective configuration |

## Categories

Top-level folders are categories. ShapePilot → Library → **Manage** creates, renames,
merges and removes them through the local helper: a rename moves the folder and
rewrites each model's `model.json`, a merge moves every model folder into the
target (keeping names unique), and only an empty category can be removed. Each
change is one logged batch, undoable from the toast or Organize → History.
`_Inbox`, `_Archive` and `ShapePilot` are filed into by name, so they are
protected. After updating the organizer, restart the helper so the app sees the
new endpoints:

```bash
launchctl kickstart -k gui/$(id -u)/com.nintek.workshop-library.helper
```

Settings live in `~/.workshop-library.json` (library root, intake folders,
category keywords, legacy folder mapping). Nothing is permanently deleted:
duplicates go to the macOS Trash, and every change is logged and undoable.
