# Help screenshots

Put screenshot images (PNG/JPG) for the in-app Help guide in this folder.

Reference them from `../../HELP.md` with an **absolute** path:

```markdown
![Alt text describing the screenshot](/help-images/your-screenshot.png)
```

Notes:

- The folder is served at `/help-images/...` (the Help guide itself opens at `/help.html`), and `vite build` bundles it into the Docker image.
- Images render responsively (max-width: 100%) and get a light border/rounded corners via the CSS in `scripts/build-help.mjs`.
- Suggested naming: lowercase, hyphenated, by topic — e.g. `ui-canvas.png`, `step-palette.png`, `export-dropdown.png`.
- After adding or referencing images, run `npm run build:help` to regenerate `public/help.html`.
