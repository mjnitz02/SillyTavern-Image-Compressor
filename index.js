const { getRequestHeaders } = SillyTavern.getContext();

const MODULE_NAME = '[Image Compressor]';

const WEBP_QUALITY = 0.82;
const MAX_DIMENSION = 2048;
const MIN_DIMENSION = 512;

// Vector art has nothing to gain from a raster WEBP, so it's left alone.
const SKIP_EXTS = new Set(['webp', 'svg']);

// ── API helpers ──────────────────────────────────────────────────────────────
// Everything goes through SillyTavern's own gallery endpoints, which act on the
// logged-in user's `user/images/` — no server plugin needed.

async function postJson(url, body) {
    const res = await fetch(url, {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || res.statusText);
    }
    return res;
}

async function listFolders() {
    return (await postJson('/api/images/folders', {})).json();
}

async function listImages(folder) {
    return (await postJson('/api/images/list', { folder, sortField: 'name', sortOrder: 'asc' })).json();
}

function imageUrl(folder, file) {
    return `/user/images/${encodeURIComponent(folder)}/${encodeURIComponent(file)}`;
}

async function fetchImage(folder, file) {
    const res = await fetch(imageUrl(folder, file), { headers: getRequestHeaders() });
    if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
    return res.blob();
}

async function uploadWebp(folder, file, blob) {
    const image = await blobToBase64(blob);
    const res = await postJson('/api/images/upload', { image, format: 'webp', ch_name: folder, filename: file });
    return (await res.json()).path;
}

async function deleteImage(folder, file) {
    await postJson('/api/images/delete', { path: `user/images/${folder}/${file}` });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatBytes(n) {
    const sign = n < 0 ? '-' : '';
    n = Math.abs(n);
    if (n < 1024) return `${sign}${n} B`;
    if (n < 1024 * 1024) return `${sign}${(n / 1024).toFixed(1)} KB`;
    return `${sign}${(n / 1024 / 1024).toFixed(1)} MB`;
}

function extOf(file) {
    const m = /\.([^.]+)$/.exec(file);
    return m ? m[1].toLowerCase() : '';
}

// Mirrors SillyTavern's removeFileExtension, which the upload endpoint applies.
function stemOf(file) {
    return file.replace(/\.[^.]+$/, '');
}

function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1]);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    });
}

function computeScaledDimensions(w, h) {
    if (Math.max(w, h) <= MAX_DIMENSION) return null;
    let scale = MAX_DIMENSION / Math.max(w, h);
    if (Math.min(w, h) * scale < MIN_DIMENSION) {
        scale = MIN_DIMENSION / Math.min(w, h);
    }
    if (scale >= 1) return null;
    return { w: Math.round(w * scale), h: Math.round(h * scale) };
}

// ── Animation detection ──────────────────────────────────────────────────────
// A canvas only ever draws the first frame, so animated images must be skipped
// or they'd be flattened to a still.

/** Walks the GIF block structure and reports whether it has more than one frame. */
function isAnimatedGif(bytes) {
    if (bytes.length < 13) return false;
    let pos = 13;
    const packed = bytes[10];
    if (packed & 0x80) pos += 3 * (1 << ((packed & 0x07) + 1)); // global color table

    const skipSubBlocks = () => {
        while (pos < bytes.length && bytes[pos] !== 0) pos += bytes[pos] + 1;
        pos++; // block terminator
    };

    let frames = 0;
    while (pos < bytes.length) {
        const block = bytes[pos];
        if (block === 0x2c) { // image descriptor
            if (++frames > 1) return true;
            const localPacked = bytes[pos + 9];
            pos += 10;
            if (localPacked & 0x80) pos += 3 * (1 << ((localPacked & 0x07) + 1));
            pos++; // LZW minimum code size
            skipSubBlocks();
        } else if (block === 0x21) { // extension
            pos += 2;
            skipSubBlocks();
        } else {
            break; // trailer (0x3b) or corrupt
        }
    }
    return false;
}

/** An APNG declares an `acTL` chunk before its first `IDAT`. */
function isAnimatedPng(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let pos = 8;
    while (pos + 8 <= bytes.length) {
        const length = view.getUint32(pos);
        const type = String.fromCharCode(...bytes.subarray(pos + 4, pos + 8));
        if (type === 'acTL') return true;
        if (type === 'IDAT') return false;
        pos += 12 + length;
    }
    return false;
}

async function isAnimated(blob, ext) {
    if (ext !== 'gif' && ext !== 'png') return false;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return ext === 'gif' ? isAnimatedGif(bytes) : isAnimatedPng(bytes);
}

// ── Conversion ───────────────────────────────────────────────────────────────

/**
 * Safari's canvas silently falls back to PNG when asked for WEBP. The canvas
 * needs a context first: Chrome rejects convertToBlob on one that has none.
 */
