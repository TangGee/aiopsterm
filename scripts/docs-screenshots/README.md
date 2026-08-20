# Docs Screenshots Pipeline

Regenerates the annotated screenshots used by `docs/usage/best-practices/`.

## How It Works

1. `capture.js` launches the **built** app with the standard E2E seed environment (`AIOPSTERM_*_ENABLE_SEED=1`, backend doubles, temporary `AIOPSTERM_USER_DATA_DIR`), selects the requested application language through the real language control, walks the core surfaces, and writes clean PNGs plus element bounding-box manifests (`.json`) to `test-results/docs-screenshots/raw/<locale>/`.
2. `annotate.py` reads both locale trees, draws numbered badges, arrows, and highlight boxes (with optional crop/zoom per figure), and writes final images to `docs/usage/best-practices/images/<locale>/`.

Because annotations are anchored to element bounding boxes captured at runtime, regenerated screenshots keep arrows on the right buttons even when the layout shifts.

## Usage

```bash
npm run build                                   # capture runs the built app
node scripts/docs-screenshots/capture.js --locale zh-CN
node scripts/docs-screenshots/capture.js --locale en-US
# Use xvfb-run -a before either capture command on headless Linux.
python3 scripts/docs-screenshots/annotate.py    # needs Pillow: pip install pillow
```

Both capture passes are required. Chinese articles reference only `images/zh-CN/`, and English articles reference only `images/en-US/`. A scene failure, missing annotation anchor, or annotation error makes the command fail; fix it before publishing regenerated screenshots. The documentation audit also rejects an English screenshot that is byte-identical to its Chinese counterpart.

## Adding A Figure

1. Add a scene in `capture.js`: navigate, then `snap(page, name, [[key, selector, filterText?], ...])` for every element you want to point at.
2. Add a figure spec to `FIGS` in `annotate.py`: source name, output name, optional `crop`/`scale`, and callouts (`key` from the manifest or an absolute `box`, badge `side`, arrow `dist`; `dist <= 8` draws a badge without an arrow).
3. Reference `../images/<locale>/<out>.png` from the matching locale docs and describe each numbered badge in a legend.
