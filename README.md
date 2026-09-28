# SillyTavern Image Compressor

A SillyTavern extension that converts the images in your gallery folders to WEBP to reduce disk usage. It runs entirely in the browser against SillyTavern's built-in gallery endpoints — no server plugin required.

## What it converts

Every image inside the logged-in user's gallery folders, `data/{user}/user/images/<folder>/`. Loose files at the root of `user/images/` are not reachable through SillyTavern's gallery API and are left alone. Character cards are not touched.

For each image:

| Image | Action |
|---|---|
| WEBP | Skipped — already in the target format |
| SVG | Skipped — vector art has nothing to gain |
| Animated GIF or APNG | Skipped — a canvas can only draw the first frame, so converting would flatten the animation |
| Anything else (PNG, JPEG, BMP, still GIF, …) | Re-encoded as `<name>.webp` (quality 82) and the original deleted |

Images larger than 2048px on the longest side are downscaled to fit during conversion, without letting the shortest side drop below 512px.

There is no state file. A WEBP is the finished form, so re-running only picks up images added since the last run.

A conversion is skipped (and reported) if a `<name>.webp` already exists in the same folder, so nothing is overwritten. The original is only deleted after the WEBP has been written to the expected path.

### Chat references

Converting renames `foo.png` to `foo.webp`. Chat messages that embedded the image by its old path will no longer find it.

### Browser support

The conversion needs a browser whose canvas can encode WEBP — Chrome, Edge or Firefox. Safari cannot, and the extension refuses to run there rather than writing PNGs under a `.webp` name.

## How to use

Open the **Extensions** panel and find **Image Compressor**.

- **Convert Images to WEBP** — converts every eligible image as described above.
- **Stats** — lists how many images of each type are in your gallery folders, without changing anything.

A progress bar updates during the run. When complete, the log shows a summary:

```
Scanned:    1,842
Skipped:    1,204
Animated:   12
Converted:  626
Saved:      312.4 MB
```

Any files that could not be converted are listed in the log beneath the summary and left untouched.

## How to install

In SillyTavern, go to **Extensions → Install extension** and enter:

```
https://github.com/EnchantedRobot/SillyTavern-Image-Compressor
```

Or clone it manually into your user extensions directory:

```bash
cd data/default-user/extensions
git clone https://github.com/EnchantedRobot/SillyTavern-Image-Compressor
```

Then reload SillyTavern.

## License

MIT
