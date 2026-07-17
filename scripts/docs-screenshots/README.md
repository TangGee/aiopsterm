# Docs Screenshots Pipeline

Regenerates the annotated screenshots used by `docs/usage/best-practices/`.

## How It Works

1. `capture.js` launches the **built** app with the standard E2E seed environment (`AIOPSTERM_*_ENABLE_SEED=1`, backend doubles, temporary `AIOPSTERM_USER_DATA_DIR`), walks the core surfaces, and writes clean PNGs plus element bounding-box manifests (`.json`) to `test-results/docs-screenshots/raw/`.
2. `annotate.py` reads those PNGs + manifests, draws numbered badges, arrows, and highlight boxes (with optional crop/zoom per figure), and writes final images to `docs/usage/best-practices/images/`.

Because annotations are anchored to element bounding boxes captured at runtime, regenerated screenshots keep arrows on the right buttons even when the layout shifts.

## Usage

```bash
npm run build                                   # capture runs the built app
node scripts/docs-screenshots/capture.js        # with a display
xvfb-run -a node scripts/docs-screenshots/capture.js   # headless (CI)
python3 scripts/docs-screenshots/annotate.py    # needs Pillow: pip install pillow
```

The app UI must be in Chinese (the seeded default) so text-filter selectors match. A scene failure is logged and skipped rather than aborting the run; `MISS` in the log means one annotation anchor was not found — the screenshot is still taken.

## Adding A Figure

1. Add a scene in `capture.js`: navigate, then `snap(page, name, [[key, selector, filterText?], ...])` for every element you want to point at.
2. Add a figure spec to `FIGS` in `annotate.py`: source name, output name, optional `crop`/`scale`, and callouts (`key` from the manifest or an absolute `box`, badge `side`, arrow `dist`; `dist <= 8` draws a badge without an arrow).
3. Reference `../images/<out>.png` from the docs and describe each numbered badge in a legend.
