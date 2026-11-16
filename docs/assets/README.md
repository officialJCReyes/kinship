# Assets used by the README and docs

The KinShip logo, sailboat mark and social preview card. The logo and the KinShip name are not covered by the AGPL; see [TRADEMARK.md](../../TRADEMARK.md).

- `kinship-logo-horizontal.svg`: logo for light backgrounds.
- `kinship-logo-horizontal-reversed.svg`: logo for dark backgrounds.
- `kinship-mark.svg`: the sailboat mark alone.
- `social-preview.png` (1280x640) and `social-preview.svg`: the repository social preview card (uploaded by hand in Settings, Social preview).

The complete logo kit is in [`design/brand/`](../../design/brand/).

## Screenshots

`screenshots/` holds the pictures the README uses, all of the fictional Hale family (including Samuel Hale, adopted in 1938 by Joseph and Anna Hale, birth parents Frank and Ruth Doyle). They are made on demand against the real stack, not in CI:

```sh
pnpm --filter @kinship/e2e e2e:build-images   # if the api or web app changed
pnpm --filter @kinship/e2e screenshots
```

The script is [`e2e/screenshots/screenshots.spec.ts`](../../e2e/screenshots/screenshots.spec.ts). It starts a throwaway stack, does the first-run setup, builds the family through the API and writes the PNGs here (twice the pixel density, about 50 to 220 KB each). It also saves a few zoom-level pictures under `e2e/artifacts/zoom-check/` for a visual check; those are not published.
