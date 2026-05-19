# SillyTavern Image Compressor

**Requires the companion server plugin: [SillyTavern-Image-Compressor-Server](https://github.com/mjnitz02/SillyTavern-Image-Compressor-Server)**

A SillyTavern extension that compresses PNG and JPEG images in your user directory to reduce disk usage. Large SillyTavern installs commonly accumulate gigabytes of character cards and gallery images — this extension can significantly reduce that footprint with no visible quality loss for typical use.

## What it compresses

Two directories are scanned for each user:

| Directory | What's in it |
|---|---|
| `data/{user}/characters/` | Character card PNG files |
| `data/{user}/user/images/` | Gallery images from chat |

## How compression works

### PNG — pngquant (lossy palette quantization)

PNG files are compressed using [pngquant](https://pngquant.org/), which converts 24/32-bit true-color PNGs to 8-bit palette images. This is a lossy process, but for photographic or AI-generated artwork the difference is typically invisible at normal viewing sizes. Savings of 40–70% are common.

**Character cards** receive special treatment: the `tEXt` chunk embedded in the PNG (which stores the character definition JSON) is extracted before compression and re-injected afterward. This means character data is fully preserved and the card remains importable after compression.

**Gallery images** are additionally capped at 2048px on the longest side before quantization. Images already within that dimension are passed straight to pngquant.

Files where pngquant's output would be *larger* than the original are left untouched (`--skip-if-larger`).

### JPEG — mozjpeg (optimized re-encoding)

JPEG files are re-encoded using [mozjpeg](https://github.com/mozilla/mozjpeg) (via [sharp](https://sharp.pixelplumbing.com/)) at quality 75 with progressive encoding and optimized Huffman tables. mozjpeg typically achieves 10–20% smaller files than standard libjpeg at the same quality setting. Images are capped at 1920px on the longest side.

Files where re-encoding produces a larger result are left untouched.

### State tracking

The extension tracks which files have already been processed in `data/{user}/.compress_state.json`. Each entry records the file path and its compressed size. On subsequent runs, a file is only reprocessed if its size has changed (e.g. a new download replaced it). This makes repeated runs fast — only new or changed files are touched.

## How to use

Open the **Extensions** panel and find **Image Compressor**.

1. Select a user from the dropdown. The list is populated from your `data/` directory — only folders containing a `settings.json` are shown.
2. Click **Compress** to run a normal pass. Files already processed in a previous run are skipped.
3. Click **Reprocess All** to clear the state file and compress everything from scratch. Use this if you want to re-run after a pngquant or quality setting change.

A progress bar updates every 50 files during the run. When complete, the log shows a summary:

```
Scanned:    1,842
Skipped:    1,204
Compressed: 638
Saved:      312.4 MB
```

Any files that could not be processed (corrupt images, permission errors) are listed in the log beneath the summary.

## How to install

1. Install and enable the companion server plugin first (see its README for instructions).

2. In SillyTavern, go to **Extensions → Install extension** and enter:

```
https://github.com/mjnitz02/SillyTavern-Image-Compressor
```

Or clone it manually into your user extensions directory:

```bash
cd data/default-user/extensions
git clone https://github.com/mjnitz02/SillyTavern-Image-Compressor
```

3. Reload SillyTavern. The extension will appear in the Extensions panel. If the server plugin is not running, a warning toast will appear on load.

## License

MIT
