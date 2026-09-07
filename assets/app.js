/* Wer findet mich? – Selbstauskunft für das eigene Gesicht.
 * Alles läuft lokal: Das Bild wird nie an diese Seite gesendet. */

(() => {
  'use strict';

  const $ = (sel) => document.querySelector(sel);

  const state = {
    img: null,          // geladenes Bild
    origin: null,       // 'file' | 'url'
    imageUrl: '',       // nur bei origin === 'url'
    objectUrl: null,    // aufzuräumende blob:-URL
    crop: null,         // { x, y, w, h } in Canvas-Anzeigepixeln
    scale: 1            // Anzeigepixel -> Originalpixel
  };

  /* ---------------------------------------------------------------- Tabs */

  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((t) => {
        const on = t === tab;
        t.classList.toggle('is-active', on);
        t.setAttribute('aria-selected', String(on));
      });
      document.querySelectorAll('.tabpanel').forEach((p) => {
        p.classList.toggle('is-active', p.dataset.panel === tab.dataset.tab);
      });
    });
  });

  /* ------------------------------------------------------------ Laden */

  const dropzone = $('#dropzone');
  const fileInput = $('#fileInput');
  const loadError = $('#loadError');

  const fail = (msg) => { loadError.textContent = msg; loadError.hidden = false; };
  const clearError = () => { loadError.hidden = true; };

  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
  });
  ['dragenter', 'dragover'].forEach((ev) =>
    dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.add('is-over'); }));
  ['dragleave', 'drop'].forEach((ev) =>
    dropzone.addEventListener(ev, () => dropzone.classList.remove('is-over')));
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) loadFile(file);
  });
  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) loadFile(fileInput.files[0]);
  });

  // Ein eingefügtes Bild von der Zwischenablage nehmen wir auch entgegen.
  document.addEventListener('paste', (e) => {
    const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
    if (item) loadFile(item.getAsFile());
  });

  function loadFile(file) {
    if (!file.type.startsWith('image/')) return fail('Das ist keine Bilddatei.');
    if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
    state.objectUrl = URL.createObjectURL(file);
    loadImage(state.objectUrl, 'file', '');
  }

  $('#urlLoad').addEventListener('click', () => {
    const raw = $('#urlInput').value.trim();
    if (!raw) return fail('Bitte eine Bild-Adresse eingeben.');
    let parsed;
    try { parsed = new URL(raw); } catch { return fail('Diese Adresse ist unvollständig – sie muss mit https:// beginnen.'); }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return fail('Nur http- und https-Adressen sind möglich.');
    }
    // Die Suche hängt nicht daran, dass wir das Bild selbst anzeigen können:
    // Schritt 3 steht sofort bereit, die Vorschau kommt nach, falls sie klappt.
    clearError();
    state.origin = 'url';
    state.imageUrl = parsed.href;
    $('#step-suche').hidden = false;
    $('#fileHint').hidden = true;
    $('#urlHint').hidden = false;
    updateEngines();
    loadImage(parsed.href, 'url', parsed.href);
  });

  function loadImage(src, origin, imageUrl) {
    clearError();
    const img = new Image();
    img.crossOrigin = 'anonymous';   // erlaubt Zuschneiden, wenn der Server es zulässt
    img.onload = () => {
      state.img = img;
      state.origin = origin;
      state.imageUrl = imageUrl;
      $('#step-crop').hidden = false;
      $('#step-suche').hidden = false;
      drawImage();
      resetCrop();
      updateEngines();
      $('#fileHint').hidden = origin !== 'file';
      $('#urlHint').hidden = origin !== 'url';
      $('#step-crop').scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    img.onerror = () => {
      if (origin === 'url') {
        // Ohne CORS-Freigabe kein Zuschnitt – die Suche in Schritt 3 läuft trotzdem.
        state.img = null;
        $('#step-crop').hidden = true;
        fail('Vorschau nicht möglich: Der fremde Server gibt das Bild nicht für diese Seite frei. ' +
             'Die Suche in Schritt 3 kannst du trotzdem starten.');
      } else {
        fail('Das Bild konnte nicht geladen werden.');
      }
    };
    img.src = src;
  }

  /* --------------------------------------------------------- Zuschneiden */

  const canvas = $('#canvas');
  const ctx = canvas.getContext('2d');
  const stage = $('#stage');
  const cropBox = $('#cropBox');
  const preview = $('#preview');
  const pctx = preview.getContext('2d');

  const MAX_W = 620;
  const MIN_W = 320;   // sehr kleine Bilder zum Zuschneiden vergrößert anzeigen

  function drawImage() {
    const img = state.img;
    const w = Math.round(Math.min(MAX_W, Math.max(MIN_W, img.naturalWidth)));
    const h = Math.round(img.naturalHeight * (w / img.naturalWidth));
    canvas.width = w;
    canvas.height = h;
    state.scale = img.naturalWidth / w;
    ctx.drawImage(img, 0, 0, w, h);
  }

  function resetCrop(square) {
    const w = canvas.width, h = canvas.height;
    if (square) {
      const s = Math.round(Math.min(w, h) * 0.6);
      state.crop = { x: Math.round((w - s) / 2), y: Math.round((h - s) / 2), w: s, h: s };
    } else {
      state.crop = { x: 0, y: 0, w, h };
    }
    renderCrop();
  }

  function clampCrop() {
    const c = state.crop;
    const min = 24;
    c.w = Math.max(min, Math.min(c.w, canvas.width));
    c.h = Math.max(min, Math.min(c.h, canvas.height));
    c.x = Math.max(0, Math.min(c.x, canvas.width - c.w));
    c.y = Math.max(0, Math.min(c.y, canvas.height - c.h));
  }

  function renderCrop() {
    clampCrop();
    const c = state.crop;
    // Der Canvas kann per CSS herunterskaliert sein – Overlay in Prozent setzen.
    cropBox.style.left = (c.x / canvas.width * 100) + '%';
    cropBox.style.top = (c.y / canvas.height * 100) + '%';
    cropBox.style.width = (c.w / canvas.width * 100) + '%';
    cropBox.style.height = (c.h / canvas.height * 100) + '%';
    renderPreview();
  }

  function renderPreview() {
    const c = state.crop, s = state.scale;
    const sw = Math.round(c.w * s), sh = Math.round(c.h * s);
    const max = 300;
    const k = Math.min(1, max / Math.max(sw, sh));
    preview.width = Math.max(1, Math.round(sw * k));
    preview.height = Math.max(1, Math.round(sh * k));
    pctx.drawImage(state.img, Math.round(c.x * s), Math.round(c.y * s), sw, sh,
                   0, 0, preview.width, preview.height);
    $('#previewMeta').textContent = `${sw} × ${sh} px`;
  }

  // Verschieben und Größe ändern per Zeiger.
  let drag = null;

  function stagePoint(e) {
    const r = stage.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) / r.width * canvas.width,
      y: (e.clientY - r.top) / r.height * canvas.height
    };
  }

  cropBox.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    cropBox.setPointerCapture(e.pointerId);
    drag = { handle: e.target.dataset.handle || null, start: stagePoint(e), crop: { ...state.crop } };
  });

  cropBox.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const p = stagePoint(e);
    const dx = p.x - drag.start.x, dy = p.y - drag.start.y;
    const o = drag.crop;

    if (!drag.handle) {
      state.crop = { ...o, x: o.x + dx, y: o.y + dy };
    } else {
      const left = drag.handle.includes('w');
      const top = drag.handle.includes('n');
      let x = o.x, y = o.y, w = o.w, h = o.h;
      if (left) { x = o.x + dx; w = o.w - dx; } else { w = o.w + dx; }
      if (top)  { y = o.y + dy; h = o.h - dy; } else { h = o.h + dy; }
      if (w < 24) { w = 24; x = left ? o.x + o.w - 24 : o.x; }
      if (h < 24) { h = 24; y = top ? o.y + o.h - 24 : o.y; }
      state.crop = { x, y, w, h };
    }
    renderCrop();
  });

  const endDrag = () => { drag = null; };
  cropBox.addEventListener('pointerup', endDrag);
  cropBox.addEventListener('pointercancel', endDrag);

  $('#cropReset').addEventListener('click', () => resetCrop(false));
  $('#cropSquare').addEventListener('click', () => resetCrop(true));

  /* ------------------------------------------- Ausschnitt exportieren */

  function croppedCanvas() {
    const c = state.crop, s = state.scale;
    const out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(c.w * s));
    out.height = Math.max(1, Math.round(c.h * s));
    out.getContext('2d').drawImage(
      state.img, Math.round(c.x * s), Math.round(c.y * s), out.width, out.height,
      0, 0, out.width, out.height);
    return out;
  }

  function toBlob(cv) {
    return new Promise((resolve, reject) =>
      cv.toBlob((b) => (b ? resolve(b) : reject(new Error('leer'))), 'image/png'));
  }

  const copyStatus = $('#copyStatus');
  const say = (msg) => {
    copyStatus.textContent = msg;
    clearTimeout(say.t);
    say.t = setTimeout(() => { copyStatus.textContent = ''; }, 4000);
  };

  $('#btnCopy').addEventListener('click', async () => {
    try {
      const blob = await toBlob(croppedCanvas());
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      say('Kopiert – jetzt im Suchdienst einfügen.');
    } catch {
      say('Kopieren klappt in diesem Browser nicht. Nutze „Speichern“.');
    }
  });

  $('#btnDownload').addEventListener('click', async () => {
    try {
      const blob = await toBlob(croppedCanvas());
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'mein-gesicht.png';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      say('Gespeichert.');
    } catch {
      say('Der Ausschnitt lässt sich nicht speichern (fremder Server ohne Freigabe).');
    }
  });

  /* ----------------------------------------------------------- Suche */

  // Bei einer Bild-Adresse übergeben wir direkt; bei einer lokalen Datei
  // öffnen wir die Upload-Seite, weil kein Dienst auf die Festplatte zugreifen darf.
  const ENGINES = {
    lens:   { byUrl: (u) => 'https://lens.google.com/uploadbyurl?url=' + encodeURIComponent(u),
              upload: 'https://lens.google.com/' },
    bing:   { byUrl: (u) => 'https://www.bing.com/images/search?view=detailv2&iss=sbi&form=SBIVSP&sbisrc=UrlPaste&q=imgurl:' + encodeURIComponent(u),
              upload: 'https://www.bing.com/visualsearch' },
    yandex: { byUrl: (u) => 'https://yandex.com/images/search?rpt=imageview&url=' + encodeURIComponent(u),
              upload: 'https://yandex.com/images/' },
    tineye: { byUrl: (u) => 'https://tineye.com/search?url=' + encodeURIComponent(u),
              upload: 'https://tineye.com/' }
  };

  function updateEngines() {
    document.querySelectorAll('.engine').forEach((el) => {
      const e = ENGINES[el.dataset.engine];
      el.href = (state.origin === 'url' && state.imageUrl) ? e.byUrl(state.imageUrl) : e.upload;
    });
  }

  const consent = $('#consent');
  consent.addEventListener('change', () => {
    $('#engines').setAttribute('aria-disabled', String(!consent.checked));
  });

  /* ------------------------------------------------- Musterschreiben */

  const gOut = $('#gOut');
  const genFields = ['#gName', '#gPage', '#gImage', '#gDays'].map($);

  function buildLetter() {
    const name = $('#gName').value.trim() || '[Dein Name]';
    const page = $('#gPage').value.trim() || '[Adresse der Seite]';
    const image = $('#gImage').value.trim() || '[Adresse des Bildes]';
    const days = parseInt($('#gDays').value, 10);
    const today = new Date();
    const deadline = new Date(today.getTime() + days * 86400000);
    const fmt = (d) => d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });

    gOut.value =
