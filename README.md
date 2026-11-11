# collinslab

A sandbox for trying out ideas and concepts as interactive 3D experiments in the browser, live at https://collinslab.dev.

Built with [three.js](https://threejs.org) and [Vite](https://vite.dev), hosted on Cloudflare Pages.

## Run it locally

```bash
npm install
npm run dev        # opens a live-reloading preview at http://localhost:5173
```

## Publish a change

```bash
npm run deploy     # builds, then uploads dist/ to Cloudflare Pages
```

Deploying needs `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in the environment (kept in `~/.config/cloudflare.env`, never in this repo).

## Add an experiment

1. Copy `experiments/specimen/` to `experiments/<name>/` and change the scene.
2. Add the page to `build.rollupOptions.input` in `vite.config.js`.
3. Add a card for it on `index.html`.

## Projects section

`/projects/` shows live overviews of current projects, each with its own three.js model (`src/projects/scenes.js`); `/projects/<slug>/` is one project's page.

The data comes from `tools/sync_projects.py`, which runs every 15 minutes from cron on the workstation. It reads a private project list (`~/.config/collinslab/projects.json`, deliberately not in this public repo) plus Claude Code job timelines and the handoff registry, then upserts one JSON row per project into D1.

```bash
python3 tools/sync_projects.py --dry-run   # preview what would be synced
python3 tools/sync_projects.py             # sync now
```

Projects missing from the private list still appear: every handoff root the pulse scan finds is added with a default model, and entries in the private list always win. To add or restyle a project, add an entry to the private JSON (slug, title, tagline, about, `kind` = one of the scene names in `scenes.js`, `hue`, facts, and the job IDs / handoff slugs / transcript folders that belong to it).

## Pulse: manuscripts and KPIs

`/manuscripts/` lists every paper in progress with its stage and section-by-section readiness. It is reached only through the "Ongoing manuscripts" project on `/projects/` (`pulse_board: true` in the private project list), not from the main navigation. `/projects/` also carries the KPI strip (waiting on you, runs unattended, momentum, nearest milestones) and the Today panel. The Today panel hides itself once its synthesis is more than a day old. All of it is summaries only. No manuscript file leaves the workstation.

The pulse is **off** by default to save cost (about $0.49 per run at API prices, almost all of it the Sonnet synthesis). The pages keep the last judged data.

```bash
tools/pulse/cron.sh on       # install the hourly cron line and run one cycle now
tools/pulse/cron.sh off      # remove the cron line; code, config and state stay
tools/pulse/cron.sh status
```

When on, the hourly cron job runs `tools/pulse/run.sh`, which runs these steps in order:

1. `scan.py` builds the project and manuscript lists, extracts counts without a model, and fingerprints each project. It exits with `unchanged` when nothing moved since the last good push, so quiet hours cost nothing.
2. A headless Claude orchestrator (Sonnet, `orchestrator.md`) sends one Haiku `pulse-worker` (`worker.md`) per changed project. Then it writes the cross-project synthesis.
3. `push.py` validates every file against `schema.json`, redacts secrets and emails, and upserts the `pulse` table. Then it runs `sync_projects.py`, which merges each project's pulse into its row.

The manuscript list lives in the private `~/.config/collinslab/pulse.json`. Outputs, run transcripts and fingerprints live in `~/.local/state/collinslab/pulse/`. The log is `~/.local/state/collinslab/pulse.log`.

**CAUTION:** the Claude run must stay isolated. `run.sh` skips user settings (they grant `bypassPermissions`), drops MCP servers, denies the shell, the network and reads of secret files, and allows writes only inside the state folder. Claude Code also refuses writes under `~/.claude`, so never move the state folder there.

```bash
tools/pulse/run.sh                      # one cycle now (what cron runs)
tools/pulse/run.sh --force              # re-judge every project (about $0.70)
tools/pulse/run.sh --only mcra-census   # re-judge one project
python3 tools/pulse/push.py --dry-run   # validate without touching D1
python3 tools/pulse/seed_local.py       # copy current data into the local D1 for npm run dev:full
```

## Add a page

1. Add the page's HTML to `build.rollupOptions.input` in `vite.config.js`.
2. Leave it private by default. For a public page, add its path to `PUBLIC_PREFIX` or `PUBLIC_EXACT` in `functions/_middleware.js` and keep its images under that prefix.

## Layout

| Path | What it is |
|---|---|
| `index.html` | Home page: hero scene and the list of experiments |
| `experiments/<name>/index.html` | One page per experiment |
| `src/specimen.js` | EXP 01, the copper specimen scene (shader, interaction, animation loop) |
| `src/style.css` | Shared styles |
| `src/projects/` | Projects pages and the 3D scene for each project kind |
| `functions/` | Cloudflare Pages Functions: sign-in gate, board, projects and pulse API |
| `tools/sync_projects.py` | Pushes live project overviews to D1 |
| `src/manuscripts/`, `manuscripts/` | Manuscripts pages |
| `tools/pulse/` | Hourly pulse: scan, prompts, schema, push |
| `tools/cfd1.py` | D1 over the HTTP API, shared by the sync and the pulse |
| `migrations/` | D1 schema, applied by `npm run deploy` |
| `public/` | Files copied as-is (favicon) |