async function canEncodeWebp() {
    try {
        const canvas = new OffscreenCanvas(1, 1);
        canvas.getContext('2d');
        const blob = await canvas.convertToBlob({ type: 'image/webp' });
        return blob.type === 'image/webp';
    } catch (err) {
        console.error(MODULE_NAME, 'WEBP probe failed', err);
        return false;
    }
}

async function encodeWebp(blob) {
    const bitmap = await createImageBitmap(blob);
    try {
        const dims = computeScaledDimensions(bitmap.width, bitmap.height);
        const w = dims?.w ?? bitmap.width;
        const h = dims?.h ?? bitmap.height;
        const canvas = new OffscreenCanvas(w, h);
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(bitmap, 0, 0, w, h);
        const webp = await canvas.convertToBlob({ type: 'image/webp', quality: WEBP_QUALITY });
        if (webp.type !== 'image/webp') throw new Error('browser cannot encode WEBP');
        return { webp, resized: dims !== null };
    } finally {
        bitmap.close();
    }
}

/**
 * Converts one image in place to `<stem>.webp`. There's no state file: a WEBP
 * is the finished form, so the next run skips it — which is also why the
 * conversion is unconditional rather than only-if-smaller.
 */
async function convertFile(folder, file, existing, result) {
    const ext = extOf(file);
    if (SKIP_EXTS.has(ext)) {
        result.skipped++;
        return;
    }

    const target = `${stemOf(file)}.webp`;
    if (existing.has(target.toLowerCase())) {
        result.errors.push(`${folder}/${file}: ${target} already exists, left untouched`);
        return;
    }

    const original = await fetchImage(folder, file);
    if (await isAnimated(original, ext)) {
        result.animated++;
        return;
    }

    const { webp, resized } = await encodeWebp(original);

    // Only drop the original once the WEBP has landed exactly where expected —
    // the server sanitizes names, and a mismatch would otherwise lose the file.
    const expected = `/user/images/${folder}/${target}`;
    const written = await uploadWebp(folder, file, webp);
    if (written !== expected) {
        throw new Error(`upload landed at ${written}, expected ${expected}; original kept`);
    }
    await deleteImage(folder, file);
    existing.add(target.toLowerCase());

    result.converted++;
    result.bytesSaved += original.size - webp.size;
    console.log(MODULE_NAME, `${folder}/${file} -> ${target}: ${formatBytes(original.size)} -> ${formatBytes(webp.size)}${resized ? ' (resized)' : ''}`);
}

// ── UI ───────────────────────────────────────────────────────────────────────

function buildPanel() {
    const div = document.createElement('div');
    div.id = 'imgcmp-panel';
    div.innerHTML = `
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>Image Compressor</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <div style="display:flex; gap:8px; margin-bottom:12px;">
                    <div id="imgcmp-convert" class="menu_button" style="flex:1; text-align:center;">
                        <i class="fa-solid fa-compress"></i>&nbsp;&nbsp;Convert Images to WEBP
                    </div>
                    <div id="imgcmp-stats" class="menu_button" style="flex:1; text-align:center;">
                        <i class="fa-solid fa-chart-pie"></i>&nbsp;&nbsp;Stats
                    </div>
                </div>
                <div id="imgcmp-progress-wrap" style="display:none; margin-bottom:8px;">
                    <div style="display:flex; justify-content:space-between; font-size:12px; margin-bottom:4px;">
                        <span id="imgcmp-progress-label">Scanning...</span>
                        <span id="imgcmp-progress-pct">0%</span>
                    </div>
                    <div style="background:rgba(255,255,255,0.1); border-radius:3px; height:6px; overflow:hidden;">
                        <div id="imgcmp-bar" style="height:100%; width:0%; background:var(--SmartThemeBodyColor,#4a9eff); transition:width 0.4s ease;"></div>
                    </div>
                </div>
                <pre id="imgcmp-log" style="display:none; font-size:11px; background:rgba(0,0,0,0.25); border-radius:4px; padding:8px; max-height:140px; overflow-y:auto; white-space:pre-wrap; margin:0; font-family:monospace;"></pre>
            </div>
        </div>
    `;
    return div;
}

const BUTTON_IDS = ['imgcmp-convert', 'imgcmp-stats'];

function setRunning(running) {
    for (const id of BUTTON_IDS) {
        const el = document.getElementById(id);
        if (!el) continue;
        el.style.pointerEvents = running ? 'none' : '';
        el.style.opacity = running ? '0.5' : '';
    }
}

const LOG_MAX_LINES = 100;

function appendLog(msg) {
    const el = document.getElementById('imgcmp-log');
    if (!el) return;
    el.style.display = 'block';
    const lines = el.textContent ? el.textContent.split('\n') : [];
    lines.push(msg);
    if (lines.length > LOG_MAX_LINES) {
        const dropped = lines.length - LOG_MAX_LINES;
        lines.splice(0, dropped);
        lines.unshift(`... (${dropped} earlier lines hidden)`);
    }
    el.textContent = lines.join('\n');
    el.scrollTop = el.scrollHeight;
}

function resetLog() {
    const log = document.getElementById('imgcmp-log');
    log.textContent = '';
    log.style.display = 'none';
}

