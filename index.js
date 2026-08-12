// JJK Cursed Energy & Domain Tracker
// A persistent floating HUD extension for SillyTavern:
//   1. Cursed Energy meter — survives across messages/reloads, no AI JSON required.
//   2. Domain Expansion cooldown — counts real message turns and warns the AI
//      via prompt injection while on cooldown.
//
// NOTE FOR THE USER: this was written against SillyTavern's stable global
// extension API (window.SillyTavern.getContext()) — the version-independent
// entry point ST recommends specifically so extensions don't break on
// relative-path imports across versions. It could not be tested against a
// live SillyTavern instance while building it. Every ST API call below is
// wrapped in try/catch with a console.log/console.warn so that if something
// doesn't match your ST version, the HUD still loads and you can see exactly
// what failed in the browser console (F12) to report back.

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

    function ctx() {
        try {
            if (window.SillyTavern && typeof window.SillyTavern.getContext === 'function') {
                return window.SillyTavern.getContext();
            }
        } catch (e) {
            console.warn('[jjk-cursed-tracker] SillyTavern.getContext() threw:', e);
        }
        return null;
    }

    function getSettings() {
        const c = ctx();
        const store = c && c.extensionSettings ? c.extensionSettings : null;
        if (!store) {
            if (!window.__jjkFallbackSettings) {
                console.warn('[jjk-cursed-tracker] context.extensionSettings not found — using in-memory fallback (will NOT persist across reloads). Check the console for a getContext() error above.');
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
            } else {
                console.warn('[jjk-cursed-tracker] context.saveSettingsDebounced not found — settings may not persist across reloads.');
            }
        } catch (e) {
            console.warn('[jjk-cursed-tracker] persist() failed:', e);
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
        if (!c || typeof c.setExtensionPrompt !== 'function') {
            return; // silently skip — HUD still works without this
        }
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
            // position 1 = in-chat depth-based injection in most ST versions; depth 0 = right before the next generation.
            c.setExtensionPrompt(EXT_PROMPT_KEY, note, 1, 0, false);
        } catch (e) {
            console.warn('[jjk-cursed-tracker] setExtensionPrompt failed — cooldown will still show in the HUD but will not be auto-reminded to the AI:', e);
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
                        console.log('[jjk-cursed-tracker] Domain Expansion detected — cooldown started.');
                    } else {
                        console.warn('[jjk-cursed-tracker] Domain Expansion keyword appeared while still on cooldown (the AI may have ignored the reminder).');
                    }
                }
            }
        } catch (e) {
            console.warn('[jjk-cursed-tracker] message scan failed:', e);
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
            </div>
            <div id="jjk-hud-pill">
                <span id="jjk-hud-glyph">呪</span>
                <div id="jjk-hud-ce-wrap">
                    <div id="jjk-hud-ce-track"><div id="jjk-hud-ce-fill" style="width:0%"></div></div>
                    <span id="jjk-hud-ce-val">— / —</span>
                </div>
                <span id="jjk-hud-domain-badge" class="ready">Domain: —</span>
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

        handle.addEventListener('mousedown', (e) => {
            dragging = true;
            container.classList.remove('was-dragged');
            handle.classList.add('dragging');
            const rect = container.getBoundingClientRect();
            startX = e.clientX; startY = e.clientY;
            startLeft = rect.left; startTop = rect.top;
            e.preventDefault();
        });
        window.addEventListener('mousemove', (e) => {
            if (!dragging) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            if (Math.abs(dx) > 4 || Math.abs(dy) > 4) container.classList.add('was-dragged');
            container.style.left = (startLeft + dx) + 'px';
            container.style.top = (startTop + dy) + 'px';
            container.style.right = 'auto';
            container.style.bottom = 'auto';
        });
        window.addEventListener('mouseup', () => {
            if (!dragging) return;
            dragging = false;
            handle.classList.remove('dragging');
            const s = getSettings();
            s.hudPos = { left: container.style.left, top: container.style.top };
            persist();
        });
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
    }

    // ── Extensions-panel settings drawer (best-effort — HUD works without it) ─
    function buildSettingsPanel() {
        const container = document.getElementById('extensions_settings2') || document.getElementById('extensions_settings');
        if (!container) {
            console.warn('[jjk-cursed-tracker] Extensions settings container not found — HUD still works, it just will not show a drawer in the Extensions panel. Use the floating pill instead.');
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
        if (!c) {
            console.error('[jjk-cursed-tracker] window.SillyTavern.getContext() is not available. This extension needs a reasonably recent SillyTavern version. The HUD will not load. Open the browser console for details.');
            return;
        }
        buildHud();
        buildSettingsPanel();
        renderHud();
        updateExtensionPrompt();

        try {
            if (c.eventSource && c.event_types && c.event_types.MESSAGE_RECEIVED) {
                c.eventSource.on(c.event_types.MESSAGE_RECEIVED, onMessageReceived);
                console.log('[jjk-cursed-tracker] hooked MESSAGE_RECEIVED — Domain cooldown will auto-advance.');
            } else {
                console.warn('[jjk-cursed-tracker] context.eventSource/event_types not found — Domain cooldown will NOT auto-advance on new messages. Use "Mark Used Now" / "Force Ready" manually in the HUD panel.');
            }
        } catch (e) {
            console.warn('[jjk-cursed-tracker] event hook failed:', e);
        }

        console.log('[jjk-cursed-tracker] initialized.');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
