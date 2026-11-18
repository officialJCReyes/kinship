# The KinShip project website

Plain HTML and CSS, no build step, no web fonts and no third-party requests. It is published to GitHub Pages by `.github/workflows/pages.yml` when `site/` changes on `main`, at `https://officialjcreyes.github.io/kinship/`.

- Every link is relative (or points at GitHub), so the site works under `/kinship/` and would work on a custom domain unchanged.
- The logo files in `assets/` are copies of `docs/assets/` and `apps/web/public/`. The logo and the KinShip name are not covered by the AGPL (see `TRADEMARK.md`).
- Facts on the pages (version, release status, what each release brings) come from `design/kinship-release-and-deployment-plan.md`. Update them when a release is published.
