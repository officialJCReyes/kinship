# The KinShip project website

Plain HTML and CSS, no build step, no web fonts and no third-party requests. It is published to GitHub Pages by `.github/workflows/pages.yml` when `site/` changes on `main`, at `https://officialjcreyes.github.io/kinship/`.

- Every link is relative (or points at GitHub), so the site works under `/kinship/` and would work on a custom domain unchanged.
- The logo files in `assets/` are copies of `docs/assets/` and `apps/web/public/`. The logo and the KinShip name are not covered by the AGPL (see `TRADEMARK.md`).
- The current version is written as `@@VERSION@@` in the HTML. The Website workflow replaces it with the version of the latest published GitHub Release when it deploys (ADR 0022), and it runs again after the Release workflow finishes on a tag. Opening a file from `site/` directly shows the placeholder. To preview a built copy: `cp -R site /tmp/site-preview && find /tmp/site-preview -name '*.html' -exec sed -i.bak 's/@@VERSION@@/0.2.0/g' {} + && python3 -m http.server -d /tmp/site-preview`.
- Wording that depends on what a release contains (the Roadmap and Features pages, "Soon" chips, "arrives in 0.x" sentences) is edited by hand in the release pull request, before the tag. Facts on the pages come from `design/kinship-release-and-deployment-plan.md` and `design/kinship-website.md`.
- Website-only commits use `docs(site):` or `chore(site):`, not `feat` or `fix`, so they do not raise the next version.