/** Every image in every `user/images/<folder>/`, as `{ folder, file }` pairs. */
async function collectImages() {
    const images = [];
    for (const folder of await listFolders()) {
        for (const file of await listImages(folder)) images.push({ folder, file });
    }
    return images;
}

// ── Stats ────────────────────────────────────────────────────────────────────

async function runStats() {
    resetLog();
    document.getElementById('imgcmp-progress-wrap').style.display = 'none';
    setRunning(true);

    try {
        const images = await collectImages();
        const byType = new Map();
        for (const { file } of images) {
            const ext = extOf(file) || '(none)';
            byType.set(ext, (byType.get(ext) ?? 0) + 1);
        }
        const folders = new Set(images.map(i => i.folder)).size;
        appendLog(`user/images/: ${images.length.toLocaleString()} images in ${folders.toLocaleString()} folders`);
        for (const [ext, count] of [...byType].sort((a, b) => b[1] - a[1])) {
            appendLog(`  ${ext.padEnd(6)} ${String(count).padStart(6)}`);
        }
    } catch (err) {
        appendLog(`Error: ${err.message}`);
        console.error(MODULE_NAME, err);
        toastr.error('Failed to load stats. See the log for details.', 'Image Compressor');
    } finally {
        setRunning(false);
    }
}

// ── Job runner ───────────────────────────────────────────────────────────────

async function runConvert() {
    const progressWrap = document.getElementById('imgcmp-progress-wrap');
    const bar = document.getElementById('imgcmp-bar');
    const label = document.getElementById('imgcmp-progress-label');
    const pct = document.getElementById('imgcmp-progress-pct');

    resetLog();

    if (!(await canEncodeWebp())) {
        appendLog('Error: this browser cannot encode WEBP. Run the conversion from Chrome, Edge or Firefox (see the console for details).');
        toastr.error('This browser cannot encode WEBP.', 'Image Compressor');
        return;
    }

    bar.style.width = '0%';
    pct.textContent = '0%';
    label.textContent = 'Scanning files...';
    progressWrap.style.display = 'block';
    setRunning(true);

    const result = { scanned: 0, skipped: 0, animated: 0, converted: 0, bytesSaved: 0, errors: [] };

    try {
        const images = await collectImages();
        result.scanned = images.length;

        // Lower-cased names per folder, to catch a conversion that would
        // overwrite an existing `<stem>.webp`.
        const existingByFolder = new Map();
        for (const { folder, file } of images) {
            if (!existingByFolder.has(folder)) existingByFolder.set(folder, new Set());
            existingByFolder.get(folder).add(file.toLowerCase());
        }

        let current = 0;
        for (const { folder, file } of images) {
            current++;
            try {
                await convertFile(folder, file, existingByFolder.get(folder), result);
            } catch (err) {
                result.errors.push(`${folder}/${file}: ${err.message}`);
                console.error(MODULE_NAME, `${folder}/${file}`, err);
            }
            const percent = Math.round((current / images.length) * 100);
            bar.style.width = `${percent}%`;
            pct.textContent = `${percent}%`;
            label.textContent = `Processing... ${current.toLocaleString()} / ${images.length.toLocaleString()}`;
        }

        bar.style.width = '100%';
        pct.textContent = '100%';
        label.textContent = 'Done';
        appendLog(`Scanned:    ${result.scanned.toLocaleString()}`);
        appendLog(`Skipped:    ${result.skipped.toLocaleString()}`);
        appendLog(`Animated:   ${result.animated.toLocaleString()}`);
        appendLog(`Converted:  ${result.converted.toLocaleString()}`);
        appendLog(`Saved:      ${formatBytes(result.bytesSaved)}`);
        if (result.errors.length > 0) {
            appendLog(`\nErrors (${result.errors.length}):`);
            for (const e of result.errors) appendLog(`  ${e}`);
        }
        toastr.success(`Converted ${result.converted.toLocaleString()} images, saved ${formatBytes(result.bytesSaved)}`, 'Image Compressor');
    } catch (err) {
        appendLog(`Error: ${err.message}`);
        console.error(MODULE_NAME, err);
        toastr.error('Conversion failed. See the log for details.', 'Image Compressor');
    } finally {
        setRunning(false);
    }
}

// ── Settings panel injection ─────────────────────────────────────────────────

function injectPanel(container) {
    if (document.getElementById('imgcmp-panel')) return;
    container.appendChild(buildPanel());
    document.getElementById('imgcmp-convert').addEventListener('click', runConvert);
    document.getElementById('imgcmp-stats').addEventListener('click', runStats);
}

// ── Main ─────────────────────────────────────────────────────────────────────

const tryInject = () => {
    const container = document.querySelector('#extensions_settings2') || document.querySelector('#extensions_settings');
    if (!container) return false;
    injectPanel(container);
    return true;
};

if (!tryInject()) {
    const observer = new MutationObserver(() => {
        if (tryInject()) observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
}
