# GitHub Pages

Billshot is a static site: `index.html`, `css/`, and `js/` at the repository root.

## Enable Pages

1. Open the repo **Settings → Pages**.
2. Under **Build and deployment**, set **Source** to **GitHub Actions**.
3. Merge this workflow (`.github/workflows/pages.yml`) to the default branch.
4. The site publishes at `https://sofa-loaf.github.io/billshot/`.

If Pages is not enabled, the deploy job will not have an environment to write to. The tool still works by opening `index.html` or copying it to [28to3.me/apps/billshot.html](https://28to3.me/apps/billshot.html).

## What the workflow uploads

Only the files needed to run the explainer:

- `index.html`
- `css/`
- `js/`
- `LICENSE`
- `README.md`

No backend, no tokens in the page, no account flow.
