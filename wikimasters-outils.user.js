// ==UserScript==
// @name         WikiMasters – Outils (packs auto, défausse, analyse, vente)
// @namespace    remi.wikimasters
// @version      4.2
// @description  Ouverture auto des packs + défausse par rareté + analyse + vente. Accès par identifiant.
// @match        https://www.wiki-masters.com/*
// @match        https://wiki-masters.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        unsafeWindow
// @grant        GM.xmlHttpRequest
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM.deleteValue
// @connect      djqiebvxomunucoxaslv.supabase.co
// @run-at       document-idle
// @updateURL    https://remsko.github.io/wikimasters-cloud/wikimasters-outils.user.js
// @downloadURL  https://remsko.github.io/wikimasters-cloud/wikimasters-outils.user.js
// ==/UserScript==

(function () {
  'use strict';
  if (window.__wmTools) return;
  window.__wmTools = true;

  // ===================== COMPATIBILITÉ PC / ANDROID / IPHONE =====================
  // Tampermonkey fournit GM_xxx, l'appli Userscripts (iPhone) fournit GM.xxx (asynchrone).
  const G = (typeof GM !== 'undefined') ? GM : {};
  const gmRequest = (o) => (typeof GM_xmlhttpRequest === 'function' ? GM_xmlhttpRequest(o) : G.xmlHttpRequest(o));
  const gmGet = async (k, d) => {
    try { return typeof GM_getValue === 'function' ? GM_getValue(k, d) : await G.getValue(k, d); } catch (e) { return d; }
  };
  const gmSet = async (k, v) => {
    try { return typeof GM_setValue === 'function' ? GM_setValue(k, v) : await G.setValue(k, v); } catch (e) {}
  };
  const gmDel = async (k) => {
    try { return typeof GM_deleteValue === 'function' ? GM_deleteValue(k) : await G.deleteValue(k); } catch (e) {}
  };
  const isMobile = () => window.matchMedia('(max-width: 600px), (pointer: coarse)').matches;
  // Taille du panneau adaptée à l'écran (téléphone compris).
  const CLOUD_URL = 'https://remsko.github.io/wikimasters-cloud/';
  const PANEL_POS = 'position:fixed;left:12px;top:12px;z-index:999999;max-width:calc(100vw - 24px);box-sizing:border-box;';

  // ===================== CONNEXION =====================
  const API = 'https://djqiebvxomunucoxaslv.supabase.co/rest/v1/rpc/';
  const AUTH_KEY = 'sb_publishable_7DMTebFuGdNRz-61SmWdzA_rydnA9_8'; // clé publique : ne permet que d'appeler les fonctions prévues
  const OFFLINE_GRACE_MS = 24 * 3600 * 1000; // si le serveur ne répond pas, on garde l'accès 24 h

  // Appel d'une fonction du serveur. Renvoie la réponse, ou {ok:false, network:true} si injoignable.
  function rpc(name, args) {
    return new Promise((resolve) => {
      gmRequest({
        method: 'POST', url: API + name, timeout: 15000,
        headers: { apikey: AUTH_KEY, 'Content-Type': 'application/json' },
        data: JSON.stringify(args),
        onload: (r) => {
          let d; try { d = JSON.parse(r.responseText); } catch (e) { return resolve({ ok: false, network: true }); }
          if (r.status >= 400) return resolve({ ok: false, reason: (d && d.message) || 'Refusé par le serveur.' });
          resolve(d);
        },
        onerror: () => resolve({ ok: false, network: true }),
        ontimeout: () => resolve({ ok: false, network: true }),
      });
    });
  }
  const checkLogin = (user, pass) => rpc('wm_check_login', { p_user: user, p_pass: pass });

  const PANEL_CSS =
    PANEL_POS + 'background:#151918;color:#e8f5ee;' +
    'border:1px solid #2fd08a;border-radius:12px;padding:14px 16px;font:13px system-ui,sans-serif;' +
    'box-shadow:0 6px 24px rgba(0,0,0,.5);width:280px';
  const INP = 'width:100%;box-sizing:border-box;background:#0d100f;color:#e8f5ee;border:1px solid #333;border-radius:7px;padding:8px 10px;margin:4px 0;font-size:16px';
  const BTN = 'width:100%;margin-top:6px;background:#2fd08a;color:#08130d;border:0;border-radius:7px;padding:10px;font-weight:600;cursor:pointer;font-size:15px';

  function showLogin(message) {
    const box = document.createElement('div');
    box.style.cssText = PANEL_CSS;
    document.body.appendChild(box);
    const q = (id) => box.querySelector('#' + id);

    const loginView = (msg) => {
      box.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center"><b>🔒 WikiMasters – Outils</b>
          <span id="wml-x" style="cursor:pointer;opacity:.6">✕</span></div>
        <div style="opacity:.7;margin:6px 0 8px">Connecte-toi pour utiliser les outils.</div>
        <input id="wml-u" placeholder="Identifiant" autocomplete="username" style="${INP}">
        <input id="wml-p" type="password" placeholder="Mot de passe" autocomplete="current-password" style="${INP}">
        <button id="wml-go" style="${BTN}">Se connecter</button>
        <div id="wml-msg" style="margin-top:8px;color:#ff8a8a;min-height:1em"></div>
        <div id="wml-admin" style="margin-top:4px;font-size:11px;opacity:.5;cursor:pointer;text-align:right">J'ai un code admin</div>`;
      if (msg) q('wml-msg').textContent = msg;
      q('wml-x').onclick = () => box.remove();
      q('wml-admin').onclick = () => claimView();
      const go = async () => {
        const u = q('wml-u').value.trim(), p = q('wml-p').value;
        if (!u || !p) { q('wml-msg').textContent = 'Remplis les deux champs.'; return; }
        q('wml-go').disabled = true; q('wml-msg').style.color = '#e8f5ee'; q('wml-msg').textContent = 'Vérification…';
        const r = await checkLogin(u, p);
        q('wml-go').disabled = false; q('wml-msg').style.color = '#ff8a8a';
        if (r.network) { q('wml-msg').textContent = 'Serveur injoignable, réessaie.'; return; }
        if (!r.ok) { q('wml-msg').textContent = r.reason || 'Refusé.'; return; }
        await gmSet('wm_auth', { user: r.user || u, pass: p, okAt: Date.now(), admin: !!r.admin });
        box.remove();
        startTools(r.user || u, !!r.admin);
      };
      q('wml-go').onclick = go;
      q('wml-p').onkeydown = (e) => { if (e.key === 'Enter') go(); };
    };

    // Création du compte admin avec le code à usage unique.
    const claimView = () => {
      box.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center"><b>👑 Créer le compte admin</b>
          <span id="wml-back" style="cursor:pointer;opacity:.6">←</span></div>
        <div style="opacity:.7;margin:6px 0 8px">Le code ne marche qu'une seule fois.</div>
        <input id="wml-c" placeholder="Code admin (XXXX-XXXX-XXXX)" style="${INP}">
        <input id="wml-u" placeholder="Ton pseudo admin" autocomplete="username" style="${INP}">
        <input id="wml-p" type="password" placeholder="Mot de passe (8 caractères min.)" autocomplete="new-password" style="${INP}">
        <input id="wml-p2" type="password" placeholder="Répète le mot de passe" autocomplete="new-password" style="${INP}">
        <button id="wml-go" style="${BTN}">Créer mon compte admin</button>
        <div id="wml-msg" style="margin-top:8px;color:#ff8a8a;min-height:1em"></div>`;
      q('wml-back').onclick = () => loginView();
      q('wml-go').onclick = async () => {
        const c = q('wml-c').value.trim().toUpperCase(), u = q('wml-u').value.trim(), p = q('wml-p').value;
        if (!c || !u || !p) { q('wml-msg').textContent = 'Remplis tous les champs.'; return; }
        if (p !== q('wml-p2').value) { q('wml-msg').textContent = 'Les deux mots de passe sont différents.'; return; }
        q('wml-go').disabled = true;
        const r = await rpc('wm_admin_claim', { p_code: c, p_user: u, p_pass: p });
        q('wml-go').disabled = false;
        if (r.network) { q('wml-msg').textContent = 'Serveur injoignable, réessaie.'; return; }
        if (!r.ok) { q('wml-msg').textContent = r.reason || 'Refusé.'; return; }
        await gmSet('wm_auth', { user: r.user, pass: p, okAt: Date.now(), admin: true });
        box.remove();
        startTools(r.user, true);
      };
    };

    loginView(message);
  }

  // Au chargement : on revérifie l'identifiant enregistré (pour qu'un accès retiré soit coupé).
  (async () => {
    const saved = await gmGet('wm_auth', null);
    if (!saved) return showLogin();
    const r = await checkLogin(saved.user, saved.pass);
    if (r.ok) { await gmSet('wm_auth', { ...saved, okAt: Date.now(), admin: !!r.admin }); return startTools(r.user || saved.user, !!r.admin); }
    if (r.network && Date.now() - (saved.okAt || 0) < OFFLINE_GRACE_MS) return startTools(saved.user, false);
    await gmDel('wm_auth');
    showLogin(r.network ? 'Serveur injoignable, reconnecte-toi.' : (r.reason || 'Reconnecte-toi.'));
  })();

  function startTools(currentUser, isAdmin) {
  // Les appels au site passent par la page elle-même (cookies de connexion WikiMasters).
  const pageFetch = (typeof unsafeWindow !== 'undefined' && unsafeWindow.fetch) ? unsafeWindow.fetch.bind(unsafeWindow) : window.fetch.bind(window);
  const fetch = (url, opts = {}) => pageFetch(url, { credentials: 'include', ...opts });

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const btns = () => [...document.querySelectorAll('main button')];
  const RARITY_ORDER = ['L', 'UR', 'SR', 'R', 'PC', 'C'];
  const RARITY_NAME = { L: 'Légendaire', UR: 'UR', SR: 'SR', R: 'Rare', PC: 'PC', C: 'Commune' };

  // ===================== PANNEAU =====================
  const box = document.createElement('div');
  box.style.cssText =
    PANEL_POS + 'background:#151918;color:#e8f5ee;' +
    'border:1px solid #2fd08a;border-radius:12px;padding:12px 14px;font:13px system-ui,sans-serif;' +
    'box-shadow:0 6px 24px rgba(0,0,0,.5);width:320px;max-height:75vh;overflow:auto;-webkit-overflow-scrolling:touch';
  const B = (id, label, bg = '#2fd08a', fg = '#08130d') =>
    `<button id="${id}" style="background:${bg};color:${fg};border:0;border-radius:7px;padding:6px 10px;margin:3px 3px 3px 0;font-weight:600;cursor:pointer">${label}</button>`;
  box.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
      <b>🧰 WikiMasters – Outils</b>
      <span><span id="wm-user" style="opacity:.55;font-size:11px;margin-right:8px"></span><span id="wm-cloud" title="Ouvrir le site cloud" style="cursor:pointer;opacity:.9;margin-right:4px;padding:4px 6px;font-size:15px">☁️</span><span id="wm-logout" title="Se déconnecter" style="cursor:pointer;opacity:.8;margin-right:6px;padding:4px 6px;font-size:15px">⏏</span><span id="wm-min" style="cursor:pointer;opacity:.8;padding:4px 6px;font-size:15px">▁</span></span>
    </div>
    <div id="wm-body">
      <div class="wm-h" data-s="packs" style="font-weight:600;margin-top:4px;cursor:pointer">▾ 📦 Packs</div>
      <div class="wm-s" data-s="packs">
        <div id="wm-pack-status" style="opacity:.8">Ouverture auto à l'arrêt.</div>
        <label style="display:flex;gap:6px;align-items:center;margin:4px 0;cursor:pointer">
          <input type="checkbox" id="wm-batch"> Attendre d'avoir 10 paquets, puis tout ouvrir d'un coup</label>
        ${B('wm-pack', 'Lancer l\'ouverture auto')}
      </div>

      <div class="wm-h" data-s="cloud" style="font-weight:600;margin-top:10px;cursor:pointer">▾ ☁️ Cloud</div>
      <div class="wm-s" data-s="cloud">
        <label style="display:flex;gap:6px;align-items:center;margin:4px 0;cursor:pointer">
          <input type="checkbox" id="wm-agent"> Ce PC est le cloud de mon compte (garde cet onglet ouvert)</label>
        <div id="wm-agent-st" style="opacity:.75;font-size:12px"></div>
        ${B('wm-cloud-open', 'Ouvrir le site cloud', '#3a6ea5', '#fff')}
      </div>

      <div class="wm-h" data-s="discard" style="font-weight:600;margin-top:10px;cursor:pointer">▾ 🗑️ Défausser toutes les cartes…</div>
      <div class="wm-s" data-s="discard">
        <div style="opacity:.7;font-size:12px">Garde toujours : favoris, shiny, cartes en échange. Les Légendaires ne sont jamais défaussées.</div>
        ${B('wm-d-C', 'C', '#5b6b63', '#fff')}${B('wm-d-PC', 'PC', '#5b6b63', '#fff')}${B('wm-d-R', 'R', '#5b6b63', '#fff')}${B('wm-d-SR', 'SR', '#8a5bb0', '#fff')}${B('wm-d-UR', 'UR', '#c05050', '#fff')}
        <div id="wm-discard-status" style="opacity:.8"></div>
      </div>

      <div class="wm-h" data-s="analyse" style="font-weight:600;margin-top:10px;cursor:pointer">▾ 💰 Analyse</div>
      <div class="wm-s" data-s="analyse">
        ${B('wm-analyse', 'Analyser ma collection')}
        <div id="wm-analyse-out" style="font-size:12px"></div>
      </div>

      <div class="wm-h" data-s="sell" style="font-weight:600;margin-top:10px;cursor:pointer">▾ 🏷️ Vente aux enchères</div>
      <div class="wm-s" data-s="sell">
        <div style="opacity:.7;font-size:12px">Propose tes meilleures cartes (L, UR) au dernier prix auquel elles se sont vendues. Tu coches et tu valides.</div>
        ${B('wm-sell-prep', 'Préparer les ventes')}
        <div id="wm-sell-out" style="font-size:12px"></div>
      </div>
${isAdmin ? `
      <div class="wm-h" data-s="admin" style="font-weight:600;margin-top:10px;cursor:pointer;color:#e8b730">▾ 👑 Gestion des accès</div>
      <div class="wm-s" data-s="admin">
        <div style="opacity:.7;font-size:12px">Nouvel accès :</div>
        <input id="wm-adm-u" placeholder="Pseudo" style="width:100%;box-sizing:border-box;background:#0d100f;color:#e8f5ee;border:1px solid #333;border-radius:6px;padding:5px 7px;margin:3px 0">
        <div style="display:flex;gap:4px"><input id="wm-adm-p" placeholder="Mot de passe" style="width:100%;box-sizing:border-box;background:#0d100f;color:#e8f5ee;border:1px solid #333;border-radius:6px;padding:5px 7px;margin:3px 0;flex:1">
          <button id="wm-adm-gen" title="Générer un mot de passe" style="background:#333;color:#fff;border:0;border-radius:6px;margin:3px 0;padding:0 8px;cursor:pointer">🎲</button></div>
        <input id="wm-adm-n" placeholder="Note (ex : pour Jens)" style="width:100%;box-sizing:border-box;background:#0d100f;color:#e8f5ee;border:1px solid #333;border-radius:6px;padding:5px 7px;margin:3px 0">
        ${B('wm-adm-add', 'Créer l\'accès', '#e8b730')}${B('wm-adm-refresh', '↻', '#333', '#fff')}
        <div id="wm-adm-st" style="font-size:12px;margin:4px 0;word-break:break-all"></div>
        <div id="wm-adm-list" style="font-size:12px"></div>
      </div>` : ''}
    </div>`;
  document.body.appendChild(box);
  const $ = (id) => box.querySelector('#' + id);
  $('wm-user').textContent = currentUser;
  $('wm-logout').onclick = () => {
    if (!confirm('Se déconnecter des outils WikiMasters ?')) return;
    gmDel('wm_auth').then(() => location.reload());
  };
  // Réduire / agrandir tout le panneau (mémorisé). Sur téléphone, il démarre réduit.
  box.id = 'wm-box';
  const st = document.createElement('style');
  st.textContent = '#wm-box input,#wm-box select{font-size:16px}#wm-box button{min-height:30px}@media (max-width:600px){#wm-box{font-size:14px}}';
  document.head.appendChild(st);
  let minimized = null;
  try { minimized = localStorage.getItem('wm-minimized'); } catch (e) {}
  minimized = minimized === null ? isMobile() : minimized === '1';
  const applyMin = () => { $('wm-body').style.display = minimized ? 'none' : ''; $('wm-min').textContent = minimized ? '▢' : '▁'; };
  applyMin();
  $('wm-min').onclick = () => {
    minimized = !minimized; applyMin();
    try { localStorage.setItem('wm-minimized', minimized ? '1' : '0'); } catch (e) {}
  };

  // Sections repliables : clic sur le titre pour réduire / agrandir. L'état est mémorisé.
  let folded = {};
  try { folded = JSON.parse(localStorage.getItem('wm-folded') || '{}'); } catch (e) {}
  const setFold = (s, on) => {
    const h = box.querySelector(`.wm-h[data-s="${s}"]`), c = box.querySelector(`.wm-s[data-s="${s}"]`);
    c.style.display = on ? 'none' : '';
    h.textContent = (on ? '▸ ' : '▾ ') + h.textContent.slice(2);
  };
  box.querySelectorAll('.wm-h').forEach((h) => {
    const s = h.dataset.s;
    if (folded[s]) setFold(s, true);
    h.onclick = () => {
      folded[s] = !folded[s]; setFold(s, folded[s]);
      try { localStorage.setItem('wm-folded', JSON.stringify(folded)); } catch (e) {}
    };
  });
  // Quand on lance une analyse ou une vente, on rouvre sa section.
  const unfold = (s) => { if (folded[s]) { folded[s] = false; setFold(s, false); } };

  // ===================== 1. PACKS AUTO =====================
  let packsRunning = false, opened = 0;
  let pulled = []; // cartes sorties pendant la session : {rarity, title}
  // fromCloud : l'ordre vient du site cloud (pas de fenêtre de bilan, personne n'est devant l'écran).
  function setRunning(on, fromCloud) {
    if (on === packsRunning) return;
    packsRunning = on;
    $('wm-pack').textContent = packsRunning ? 'Arrêter' : 'Lancer l\'ouverture auto';
    $('wm-pack-status').textContent = packsRunning ? 'En marche…' : `Arrêté (${opened} ouverts).`;
    if (packsRunning) { opened = 0; pulled = []; reportedUpTo = 0; packLoop(); }
    else if (!fromCloud) showBilan();
  }
  let reportedUpTo = 0; // nombre de cartes de « pulled » déjà envoyées au cloud
  $('wm-pack').onclick = () => {
    setRunning(!packsRunning, false);
    if (typeof cloudSendCommand === 'function') cloudSendCommand();
  };
  // Lit la carte affichée : « Carte N / T », rareté, titre.
  function readShownCard() {
    const m = (document.querySelector('main')?.innerText || '').match(/Carte\s*\n\s*(\d+)\s*\n\s*\/\s*(\d+)\s*\n\s*(\S+)\s*\n\s*([^\n]+)/);
    return m ? { idx: +m[1], rarity: m[3], title: m[4].trim() } : null;
  }
  async function finishPack() {
    const seen = new Set();
    const note = () => {
      const c = readShownCard();
      if (c && RARITY_NAME[c.rarity] && !seen.has(c.idx)) { seen.add(c.idx); pulled.push({ rarity: c.rarity, title: c.title }); }
    };
    for (let k = 0; k < 25; k++) {
      note();
      const cont = btns().find((b) => b.innerText.trim() === 'Continuer' && !b.disabled);
      if (cont) { cont.click(); return true; }
      const arrows = btns().filter((b) => !b.innerText.trim() && b.querySelector('svg') && !b.getAttribute('aria-label'));
      const next = arrows[arrows.length - 1];
      if (next && !next.disabled) next.click();
      await sleep(1000);
    }
    return false;
  }
  // Mode « 10 par 10 » (mémorisé).
  let batchMode = false;
  try { batchMode = localStorage.getItem('wm-batch') === '1'; } catch (e) {}
  $('wm-batch').checked = batchMode;
  $('wm-batch').onchange = () => {
    batchMode = $('wm-batch').checked;
    try { localStorage.setItem('wm-batch', batchMode ? '1' : '0'); } catch (e) {}
    if (typeof cloudSendCommand === 'function') cloudSendCommand();
  };
  // Lit « N / M paquets disponibles » sur la page.
  function packCount() {
    const m = (document.querySelector('main')?.innerText || '').match(/(\d+)\s*\/\s*(\d+)\s*\n?\s*paquets disponibles/);
    return m ? { have: +m[1], max: +m[2] } : null;
  }

  async function packLoop() {
    let draining = false; // en mode 10 par 10 : vrai tant qu'on vide la réserve
    while (packsRunning) {
      try {
        if (!location.pathname.startsWith('/pulls')) {
          $('wm-pack-status').textContent = 'Va sur la page « Paquets » pour que ça tourne.';
          await sleep(5000); continue;
        }
        // Le pack PRO du jour est ouvert dès qu'il est dispo.
        const pro = btns().find((b) => b.innerText.includes('Ouvrir le pack PRO') && !b.disabled);
        const normal = btns().find((b) => b.innerText.trim() === 'Ouvrir' && !b.disabled);
        const c = packCount();
        if (c && c.have >= c.max) draining = true;
        if (c && c.have === 0) draining = false;
        let open = pro || null;
        if (!open && normal) {
          if (!batchMode) open = normal;
          else {
            if (draining || !c) open = normal;
            else $('wm-pack-status').textContent = `Réserve : ${c.have}/${c.max}, j'attends qu'elle soit pleine… (${opened} ouverts)`;
          }
        }
        // Jamais le bouton de recharge payante.
        if (open) {
          open.click(); await sleep(4500);
          if (await finishPack()) opened++;
          $('wm-pack-status').textContent = `En marche… ${opened} pack(s) ouverts`;
          if (typeof cloudReportPulls === 'function') cloudReportPulls();
          await sleep(2500);
        } else {
          if (!batchMode || !normal) $('wm-pack-status').textContent = `En attente du prochain pack… (${opened} ouverts)`;
          await sleep(batchMode ? 20000 : 5000);
        }
      } catch (e) { await sleep(5000); }
    }
  }


  // ===================== RÉCUP COLLECTION =====================
  async function fetchCollection(onProgress, rarity) {
    const rq = rarity ? `&rarity=${rarity}` : '';
    const first = await (await fetch(`/api/my-collection?sort=rarity${rq}&page=0&stats=1`)).json();
    const items = [...first.collection];
    const pending = new Set(first.pendingTradeCardIds || []);
    const pageSize = first.collection.length || 50;
    const pages = Math.ceil(first.total / pageSize);
    for (let p = 1; p < pages; p += 4) {
      const batch = [];
      for (let q = p; q < Math.min(p + 4, pages); q++)
        batch.push(fetch(`/api/my-collection?sort=rarity${rq}&page=${q}&stats=0`).then((r) => r.json()));
      for (const j of await Promise.all(batch)) items.push(...(j.collection || []));
      onProgress && onProgress(items.length, first.total);
    }
    // dédoublonnage par id
    const seen = new Set();
    return { items: items.filter((x) => !seen.has(x.id) && seen.add(x.id)), pending, counts: first.rarityCounts };
  }

  // ===================== 2. DÉFAUSSE =====================
  async function postDiscard(ids) {
    const r = await fetch('/api/user-cards/bulk-discard', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ card_ids: ids }),
    });
    return r.ok;
  }
  async function discardRarity(rar) {
    const st = $('wm-discard-status');
    st.textContent = 'Lecture de la collection…';
    const { items, pending } = await fetchCollection((n, t) => (st.textContent = `Lecture… ${n}/${t}`), rar);
    const targets = items.filter((x) =>
      x.card?.rarity === rar && !x.starred && !x.is_shiny && !pending.has(x.id) && !pending.has(x.card_id));
    const kept = items.filter((x) => x.card?.rarity === rar).length - targets.length;
    if (!targets.length) { st.textContent = `Aucune carte ${rar} à défausser.`; return; }
    const copies = targets.reduce((s, x) => s + (x.count || 1), 0);
    let msg = `Défausser ${copies} carte(s) ${RARITY_NAME[rar]} ?\n(${kept} gardée(s) : favoris / shiny / en échange)\n\nC'est DÉFINITIF.`;
    if (!confirm(msg)) { st.textContent = 'Annulé.'; return; }
    if ((rar === 'UR' || rar === 'SR') && !confirm(`Vraiment sûr ? Les ${rar} valent plus cher que les communes.`)) { st.textContent = 'Annulé.'; return; }

    // Premier envoi d'une seule carte pour vérifier que ça marche bien.
    const before = (await (await fetch('/api/my-collection?sort=rarity&page=0&stats=1')).json()).total;
    if (!(await postDiscard([targets[0].id]))) { st.textContent = '❌ Le site a refusé la défausse. Rien d\'autre n\'a été fait.'; return; }
    await sleep(800);
    const after = (await (await fetch('/api/my-collection?sort=rarity&page=0&stats=1')).json()).total;
    if (after >= before) { st.textContent = '⚠️ Vérification échouée, j\'arrête par sécurité.'; return; }
    targets[0].count = (targets[0].count || 1) - 1;

    // Ensuite par lots de 50 (un exemplaire par carte à chaque passage).
    let done = 1;
    let queue = targets.flatMap((x) => Array(Math.max(0, x.count || 0)).fill(x.id));
    while (queue.length) {
      const seenIds = new Set(), lot = [], rest = [];
      for (const id of queue) (lot.length < 50 && !seenIds.has(id)) ? (seenIds.add(id), lot.push(id)) : rest.push(id);
      if (!(await postDiscard(lot))) { st.textContent = `⚠️ Arrêt : erreur du site après ${done} carte(s).`; return; }
      done += lot.length; queue = rest;
      st.textContent = `Défausse… ${done}/${copies}`;
      await sleep(700);
    }
    st.textContent = `✅ ${done} carte(s) ${RARITY_NAME[rar]} défaussées. Recharge la page pour voir le résultat.`;
  }
  for (const r of ['C', 'PC', 'R', 'SR', 'UR']) $('wm-d-' + r).onclick = () => discardRarity(r).catch((e) => ($('wm-discard-status').textContent = 'Erreur : ' + e.message));

  // ===================== 3. ANALYSE =====================
  async function marketPrices() {
    const prices = {};
    for (let p = 1; p <= 8; p++) {
      const j = await (await fetch(`/api/marketplace?page=${p}&limit=50&sort=recent`)).json();
      for (const a of j.auctions || []) {
        const k = a.snapshot_rarity + (a.is_shiny ? '*' : '');
        const v = a.final_price ?? a.effective_bid ?? a.base_amount;
        if (typeof v === 'number') (prices[k] ??= []).push(v);
      }
      if (!j.hasMore) break;
    }
    const med = (a) => { a = [...a].sort((x, y) => x - y); return a[Math.floor(a.length / 2)]; };
    return Object.fromEntries(Object.entries(prices).map(([k, v]) => [k, med(v)]));
  }
  $('wm-analyse').onclick = async () => {
    unfold('analyse');
    const out = $('wm-analyse-out');
    try {
      out.textContent = 'Lecture de la collection…';
      const { items } = await fetchCollection((n, t) => (out.textContent = `Lecture… ${n}/${t}`));
      out.textContent = 'Lecture des prix du marché…';
      const med = await marketPrices();
      const est = (x) => {
        const k = x.card.rarity + (x.is_shiny ? '*' : '');
        return med[k] ?? (med[x.card.rarity] ?? 0) * (x.is_shiny ? 10 : 1);
      };
      const ranked = items
        .filter((x) => x.card)
        .map((x) => ({ x, v: est(x), pow: (x.card.atk || 0) + (x.card.def || 0) }))
        .sort((a, b) => b.v - a.v || RARITY_ORDER.indexOf(a.x.card.rarity) - RARITY_ORDER.indexOf(b.x.card.rarity) || b.pow - a.pow);
      const shiny = items.filter((x) => x.is_shiny).length;
      const top = ranked.slice(0, 40);
      const totalEst = ranked.reduce((s, r) => s + r.v * (r.x.count || 1), 0);
      out.innerHTML =
        `<div style="margin:6px 0">${items.length} cartes · ${shiny} shiny · valeur estimée ≈ <b>${totalEst.toLocaleString('fr-FR')}</b></div>` +
        `<div style="opacity:.7;margin-bottom:4px">Prix médians du marché : ${Object.entries(med).map(([k, v]) => `${k} ${v}`).join(' · ')}</div>` +
        '<table style="width:100%;border-collapse:collapse">' +
        top.map(({ x, v, pow }) =>
          `<tr style="border-top:1px solid #2a2f2d"><td style="padding:3px 2px"><b>${x.card.rarity}${x.is_shiny ? '✨' : ''}</b></td>` +
          `<td style="padding:3px 2px">${(x.card.wikipedia_title || '?').slice(0, 34)}${x.starred ? ' ⭐' : ''}</td>` +
          `<td style="padding:3px 2px;text-align:right">~${v.toLocaleString('fr-FR')}</td>` +
          `<td style="padding:3px 2px;text-align:right;opacity:.6">${pow}</td></tr>`).join('') +
        '</table><div style="opacity:.6;margin-top:4px">Estimation = prix médian des enchères en cours pour cette rareté. Dernière colonne = ATK+DEF.</div>';
    } catch (e) { out.textContent = 'Erreur : ' + e.message; }
  };

  // ===================== 4. VENTE =====================
  // Historique réel des ventes d'une carte : {average, count, latest} pour sa rareté.
  async function cardSales(cardId, rarity) {
    try {
      const r = await fetch(`/api/marketplace/cards/${cardId}/sales?scope=summary`);
      if (!r.ok) return null;
      return ((await r.json()).summary || {})[rarity] || null;
    } catch (e) { return null; }
  }
  // Lance fn sur chaque élément, n à la fois.
  async function pool(list, n, fn, onStep) {
    let i = 0, done = 0;
    const out = new Array(list.length);
    await Promise.all(Array.from({ length: n }, async () => {
      while (i < list.length) { const k = i++; out[k] = await fn(list[k]); done++; onStep && onStep(done, list.length); }
    }));
    return out;
  }
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  $('wm-sell-prep').onclick = async () => {
    unfold('sell');
    const out = $('wm-sell-out');
    try {
      out.textContent = 'Lecture de tes ventes en cours…';
      const mine = await (await fetch('/api/marketplace?page=1&limit=1&mine=1')).json();
      const selling = mine.selling || [];
      const max = mine.maxConcurrentAuctions || 5;
      const slots = Math.max(0, max - selling.filter((a) => a.status === 'active' || !a.status).length);
      if (!slots) { out.textContent = `Tu as déjà ${max} enchères actives (le maximum). Attends qu'elles se terminent.`; return; }
      const sellingIds = new Set(selling.flatMap((a) => [a.card_id, a.user_card_id]).filter(Boolean));

      // Cartes candidates : L, UR (les SR se vendent ~10, pas la peine), hors favoris, hors échanges, hors déjà en vente.
      let cands = [];
      for (const rar of ['L', 'UR']) {
        out.textContent = `Lecture des cartes ${rar}…`;
        const { items, pending } = await fetchCollection(null, rar);
        cands.push(...items.filter((x) => !x.starred && !pending.has(x.id) && !pending.has(x.card_id) && !sellingIds.has(x.id)));
      }
      if (!cands.length) { out.textContent = 'Aucune carte L / UR à vendre (hors favoris).'; return; }

      // Prix de repli : médiane des enchères en cours par rareté.
      const med = await marketPrices();
      const prices = await pool(cands, 4, (x) => cardSales(x.card_id, x.card.rarity),
        (d, t) => (out.textContent = `Historique des ventes… ${d}/${t}`));
      const rows = cands.map((x, i) => {
        const s = prices[i];
        let p, src;
        if (s && s.count && s.latest) { p = Math.round(s.latest); src = `dernière vente (moy. ${Math.round(s.average)})`; }
        else if (s && s.count) { p = Math.round(s.average); src = `moy. ${s.count} vente(s)`; }
        else { p = med[x.card.rarity + (x.is_shiny ? '*' : '')] ?? med[x.card.rarity] ?? 10; src = 'marché'; }
        return { x, p: Math.max(1, p), src };
      }).sort((a, b) => b.p - a.p).slice(0, slots);

      out.innerHTML =
        `<div style="margin:6px 0">${slots} place(s) libre(s) sur ${max}. Coche ce que tu veux vendre :</div>` +
        rows.map((r, i) =>
          `<label style="display:flex;gap:6px;align-items:center;border-top:1px solid #2a2f2d;padding:4px 0">` +
          `<input type="checkbox" data-i="${i}" ${r.x.card.rarity === 'L' ? '' : 'checked'}>` +
          `<span style="flex:1"><b>${r.x.card.rarity}${r.x.is_shiny ? '✨' : ''}</b> ${esc((r.x.card.wikipedia_title || '?').slice(0, 26))}` +
          `<br><span style="opacity:.6">${r.src}${r.x.card.rarity === 'L' ? ' · ⚠️ Légendaire' : ''}</span></span>` +
          `<input type="number" min="1" value="${r.p}" data-p="${i}" style="width:62px;background:#0d100f;color:#e8f5ee;border:1px solid #333;border-radius:5px;padding:2px 4px"></label>`).join('') +
        `<div style="margin-top:6px">Durée : <select id="wm-sell-dur" style="background:#0d100f;color:#e8f5ee;border:1px solid #333;border-radius:5px">` +
        [[10, '10 min'], [30, '30 min'], [60, '1 h'], [180, '3 h'], [360, '6 h'], [720, '12 h']]
          .map(([v, l]) => `<option value="${v}" ${v === 360 ? 'selected' : ''}>${l}</option>`).join('') +
        `</select></div>` + B('wm-sell-go', 'Mettre en vente') +
        `<div id="wm-sell-status" style="opacity:.8"></div>`;

      $('wm-sell-go').onclick = async () => {
        const st = $('wm-sell-status');
        const chosen = rows
          .map((r, i) => ({ ...r, on: out.querySelector(`[data-i="${i}"]`).checked, p: parseInt(out.querySelector(`[data-p="${i}"]`).value, 10) }))
          .filter((r) => r.on);
        if (!chosen.length) { st.textContent = 'Rien de coché.'; return; }
        if (chosen.some((r) => !(r.p >= 1))) { st.textContent = 'Un prix est invalide (minimum 1).'; return; }
        const dur = parseInt($('wm-sell-dur').value, 10);
        const recap = chosen.map((r) => `• ${r.x.card.rarity} ${r.x.card.wikipedia_title} — mise de départ ${r.p}`).join('\n');
        if (!confirm(`Mettre ${chosen.length} carte(s) aux enchères pour ${dur >= 60 ? dur / 60 + ' h' : dur + ' min'} ?\n\n${recap}`)) { st.textContent = 'Annulé.'; return; }
        $('wm-sell-go').disabled = true;
        let ok = 0;
        for (const r of chosen) {
          st.textContent = `Mise en vente de ${r.x.card.wikipedia_title}…`;
          const resp = await fetch('/api/marketplace', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ card_id: r.x.id, base_amount: r.p, duration_minutes: dur }),
          });
          const data = await resp.json().catch(() => ({}));
          if (data.code === 'human_verification_required') {
            st.textContent = `⏸️ ${ok} mise(s) en vente. Le site demande une vérification humaine : mets UNE carte en vente à la main (bouton « Mettre aux enchères »), puis reclique « Préparer les ventes ».`;
            return;
          }
          if (!resp.ok || !data.auction_id) {
            st.textContent = `⚠️ Arrêt après ${ok} vente(s) : ${data.error || 'erreur du site'}.`;
            return;
          }
          ok++;
          await sleep(1200);
        }
        st.textContent = `✅ ${ok} carte(s) mises aux enchères. Tu peux les suivre dans « Marché ».`;
      };
    } catch (e) { out.textContent = 'Erreur : ' + e.message; }
  };

  // ===================== 5. BILAN DES PACKS =====================
  async function showBilan() {
    const old = document.getElementById('wm-bilan'); if (old) old.remove();
    const ov = document.createElement('div');
    ov.id = 'wm-bilan';
    ov.style.cssText = 'position:fixed;inset:0;z-index:1000000;background:rgba(0,0,0,.65);display:flex;align-items:center;justify-content:center;font:13px system-ui,sans-serif';
    ov.innerHTML = `<div style="background:#151918;color:#e8f5ee;border:1px solid #2fd08a;border-radius:14px;padding:18px 20px;width:min(520px,92vw);max-height:82vh;overflow:auto">
      <div style="display:flex;justify-content:space-between;align-items:center"><b style="font-size:16px">📊 Bilan de l'ouverture</b>
      <span id="wm-bilan-x" style="cursor:pointer;font-size:18px;opacity:.7">✕</span></div>
      <div id="wm-bilan-body" style="margin-top:10px;opacity:.8">Calcul des valeurs…</div></div>`;
    document.body.appendChild(ov);
    ov.querySelector('#wm-bilan-x').onclick = () => ov.remove();
    ov.onclick = (e) => { if (e.target === ov) ov.remove(); };
    const body = ov.querySelector('#wm-bilan-body');

    if (!pulled.length) { body.textContent = `${opened} pack(s) ouverts, aucune carte relevée.`; return; }
    try {
      // Valeur de base : prix médian du marché par rareté.
      const med = await marketPrices();
      const rows = pulled.map((c) => ({ ...c, v: med[c.rarity] ?? 0, src: 'marché' }));

      // Pour les UR et L : vrai prix moyen de vente de cette carte.
      const rare = rows.filter((r) => r.rarity === 'L' || r.rarity === 'UR');
      if (rare.length) {
        body.textContent = `Recherche du vrai prix de ${rare.length} carte(s) UR / L…`;
        const coll = {};
        for (const rar of [...new Set(rare.map((r) => r.rarity))]) coll[rar] = (await fetchCollection(null, rar)).items;
        await pool(rare, 4, async (r) => {
          const x = (coll[r.rarity] || []).find((i) => (i.card?.wikipedia_title || '').trim() === r.title);
          if (!x) return;
          const s = await cardSales(x.card_id, r.rarity);
          if (s && s.count) { r.v = Math.round(s.latest || s.average); r.src = s.latest ? 'dernière vente' : 'moyenne'; }
        }, (d, t) => (body.textContent = `Prix des UR / L… ${d}/${t}`));
      }

      rows.sort((a, b) => b.v - a.v || RARITY_ORDER.indexOf(a.rarity) - RARITY_ORDER.indexOf(b.rarity));
      const total = rows.reduce((s, r) => s + r.v, 0);
      const counts = RARITY_ORDER.map((r) => [r, rows.filter((x) => x.rarity === r).length]).filter(([, n]) => n);
      const color = { L: '#e8b730', UR: '#e0603a', SR: '#a777d6', R: '#5aa0e0', PC: '#e07ab0', C: '#7f9a8c' };
      body.style.opacity = 1;
      body.innerHTML =
        `<div style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:8px">
           <div><div style="opacity:.6">Packs</div><b style="font-size:18px">${opened}</b></div>
           <div><div style="opacity:.6">Cartes</div><b style="font-size:18px">${rows.length}</b></div>
           <div><div style="opacity:.6">Valeur estimée</div><b style="font-size:18px;color:#2fd08a">≈ ${total.toLocaleString('fr-FR')}</b></div>
         </div>
         <div style="margin-bottom:8px">${counts.map(([r, n]) => `<span style="display:inline-block;margin:2px 6px 2px 0;padding:2px 8px;border-radius:10px;background:${color[r]}33;color:${color[r]};font-weight:600">${r} × ${n}</span>`).join('')}</div>
         <table style="width:100%;border-collapse:collapse">` +
        rows.map((r) => `<tr style="border-top:1px solid #2a2f2d">
           <td style="padding:4px 2px;width:34px"><b style="color:${color[r.rarity]}">${r.rarity}</b></td>
           <td style="padding:4px 2px">${esc(r.title)}</td>
           <td style="padding:4px 2px;text-align:right;white-space:nowrap"><b>~${r.v.toLocaleString('fr-FR')}</b><br><span style="opacity:.5;font-size:11px">${r.src}</span></td></tr>`).join('') +
        `</table><div style="opacity:.55;margin-top:8px;font-size:11px">UR et L : dernier prix de vente de la carte. Autres : prix médian des enchères pour la rareté.</div>`;
    } catch (e) { body.textContent = 'Erreur : ' + e.message; }
  }

  // ===================== 7. CLOUD : CE PC EXÉCUTE LES ORDRES DU SITE =====================
  $('wm-cloud').onclick = $('wm-cloud-open').onclick = () => window.open(CLOUD_URL, '_blank');
  let agentMode = false;
  try { agentMode = localStorage.getItem('wm-agent') === '1'; } catch (e) {}
  // Fenêtre ouverte par le lanceur (lien avec ?wmcloud=1) : le mode cloud s'active tout seul.
  if (new URLSearchParams(location.search).get('wmcloud') === '1') {
    agentMode = true;
    try { localStorage.setItem('wm-agent', '1'); } catch (e) {}
  }
  $('wm-agent').checked = agentMode;
  let cloudAuth = {};
  const agentSt = (t) => { $('wm-agent-st').textContent = t; };

  // Valeur des cartes : prix médian de la rareté, et dernier prix réel pour les UR / L.
  let medCache = null, medAt = 0;
  async function valueCards(cards) {
    if (!medCache || Date.now() - medAt > 30 * 60 * 1000) { medCache = await marketPrices(); medAt = Date.now(); }
    const out = cards.map((c) => ({ ...c, value: medCache[c.rarity] ?? 0 }));
    for (const rar of ['L', 'UR']) {
      const rare = out.filter((c) => c.rarity === rar);
      if (!rare.length) continue;
      const { items } = await fetchCollection(null, rar);
      for (const c of rare) {
        const x = items.find((i) => (i.card?.wikipedia_title || '').trim() === c.title);
        if (!x) continue;
        const s = await cardSales(x.card_id, rar);
        if (s && s.count) c.value = Math.round(s.latest || s.average);
      }
    }
    return out;
  }

  // Envoie les nouvelles cartes sorties au cloud.
  window.cloudReportPulls = async function () {
    if (!agentMode || !cloudAuth.user) return;
    const fresh = pulled.slice(reportedUpTo);
    if (!fresh.length) return;
    reportedUpTo = pulled.length;
    try {
      const valued = await valueCards(fresh);
      await rpc('wm_agent_pulls', { p_user: cloudAuth.user, p_pass: cloudAuth.pass, p_pulls: valued });
    } catch (e) {}
  };
  var cloudReportPulls = window.cloudReportPulls;

  // Quand on lance / arrête à la main sur ce PC, le site cloud est mis à jour aussi.
  window.cloudSendCommand = async function () {
    if (!agentMode || !cloudAuth.user) return;
    await rpc('wm_cloud_command', { p_user: cloudAuth.user, p_pass: cloudAuth.pass, p_desired: packsRunning ? 'run' : 'stop', p_batch: batchMode });
  };
  var cloudSendCommand = window.cloudSendCommand;

  // Nom du compte WikiMasters connecté dans cet onglet (pour vérifier qu'il correspond bien à l'identifiant outils).
  let wmAccount;
  async function findWmAccount() {
    if (wmAccount !== undefined) return wmAccount;
    wmAccount = null;
    const pick = (o) => {
      if (!o || typeof o !== 'object') return null;
      for (const k of ['username', 'pseudo', 'display_name', 'displayName', 'name']) if (typeof o[k] === 'string' && o[k]) return o[k];
      for (const k of ['user', 'profile', 'me', 'data']) { const v = pick(o[k]); if (v) return v; }
      return null;
    };
    for (const url of ['/api/me', '/api/profile', '/api/auth/session', '/api/user']) {
      try {
        const r = await fetch(url);
        if (!r.ok) continue;
        const v = pick(await r.json());
        if (v) { wmAccount = String(v).slice(0, 60); break; }
      } catch (e) {}
    }
    return wmAccount;
  }

  async function agentTick() {
    if (!agentMode || !cloudAuth.user) return;
    const c = packCount();
    const status = {
      wmAccount: await findWmAccount(),
      running: packsRunning, batch: batchMode, opened,
      reserve: c ? `${c.have}/${c.max}` : null,
      onPacksPage: location.pathname.startsWith('/pulls'),
      msg: $('wm-pack-status').textContent.slice(0, 120),
    };
    const r = await rpc('wm_agent_sync', { p_user: cloudAuth.user, p_pass: cloudAuth.pass, p_status: status });
    if (!r.ok) { agentSt(r.network ? '⚠️ Serveur injoignable, nouvel essai dans 20 s.' : '⚠️ ' + (r.reason || 'Refusé.')); return; }
    if (typeof r.batch === 'boolean' && r.batch !== batchMode) {
      batchMode = r.batch; $('wm-batch').checked = batchMode;
      try { localStorage.setItem('wm-batch', batchMode ? '1' : '0'); } catch (e) {}
    }
    if (r.desired === 'run' && !location.pathname.startsWith('/pulls')) { location.href = '/pulls'; return; }
    if (r.desired === 'run' && !packsRunning) setRunning(true, true);
    if (r.desired === 'stop' && packsRunning) { setRunning(false, true); cloudReportPulls(); }
    agentSt(`🟢 Cloud actif · ordre : ${r.desired === 'run' ? 'ouvrir' : 'arrêt'} · ${new Date().toLocaleTimeString('fr-FR')}`);
  }

  $('wm-agent').onchange = () => {
    agentMode = $('wm-agent').checked;
    try { localStorage.setItem('wm-agent', agentMode ? '1' : '0'); } catch (e) {}
    agentSt(agentMode ? 'Connexion au cloud…' : 'Cloud désactivé sur ce PC.');
    if (agentMode) agentTick();
  };
  gmGet('wm_auth', {}).then((a) => {
    cloudAuth = a || {};
    if (agentMode) { agentSt('Connexion au cloud…'); agentTick(); }
    setInterval(() => { agentTick().catch(() => {}); }, 20000);
  });

  // ===================== 6. GESTION DES ACCÈS (admin) =====================
  if (isAdmin) {
    let adminAuth = {};
    gmGet('wm_auth', {}).then((a) => { adminAuth = a || {}; if (!folded.admin) loadUsers(); });
    const adminCreds = () => ({ p_admin: adminAuth.user, p_admin_pass: adminAuth.pass });
    const genPass = () => {
      const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      const arr = new Uint32Array(10); crypto.getRandomValues(arr);
      return [...arr].map((n) => chars[n % chars.length]).join('');
    };
    const ast = (t, ok) => { const e = $('wm-adm-st'); e.style.color = ok ? '#2fd08a' : '#ff8a8a'; e.textContent = t; };
    const fmtDate = (d) => d ? new Date(d).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'jamais';

    async function loadUsers() {
      const list = $('wm-adm-list');
      list.textContent = 'Chargement…';
      const r = await rpc('wm_admin_list', adminCreds());
      if (!Array.isArray(r)) { list.textContent = r.network ? 'Serveur injoignable.' : (r.reason || 'Erreur.'); return; }
      const others = r.filter((u) => !u.admin);
      if (!others.length) { list.innerHTML = '<div style="opacity:.6;margin:4px 0">Aucun accès créé pour l\'instant.</div>'; return; }
      const sb = 'border:0;border-radius:5px;padding:2px 6px;margin-left:3px;cursor:pointer;font-size:11px';
      list.innerHTML = others.map((u) => `
        <div style="border-top:1px solid #2a2f2d;padding:5px 0">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <span><b>${esc(u.user)}</b> ${u.active ? '<span style="color:#2fd08a">●</span>' : '<span style="color:#ff8a8a">● coupé</span>'}${u.locked ? ' 🔒' : ''}</span>
            <span style="white-space:nowrap">
              <button data-a="toggle" data-u="${esc(u.user)}" data-v="${u.active ? 0 : 1}" style="${sb};background:${u.active ? '#5b4040' : '#2f5a45'};color:#fff">${u.active ? 'Couper' : 'Rétablir'}</button>
              <button data-a="pass" data-u="${esc(u.user)}" style="${sb};background:#3a4450;color:#fff">Mdp</button>
              <button data-a="del" data-u="${esc(u.user)}" style="${sb};background:#7a2f2f;color:#fff">✕</button>
            </span>
          </div>
          <div style="opacity:.55;font-size:11px">${u.note ? esc(u.note) + ' · ' : ''}${u.uses} connexion(s) · dernière : ${fmtDate(u.last)}</div>
        </div>`).join('');
      list.querySelectorAll('button[data-a]').forEach((b) => (b.onclick = () => userAction(b.dataset.a, b.dataset.u, b.dataset.v)));
    }

    async function userAction(action, user, v) {
      let r;
      if (action === 'toggle') {
        r = await rpc('wm_admin_set_active', { ...adminCreds(), p_user: user, p_active: v === '1' });
        if (r.ok) ast(v === '1' ? `Accès rétabli pour ${user}.` : `Accès coupé pour ${user}.`, true);
      } else if (action === 'pass') {
        const np = prompt(`Nouveau mot de passe pour ${user} (6 caractères min.) :`, genPass());
        if (!np) return;
        r = await rpc('wm_admin_set_password', { ...adminCreds(), p_user: user, p_pass: np });
        if (r.ok) ast(`Nouveau mot de passe de ${user} : ${np}`, true);
      } else if (action === 'del') {
        if (!confirm(`Supprimer l'accès de ${user} ? Il ne pourra plus se connecter.`)) return;
        r = await rpc('wm_admin_remove', { ...adminCreds(), p_user: user });
        if (r.ok) ast(`Accès de ${user} supprimé.`, true);
      }
      if (r && !r.ok) ast(r.network ? 'Serveur injoignable.' : (r.reason || 'Action refusée.'), false);
      loadUsers();
    }

    $('wm-adm-gen').onclick = () => { $('wm-adm-p').value = genPass(); };
    $('wm-adm-add').onclick = async () => {
      const u = $('wm-adm-u').value.trim(), p = $('wm-adm-p').value, n = $('wm-adm-n').value.trim();
      if (!u || !p) { ast('Pseudo et mot de passe obligatoires.', false); return; }
      const r = await rpc('wm_admin_add', { ...adminCreds(), p_user: u, p_pass: p, p_note: n || null });
      if (!r.ok) { ast(r.network ? 'Serveur injoignable.' : (r.reason || 'Refusé.'), false); return; }
      ast(`✅ Accès créé — pseudo : ${u.toLowerCase()} · mot de passe : ${p}`, true);
      $('wm-adm-u').value = ''; $('wm-adm-p').value = ''; $('wm-adm-n').value = '';
      loadUsers();
    };
    $('wm-adm-refresh').onclick = loadUsers;
    // Charge la liste à la première ouverture de la section.
    box.querySelector('.wm-h[data-s="admin"]').addEventListener('click', () => { if (!folded.admin) loadUsers(); });
  }
  } // fin startTools
})();