`Betreff: Löschung eines Fotos von mir – Widerspruch nach Art. 17 DSGVO

Sehr geehrte Damen und Herren,

auf Ihrer Seite

    ${page}

ist ein Foto veröffentlicht, das mich zeigt:

    ${image}

Ich habe der Veröffentlichung nicht zugestimmt und widerspreche ihr hiermit
ausdrücklich. Ich fordere Sie auf, das Bild sowie alle Kopien und Vorschau-
darstellungen davon zu löschen.

Rechtsgrundlage ist Art. 17 Abs. 1 DSGVO (Recht auf Löschung); ergänzend
berufe ich mich auf mein Recht am eigenen Bild nach § 22 KUG. Nach Art. 12
Abs. 3 DSGVO haben Sie mein Anliegen unverzüglich zu bearbeiten.

Bitte bestätigen Sie mir die Löschung schriftlich bis zum ${fmt(deadline)}.
Sollte bis dahin keine Reaktion erfolgen, werde ich die zuständige
Datenschutzaufsichtsbehörde einschalten und weitere rechtliche Schritte prüfen.

Mit freundlichen Grüßen
${name}

${fmt(today)}`;
  }

  genFields.forEach((el) => el.addEventListener('input', buildLetter));
  $('#gDays').addEventListener('change', buildLetter);
  buildLetter();

  $('#gCopy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(gOut.value);
      $('#gStatus').textContent = 'Text kopiert.';
    } catch {
      gOut.select();
      $('#gStatus').textContent = 'Markiert – bitte mit Strg/⌘+C kopieren.';
    }
    setTimeout(() => { $('#gStatus').textContent = ''; }, 4000);
  });

  /* ---------------------------------------------------------- Checkliste */

  const STORE = 'wfm-checklist';
  const saved = (() => {
    try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch { return {}; }
  })();

  document.querySelectorAll('#checklist input').forEach((box) => {
    box.checked = !!saved[box.dataset.key];
    box.addEventListener('change', () => {
      saved[box.dataset.key] = box.checked;
      try { localStorage.setItem(STORE, JSON.stringify(saved)); } catch { /* egal */ }
    });
  });
})();
