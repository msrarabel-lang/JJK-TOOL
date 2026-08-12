// JJK Cursed Energy & Domain Tracker
// A persistent floating HUD extension for SillyTavern:
//   1. Cursed Energy meter — survives across messages/reloads, no AI JSON required.
//   2. Domain Expansion cooldown — counts real message turns and warns the AI
//      via prompt injection while on cooldown.
//
// v1.1 — hardened after a real-world install report where the HUD never
// appeared. This version:
//   - Tries several ways to find SillyTavern's context API, not just one.
//   - ALWAYS builds the floating HUD, even if no context API is found at all
//     (falls back to in-memory-only settings so the pill is never invisible).
//   - Keeps an on-screen debug log (tap "🐞 Debug Log" in the HUD panel) so
//     you can read diagnostics on a PHONE without needing browser devtools.

(function () {
    const extensionName = 'jjk-cursed-tracker';
    const EXT_PROMPT_KEY = 'jjk_domain_cooldown_note';

    const defaultSettings = {
        enabled: true,
        ceCur: 100,
        ceMax: 100,
        domainCooldownLength: 15,   // messages
        domainLastUsedTurn: -9999,  // turn index when Domain was last marked used
        domainKeyword: 'domain expansion',
        turnCount: 0,
        hudPos: null,               // {left, top} once user drags it, else default bottom-right
    };

    // ── On-screen debug log (readable on mobile, no devtools needed) ──────
    const debugLines = [];
    function dlog(level, ...args) {
        const msg = args.map((a) => {
            try { return typeof a === 'string' ? a : JSON.stringify(a); }
            catch (e) { return String(a); }
        }).join(' ');
        const line = `[${level}] ${msg}`;
        debugLines.push(line);
        if (debugLines.length > 60) debugLines.shift();
        if (level === 'error') console.error('[jjk-cursed-tracker]', ...args);
        else if (level === 'warn') console.warn('[jjk-cursed-tracker]', ...args);
        else console.log('[jjk-cursed-tracker]', ...args);
        refreshDebugPanel();
    }
    function refreshDebugPanel() {
        const el = document.getElementById('jjk-debug-log');
        if (el) el.textContent = debugLines.join('\n');
    }

    // ── Find SillyTavern's context API — try several known access paths ───
    function ctx() {
        const attempts = [
            () => window.SillyTavern && window.SillyTavern.getContext && window.SillyTavern.getContext(),
            () => window.parent && window.parent.SillyTavern && window.parent.SillyTavern.getContext && window.parent.SillyTavern.getContext(),
            () => typeof window.getContext === 'function' && window.getContext(),
            () => window.top && window.top.SillyTavern && window.top.SillyTavern.getContext && window.top.SillyTavern.getContext(),
        ];
        for (const attempt of attempts) {
            try {
                const result = attempt();
                if (result) return result;
            } catch (e) {
                // try next
            }
        }
        return null;
    }

    let contextFound = false;

    function getSettings() {
        const c = ctx();
        const store = c && c.extensionSettings ? c.extensionSettings : null;
        if (!store) {
            if (!window.__jjkFallbackSettings) {
                window.__jjkFallbackSettings = structuredClone(defaultSettings);
            }
            return window.__jjkFallbackSettings;
        }
        if (!store[extensionName]) {
            store[extensionName] = structuredClone(defaultSettings);
        }
        for (const key in defaultSettings) {
            if (store[extensionName][key] === undefined) {
                store[extensionName][key] = defaultSettings[key];
            }
        }
        return store[extensionName];
    }

    function persist() {
        const c = ctx();
        try {
            if (c && typeof c.saveSettingsDebounced === 'function') {
                c.saveSettingsDebounced();
            }
        } catch (e) {
            dlog('warn', 'persist() failed:', e && e.message);
        }
    }

    // ── Domain cooldown math ────────────────────────────────────────────
    function domainTurnsRemaining(s) {
        const elapsed = s.turnCount - s.domainLastUsedTurn;
        const remaining = s.domainCooldownLength - elapsed;
        return Math.max(0, remaining);
    }
    function domainIsReady(s) {
        return domainTurnsRemaining(s) <= 0;
    }

    // ── Prompt injection: warn the AI while Domain is on cooldown ───────
    function updateExtensionPrompt() {
        const s = getSettings();
        const c = ctx();
        if (!c || typeof c.setExtensionPrompt !== 'function') return;
        try {
            if (!s.enabled) {
                c.setExtensionPrompt(EXT_PROMPT_KEY, '', 1, 0, false);
                return;
            }
            const remaining = domainTurnsRemaining(s);
            let note = '';
            if (remaining > 0) {
                note = `[SYSTEM NOTE: {{char}}'s Domain Expansion is on cooldown — ${remaining} more message(s) before it can be used again. Do not have {{char}} use Domain Expansion until the cooldown ends.]`;
            }
            c.setExtensionPrompt(EXT_PROMPT_KEY, note, 1, 0, false);
        } catch (e) {
            dlog('warn', 'setExtensionPrompt failed:', e && e.message);
        }
    }

    // ── Message scanning: detect Domain Expansion usage, advance turn count ─
    function onMessageReceived() {
        const s = getSettings();
        if (!s.enabled) return;
        s.turnCount += 1;

        try {
            const c = ctx();
            const chat = c && c.chat;
            if (chat && chat.length) {
                const lastMsg = chat[chat.length - 1];
                const text = (lastMsg && lastMsg.mes) ? String(lastMsg.mes).toLowerCase() : '';
                const keyword = (s.domainKeyword || 'domain expansion').toLowerCase();
                if (keyword && text.includes(keyword)) {
                    if (domainIsReady(s)) {
                        s.domainLastUsedTurn = s.turnCount;
                        dlog('log', 'Domain Expansion detected — cooldown started.');
                    } else {
                        dlog('warn', 'Domain Expansion keyword appeared while still on cooldown.');
                    }
                }
            }
        } catch (e) {
            dlog('warn', 'message scan failed:', e && e.message);
        }

        persist();
        renderHud();
        updateExtensionPrompt();
    }

    // ── HUD DOM ───────────────────────────────────────────────────────────
    function buildHud() {
        if (document.getElementById('jjk-hud')) return;

        const hud = document.createElement('div');
        hud.id = 'jjk-hud';
        hud.innerHTML = `
            <div id="jjk-hud-panel">
                <div class="jjk-panel-title">Cursed Energy <span class="jjk-panel-close" id="jjk-panel-close">&times;</span></div>
                <div id="jjk-context-warning" style="display:none"></div>
                <div class="jjk-panel-row">
                    <div class="jjk-panel-lbl"><span>Reserve</span><span id="jjk-ce-numbers">— / —</span></div>
                    <div class="jjk-btn-row">
                        <div class="jjk-btn" data-ce="-25">-25</div>
                        <div class="jjk-btn" data-ce="-5">-5</div>
                        <div class="jjk-btn" data-ce="+5">+5</div>
                        <div class="jjk-btn" data-ce="+25">+25</div>
                    </div>
                    <div class="jjk-btn-row" style="margin-top:6px">
                        <div class="jjk-btn wide" id="jjk-ce-full">Full Restore</div>
                    </div>
                </div>
                <div class="jjk-panel-row">
                    <div class="jjk-panel-lbl"><span>Max Cursed Energy</span></div>
                    <div class="jjk-btn-row">
                        <input type="number" class="jjk-input" id="jjk-ce-max-input" min="1">
                        <div class="jjk-btn" id="jjk-ce-max-set">Set</div>
                    </div>
                </div>
                <div class="jjk-panel-row">
                    <div class="jjk-panel-lbl"><span>Domain Expansion</span><span id="jjk-domain-status">—</span></div>
                    <div class="jjk-btn-row">
                        <div class="jjk-btn" id="jjk-domain-use">Mark Used Now</div>
                        <div class="jjk-btn" id="jjk-domain-ready">Force Ready</div>
                    </div>
                    <div class="jjk-panel-lbl" style="margin-top:8px"><span>Cooldown length (messages)</span></div>
                    <div class="jjk-btn-row">
                        <input type="number" class="jjk-input" id="jjk-domain-cd-input" min="1">
                        <div class="jjk-btn" id="jjk-domain-cd-set">Set</div>
                    </div>
                    <div class="jjk-panel-note">Detects the trigger phrase (editable below, default "domain expansion") in {{char}}'s messages to auto-start the cooldown. Use "Mark Used Now" if it's phrased differently that time.</div>
                </div>
                <div class="jjk-panel-row">
                    <div class="jjk-panel-lbl"><span>Trigger phrase</span></div>
                    <div class="jjk-btn-row">
                        <input type="text" class="jjk-input" id="jjk-keyword-input" style="width:100%;text-align:left" placeholder="domain expansion">
                    </div>
                </div>
                <div class="jjk-panel-row">
                    <div class="jjk-btn wide" id="jjk-debug-toggle">🐞 Debug Log</div>
                    <pre id="jjk-debug-log" style="display:none"></pre>
                </div>
            </div>
            <div id="jjk-hud-pill">
                <span id="jjk-hud-glyph">呪</span>
                <div id="jjk-hud-ce-wrap">
                    <div id="jjk-hud-ce-track"><div id="jjk-hud-ce-fill" style="width:0%"></div></div>
                    <span id="jjk-hud-ce-val">— / —</span>
                </div>
                <span id="jjk-hud-domain-badge" class="ready">Domain: —</span>
                <span id="jjk-hud-warn-dot" style="display:none" title="Limited mode — tap for details">⚠</span>
            </div>
        `;
        document.body.appendChild(hud);

        document.getElementById('jjk-hud-pill').addEventListener('click', () => {
            if (hud.classList.contains('was-dragged')) { hud.classList.remove('was-dragged'); return; }
            document.getElementById('jjk-hud-panel').classList.toggle('open');
        });
        document.getElementById('jjk-panel-close').addEventListener('click', () => {
            document.getElementById('jjk-hud-panel').classList.remove('open');
        });
        document.getElementById('jjk-debug-toggle').addEventListener('click', () => {
            const el = document.getElementById('jjk-debug-log');
            el.style.display = el.style.display === 'none' ? 'block' : 'none';
            refreshDebugPanel();
        });

        hud.querySelectorAll('[data-ce]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const s = getSettings();
                const delta = parseInt(btn.getAttribute('data-ce'), 10);
                s.ceCur = Math.max(0, Math.min(s.ceMax, s.ceCur + delta));
                persist();
                renderHud();
            });
        });
        document.getElementById('jjk-ce-full').addEventListener('click', () => {
            const s = getSettings();
            s.ceCur = s.ceMax;
            persist();
            renderHud();
        });
        document.getElementById('jjk-ce-max-set').addEventListener('click', () => {
            const s = getSettings();
            const val = parseInt(document.getElementById('jjk-ce-max-input').value, 10);
            if (!isNaN(val) && val > 0) {
                s.ceMax = val;
                s.ceCur = Math.min(s.ceCur, s.ceMax);
                persist();
                renderHud();
            }
        });

        document.getElementById('jjk-domain-use').addEventListener('click', () => {
            const s = getSettings();
            s.domainLastUsedTurn = s.turnCount;
            persist();
            renderHud();
            updateExtensionPrompt();
        });
        document.getElementById('jjk-domain-ready').addEventListener('click', () => {
            const s = getSettings();
            s.domainLastUsedTurn = -9999;
            persist();
            renderHud();
            updateExtensionPrompt();
        });
        document.getElementById('jjk-domain-cd-set').addEventListener('click', () => {
            const s = getSettings();
            const val = parseInt(document.getElementById('jjk-domain-cd-input').value, 10);
            if (!isNaN(val) && val > 0) {
                s.domainCooldownLength = val;
                persist();
                renderHud();
                updateExtensionPrompt();
            }
        });
        document.getElementById('jjk-keyword-input').addEventListener('change', (e) => {
            const s = getSettings();
            s.domainKeyword = e.target.value || 'domain expansion';
            persist();
        });

        makeDraggable(document.getElementById('jjk-hud-pill'), hud);
    }

    function makeDraggable(handle, container) {
        let dragging = false;
        let startX, startY, startLeft, startTop;

        function down(clientX, clientY) {
            dragging = true;
            container.classList.remove('was-dragged');
            handle.classList.add('dragging');
            const rect = container.getBoundingClientRect();
            startX = clientX; startY = clientY;
            startLeft = rect.left; startTop = rect.top;
        }
        function move(clientX, clientY) {
            if (!dragging) return;
            const dx = clientX - startX;
            const dy = clientY - startY;
            if (Math.abs(dx) > 4 || Math.abs(dy) > 4) container.classList.add('was-dragged');
            container.style.left = (startLeft + dx) + 'px';
            container.style.top = (startTop + dy) + 'px';
            container.style.right = 'auto';
            container.style.bottom = 'auto';
        }
        function up() {
            if (!dragging) return;
            dragging = false;
            handle.classList.remove('dragging');
            const s = getSettings();
            s.hudPos = { left: container.style.left, top: container.style.top };
            persist();
        }

        handle.addEventListener('mousedown', (e) => { down(e.clientX, e.clientY); e.preventDefault(); });
        window.addEventListener('mousemove', (e) => move(e.clientX, e.clientY));
        window.addEventListener('mouseup', up);

        // Touch support for mobile
        handle.addEventListener('touchstart', (e) => {
            const t = e.touches[0];
            down(t.clientX, t.clientY);
        }, { passive: true });
        window.addEventListener('touchmove', (e) => {
            if (!dragging) return;
            const t = e.touches[0];
            move(t.clientX, t.clientY);
        }, { passive: true });
        window.addEventListener('touchend', up);
    }

    function renderHud() {
        const s = getSettings();
        const hud = document.getElementById('jjk-hud');
        if (!hud) return;

        if (!s.enabled) { hud.style.display = 'none'; return; }
        hud.style.display = 'block';

        if (s.hudPos && s.hudPos.left) {
            hud.style.left = s.hudPos.left;
            hud.style.top = s.hudPos.top;
            hud.style.right = 'auto';
            hud.style.bottom = 'auto';
        }

        const pct = s.ceMax > 0 ? Math.max(0, Math.min(100, Math.round((s.ceCur / s.ceMax) * 100))) : 0;
        document.getElementById('jjk-hud-ce-fill').style.width = pct + '%';
        document.getElementById('jjk-hud-ce-val').textContent = `${s.ceCur} / ${s.ceMax}`;
        document.getElementById('jjk-ce-numbers').textContent = `${s.ceCur} / ${s.ceMax}`;
        document.getElementById('jjk-ce-max-input').value = s.ceMax;
        document.getElementById('jjk-domain-cd-input').value = s.domainCooldownLength;
        document.getElementById('jjk-keyword-input').value = s.domainKeyword;

        const badge = document.getElementById('jjk-hud-domain-badge');
        const statusEl = document.getElementById('jjk-domain-status');
        const remaining = domainTurnsRemaining(s);
        if (remaining <= 0) {
            badge.textContent = 'Domain: READY';
            badge.className = 'ready';
            statusEl.textContent = 'Ready';
        } else {
            badge.textContent = `Domain: ${remaining} turn${remaining === 1 ? '' : 's'}`;
            badge.className = 'cooldown';
            statusEl.textContent = `${remaining} turn(s) left`;
        }

        const warnDot = document.getElementById('jjk-hud-warn-dot');
        const warnBox = document.getElementById('jjk-context-warning');
        if (!contextFound) {
            warnDot.style.display = 'inline';
            warnBox.style.display = 'block';
            warnBox.innerHTML = '⚠ Running in limited mode: could not find SillyTavern\'s extension API. Cursed Energy still works but will NOT be saved after you reload the page, and the Domain cooldown will not auto-advance or warn the AI. Tap "🐞 Debug Log" below and send a screenshot to get this fixed.';
        } else {
            warnDot.style.display = 'none';
            warnBox.style.display = 'none';
        }

        refreshDebugPanel();
    }

    // ── Extensions-panel settings drawer (best-effort — HUD works without it) ─
    function buildSettingsPanel() {
        const container = document.getElementById('extensions_settings2') || document.getElementById('extensions_settings');
        if (!container) {
            dlog('warn', 'Extensions settings container not found — using floating pill only.');
            return;
        }
        if (document.getElementById('jjk-settings-drawer')) return;

        const s = getSettings();
        const block = document.createElement('div');
        block.id = 'jjk-settings-drawer';
        block.className = 'jjk-settings-block';
        block.innerHTML = `
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b>JJK Cursed Energy & Domain Tracker</b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content">
                    <div class="jjk-settings-row">
                        <label for="jjk-settings-enabled">Enable HUD</label>
                        <input type="checkbox" id="jjk-settings-enabled" ${s.enabled ? 'checked' : ''}>
                    </div>
                    <div class="jjk-panel-note">Drag the floating pill (bottom-right by default) to reposition it. Click it to adjust Cursed Energy and Domain cooldown directly — including the trigger phrase.</div>
                </div>
            </div>
        `;
        container.appendChild(block);

        document.getElementById('jjk-settings-enabled').addEventListener('change', (e) => {
            const st = getSettings();
            st.enabled = e.target.checked;
            persist();
            renderHud();
            updateExtensionPrompt();
        });
    }

    // ── Init ─────────────────────────────────────────────────────────────
    function init() {
        const c = ctx();
        contextFound = !!c;
        if (!contextFound) {
            dlog('error', 'No SillyTavern context API found via any known access path. Building the HUD anyway in limited (non-persistent) mode.');
        } else {
            dlog('log', 'context found. keys:', c ? Object.keys(c).slice(0, 20).join(',') : 'none');
        }

        buildHud();
        if (contextFound) buildSettingsPanel();
        renderHud();
        updateExtensionPrompt();

        try {
            if (c && c.eventSource && c.event_types && c.event_types.MESSAGE_RECEIVED) {
                c.eventSource.on(c.event_types.MESSAGE_RECEIVED, onMessageReceived);
                dlog('log', 'hooked MESSAGE_RECEIVED — Domain cooldown will auto-advance.');
            } else {
                dlog('warn', 'eventSource/event_types not found — Domain cooldown will not auto-advance. Use manual buttons.');
            }
        } catch (e) {
            dlog('warn', 'event hook failed:', e && e.message);
        }

        dlog('log', 'initialized. contextFound=' + contextFound);
    }

    function boot() {
        try {
            init();
        } catch (e) {
            // Absolute last resort: something threw during init itself.
            // Still try to show a bare-bones HUD so the user sees *something*.
            console.error('[jjk-cursed-tracker] init() threw:', e);
            try {
                if (!document.getElementById('jjk-hud')) {
                    buildHud();
                    renderHud();
                }
            } catch (e2) {
                console.error('[jjk-cursed-tracker] even the fallback HUD build failed:', e2);
            }
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
    // Extensions can sometimes load before SillyTavern's own app is fully
    // ready; retry once after a short delay in case ctx() was null too early.
    setTimeout(() => {
        if (!contextFound) {
            dlog('log', 'retrying context detection after delay...');
            boot();
        }
    }, 2500);
})();
