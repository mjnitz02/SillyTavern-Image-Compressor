const { getRequestHeaders } = SillyTavern.getContext();

const MODULE_NAME = '[Image Compressor]';
const PLUGIN_BASE = '/api/plugins/image-compressor';

// ── API helpers ──────────────────────────────────────────────────────────────

async function probePlugin() {
    try {
        const res = await fetch(`${PLUGIN_BASE}/probe`, {
            method: 'POST',
            headers: getRequestHeaders(),
        });
        return res.ok;
    } catch {
        return false;
    }
}

async function fetchStats(user) {
    const res = await fetch(`${PLUGIN_BASE}/stats`, {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({ user }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || res.statusText);
    }
    return res.json();
}

async function fetchUsers() {
    try {
        const res = await fetch(`${PLUGIN_BASE}/users`, {
            headers: getRequestHeaders(),
        });
        if (!res.ok) return [];
        const data = await res.json();
        return data.users ?? [];
    } catch {
        return [];
    }
}

function formatBytes(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// ── UI ───────────────────────────────────────────────────────────────────────

function buildPanel(users) {
    const options = users.map(u => `<option value="${u}">${u}</option>`).join('');
    const div = document.createElement('div');
    div.id = 'imgcmp-panel';
    div.innerHTML = `
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>Image Compressor</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <div style="display:flex; align-items:center; gap:8px; margin-bottom:10px;">
                    <label for="imgcmp-user" style="white-space:nowrap; font-size:13px;">User</label>
                    <select id="imgcmp-user" class="text_pole" style="flex:1;">${options}</select>
                    <div id="imgcmp-refresh" class="menu_button" title="Refresh user list" style="padding:4px 9px;">
                        <i class="fa-solid fa-rotate-right"></i>
                    </div>
                </div>
                <div style="display:flex; gap:8px; margin-bottom:12px;">
                    <div id="imgcmp-run" class="menu_button" style="flex:1; text-align:center;">
                        <i class="fa-solid fa-compress"></i>&nbsp;&nbsp;Compress
                    </div>
                    <div id="imgcmp-reprocess" class="menu_button" style="flex:1; text-align:center;">
                        <i class="fa-solid fa-rotate"></i>&nbsp;&nbsp;Reprocess All
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

function setRunning(running) {
    for (const id of ['imgcmp-run', 'imgcmp-reprocess', 'imgcmp-refresh', 'imgcmp-stats']) {
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

// ── Stats display ───────────────────────────────────────────────────────────

const STATS_TYPE_ORDER = ['png', 'jpg', 'gif', 'webp', 'other'];

function appendDirStats(label, stats) {
    appendLog(`${label}: ${stats.totalFiles.toLocaleString()} files, ${formatBytes(stats.totalBytes)}`);
    for (const type of STATS_TYPE_ORDER) {
        const t = stats.byType[type];
        if (t.count === 0) continue;
        appendLog(`  ${type.padEnd(5)} ${String(t.count).padStart(6)}  ${formatBytes(t.bytes)}`);
    }
}

async function runStats() {
    const user = document.getElementById('imgcmp-user')?.value;
    if (!user) return;

    const progressWrap = document.getElementById('imgcmp-progress-wrap');
    const log = document.getElementById('imgcmp-log');

    log.textContent = '';
    log.style.display = 'none';
    progressWrap.style.display = 'none';
    setRunning(true);

    try {
        const stats = await fetchStats(user);
        appendLog('Images (user/images/):');
        appendDirStats('  Total', stats.images);
        appendLog('');
        appendLog('Characters:');
        appendDirStats('  Total', stats.characters);
    } catch (err) {
        appendLog(`Error: ${err.message}`);
        console.error(MODULE_NAME, err);
        toastr.error('Failed to load stats. See the log for details.', 'Image Compressor');
    } finally {
        setRunning(false);
    }
}

// ── Job runner ───────────────────────────────────────────────────────────────

async function runJob(endpoint) {
    const user = document.getElementById('imgcmp-user')?.value;
    if (!user) return;

    const progressWrap = document.getElementById('imgcmp-progress-wrap');
    const bar = document.getElementById('imgcmp-bar');
    const label = document.getElementById('imgcmp-progress-label');
    const pct = document.getElementById('imgcmp-progress-pct');
    const log = document.getElementById('imgcmp-log');

    // Reset UI
    log.textContent = '';
    log.style.display = 'none';
    bar.style.width = '0%';
    pct.textContent = '0%';
    label.textContent = 'Scanning files...';
    progressWrap.style.display = 'block';
    setRunning(true);

    try {
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ user }),
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({ error: res.statusText }));
            appendLog(`Error: ${err.error}`);
            toastr.error(err.error, 'Image Compressor');
            return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';

            for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                try {
                    const event = JSON.parse(line.slice(6));
                    if (event.type === 'progress') {
                        bar.style.width = `${event.percent}%`;
                        pct.textContent = `${event.percent}%`;
                        label.textContent = `Processing... ${event.current.toLocaleString()} / ${event.total.toLocaleString()}`;
                    } else if (event.type === 'complete') {
                        const r = event.result;
                        bar.style.width = '100%';
                        pct.textContent = '100%';
                        label.textContent = 'Done';
                        appendLog(`Scanned:    ${r.filesScanned.toLocaleString()}`);
                        appendLog(`Skipped:    ${r.filesSkipped.toLocaleString()}`);
                        appendLog(`Compressed: ${r.filesCompressed.toLocaleString()}`);
                        appendLog(`Saved:      ${formatBytes(r.bytesSaved)}`);
                        if (r.errors.length > 0) {
                            appendLog(`\nErrors (${r.errors.length}):`);
                            for (const e of r.errors) appendLog(`  ${e}`);
                        }
                        toastr.success(`Saved ${formatBytes(r.bytesSaved)} across ${r.filesCompressed.toLocaleString()} files`, 'Image Compressor');

                        try {
                            const stats = await fetchStats(user);
                            appendLog('');
                            appendLog('Current state:');
                            appendLog('Images (user/images/):');
                            appendDirStats('  Total', stats.images);
                            appendLog('');
                            appendLog('Characters:');
                            appendDirStats('  Total', stats.characters);
                        } catch {
                            // stats are a nice-to-have after a run; ignore failures here
                        }
                    }
                } catch {
                    // malformed SSE line, skip
                }
            }
        }
    } catch (err) {
        appendLog(`Error: ${err.message}`);
        console.error(MODULE_NAME, err);
        toastr.error('Compression failed. See the log for details.', 'Image Compressor');
    } finally {
        setRunning(false);
    }
}

// ── Settings panel injection ─────────────────────────────────────────────────

async function refreshUsers() {
    const users = await fetchUsers();
    const select = document.getElementById('imgcmp-user');
    if (!select) return;
    const current = select.value;
    select.innerHTML = users.map(u => `<option value="${u}">${u}</option>`).join('');
    if (users.includes(current)) select.value = current;
}

function injectPanel(users) {
    if (document.getElementById('imgcmp-panel')) return;
    const container = document.querySelector('#extensions_settings2') || document.querySelector('#extensions_settings');
    if (!container) return;

    const panel = buildPanel(users);
    container.appendChild(panel);

    document.getElementById('imgcmp-refresh').addEventListener('click', refreshUsers);
    document.getElementById('imgcmp-run').addEventListener('click', () => runJob(`${PLUGIN_BASE}/compress`));
    document.getElementById('imgcmp-reprocess').addEventListener('click', () => runJob(`${PLUGIN_BASE}/reprocess-all`));
    document.getElementById('imgcmp-stats').addEventListener('click', runStats);
}

// ── Main ─────────────────────────────────────────────────────────────────────

const available = await probePlugin();

if (!available) {
    toastr.warning(
        'Image Compressor server plugin is not available.',
        'Image Compressor',
        { timeOut: 0, closeButton: true },
    );
} else {
    const users = await fetchUsers();

    const tryInject = () => {
        const container = document.querySelector('#extensions_settings2') || document.querySelector('#extensions_settings');
        if (!container) return false;
        injectPanel(users);
        return true;
    };

    if (!tryInject()) {
        const observer = new MutationObserver(() => {
            if (tryInject()) observer.disconnect();
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }
}
