# SillyTavern Image Compressor

**Requires the companion server plugin: [SillyTavern-Image-Compressor-Server](https://github.com/EnchantedRobot/SillyTavern-Image-Compressor-Server)**

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

On top of that, the **Repair Characters** action performs a lightweight card upgrade in the same pass. It only fixes things that are actually broken — it never rewrites prose, clears prompts, or filters tags. Specifically it upgrades V2 cards to V3, backfills required V3 fields (`group_only_greetings`, `character_book.extensions`, per-entry `use_regex`), and normalises malformed template tokens (e.g. `{char}` → `{{char}}`, and broken pronoun aliases like `{{sub}}`/`{{obj}}`/`{{poss}}` → `{{user}}`). All other metadata — including extension data such as `gallery_id`/`fav` and `_meta` — is preserved. A card is written back whenever it changed or the image shrank, so a repair is never lost.

**Gallery images** are additionally capped at 2048px on the longest side before quantization. Images already within that dimension are passed straight to pngquant.

Files where pngquant's output would be *larger* than the original are left untouched (`--skip-if-larger`).

### JPEG — mozjpeg (optimized re-encoding)

JPEG files are re-encoded using [mozjpeg](https://github.com/mozilla/mozjpeg) (via [sharp](https://sharp.pixelplumbing.com/)) at quality 75 with progressive encoding and optimized Huffman tables. mozjpeg typically achieves 10–20% smaller files than standard libjpeg at the same quality setting. Images are capped at 1920px on the longest side.

Files where re-encoding produces a larger result are left untouched.

### State tracking

The extension tracks which files have already been processed so repeated runs stay fast — a file is only reprocessed if its size has changed (e.g. a new download replaced it). Images and characters track state independently: image compression uses `data/{user}/.compress_state.json` and character repair uses `data/{user}/.repair_state.json`. Keeping them separate means a card already compressed by an image pass isn't skipped before it can be repaired.

## How to use

Open the **Extensions** panel and find **Image Compressor**.

1. Select a user from the dropdown. The list is populated from your `data/` directory — only folders containing a `settings.json` are shown.

The controls are grouped into two rows:

- **Repair Characters** — compresses `characters/` and upgrades/repairs each embedded card (see [Character cards](#character-cards) above). Files processed in a previous run are skipped.
- **Compress Images** — compresses `user/images/` only. Files processed in a previous run are skipped.
- **Reprocess Characters** — clears the character state file and re-runs Repair Characters on every card from scratch.
- **Reprocess Images** — clears the image state file and compresses every image from scratch. Use this after a pngquant or quality setting change.
- **Stats** — shows current file counts and sizes without modifying anything.

A progress bar updates during the run. When complete, the log shows a summary (the `Repaired` line appears only for character runs):

```
Scanned:    1,842
Skipped:    1,204
Compressed: 638
Repaired:   57
Saved:      312.4 MB
```

Any files that could not be processed (corrupt images, permission errors) are listed in the log beneath the summary.

## How to install

1. Install and enable the companion server plugin first (see its README for instructions).

2. In SillyTavern, go to **Extensions → Install extension** and enter:

```
https://github.com/EnchantedRobot/SillyTavern-Image-Compressor
```

Or clone it manually into your user extensions directory:

```bash
cd data/default-user/extensions
git clone https://github.com/EnchantedRobot/SillyTavern-Image-Compressor
```

3. Reload SillyTavern. The extension will appear in the Extensions panel. If the server plugin is not running, a warning toast will appear on load.

## License

MIT
