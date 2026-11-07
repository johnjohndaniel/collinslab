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

## Layout

| Path | What it is |
|---|---|
| `index.html` | Home page: hero scene and the list of experiments |
| `experiments/<name>/index.html` | One page per experiment |
| `src/specimen.js` | EXP 01, the copper specimen scene (shader, interaction, animation loop) |
| `src/style.css` | Shared styles |
| `public/` | Files copied as-is (favicon) |
