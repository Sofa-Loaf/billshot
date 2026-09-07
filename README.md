# Billshot

Free, client-side GitHub Actions usage / billing explainer.

Paste a usage report, drop a billing screenshot, or type Linux / Windows / macOS minutes. Billshot stays in the browser and explains, in plain English:

- **Minute rounding** — each started job rounds **up to the next whole minute**. A 12-second job still bills 1 minute.
- **OS multipliers** — included (plan) minutes: Linux **1×** · Windows **2×** · macOS **10×**.
- **What likely drove the bill** — macOS jobs, a pile of sub-minute jobs, Windows runners, a wide matrix, or mostly Linux wall time.

No account. No backend. No Stripe. Not a paid product. Copy the HTML into [28to3](https://28to3.me) or serve this repo on GitHub Pages.

**Live:** [https://28to3.me/apps/billshot.html](https://28to3.me/apps/billshot.html) (same-cycle ship on the 28to3 site)

**GitHub Pages:** [https://sofa-loaf.github.io/billshot/](https://sofa-loaf.github.io/billshot/) (after Pages is enabled — see [docs/github-pages.md](docs/github-pages.md))

Soft next steps when you want per-run visibility or a written teardown: [28to3.me](https://28to3.me) — pin **Actionscope `@v0.1.3`**, the **$0.99 Minute Cheat Sheet**, or a **$49 Minute Teardown**.

## How to use

1. Open `index.html` locally, the Pages URL, or the 28to3 app URL. Nothing is uploaded.
2. Click **Load sample paste** to see the explainer on realistic fake jobs (no GitHub login).
3. Or paste your own text:
   - A job list with runner + duration (`ubuntu-latest`, `windows-latest`, `macos-latest` and `12s` / `3m 22s` / `1:04`)
   - A GitHub usage CSV with `sku` and `quantity` (`actions_linux`, `actions_windows`, `actions_macos`)
4. Optional: drop or paste a billing screenshot. v0 **previews** the image. OCR is stubbed — read the OS minutes from the picture and fill the manual fields.
5. If parsing fails, the page shows tips and the same Linux / Windows / macOS minute (or job-count) inputs.

### Pin / install-free story

Billshot is the *after-the-fact* paste. For the *this-run* Job Summary (wall time, rounded minutes, runner SKU, list-price $, included-minute burn), add the free Action:

```yaml
- name: Actionscope
  uses: Sofa-Loaf/actionscope@v0.1.3
```

That Action is free forever as an Action. Billshot is free forever as a static page. Neither asks for an account.

## What the numbers mean

| Term | Meaning |
| --- | --- |
| Wall time | Observed job duration (`12s`, `3m 22s`) |
| Rounded minutes | `ceil(duration_seconds / 60)` **per job** |
| Included / billed minutes | Rounded minutes × OS multiplier (Linux 1, Windows 2, macOS 10) |

This matches GitHub’s published included-minute weights for standard hosted runners. It is an **estimate**, not a GitHub invoice, not list-price $, and not the $19 Actionscope App.

Public repos and typical self-hosted runners are often not billed the same way — treat the number as a lens.

## Copy into 28to3

The 28to3 site can ship this as `apps/billshot.html`:

- Copy `index.html` → `apps/billshot.html`
- Copy `css/billshot.css` and `js/engine.js` + `js/app.js` next to it (keep the relative `css/` and `js/` paths), **or** inline those files into the single HTML page.

No build step. No npm install.

## GitHub Pages

This repo is static from the root (`index.html`). A workflow lives at `.github/workflows/pages.yml`. Enable Pages (Settings → Pages → GitHub Actions) so the workflow can publish. Details: [docs/github-pages.md](docs/github-pages.md).

## Develop / test

```bash
python3 -m http.server 4173
# open http://127.0.0.1:4173
node --test tests/engine.test.js
```

## License

MIT. Keep the existing [LICENSE](LICENSE).
