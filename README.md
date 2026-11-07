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

To add a project, add an entry to the private JSON (slug, title, tagline, about, `kind` = one of the scene names in `scenes.js`, `hue`, facts, and the job IDs / handoff slugs / transcript folders that belong to it).

## Layout

| Path | What it is |
|---|---|
| `index.html` | Home page: hero scene and the list of experiments |
| `experiments/<name>/index.html` | One page per experiment |
| `src/specimen.js` | EXP 01, the copper specimen scene (shader, interaction, animation loop) |
| `src/style.css` | Shared styles |
| `src/projects/` | Projects pages and the 3D scene for each project kind |
| `functions/` | Cloudflare Pages Functions: sign-in gate, board and projects API |
| `tools/sync_projects.py` | Pushes live project overviews to D1 |
| `public/` | Files copied as-is (favicon) |
