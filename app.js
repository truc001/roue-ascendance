'use strict';

/* =====================================================================
   Roue d'ascendance — numérotation Sosa :
   1 = personne centrale, père de n = 2n, mère de n = 2n + 1.
   La génération g (0 = centre) contient les Sosa 2^g … 2^(g+1) − 1.
   ===================================================================== */

const FONT = 'Georgia, Times New Roman, serif';
const INK = '#2b2520';
const MUTED = '#a2978a';
const ACCENT = '#8a3b2e';
const STORAGE_KEY = 'roue-ascendance:v1';
const FIELDS = ['prenom', 'nom', 'naissDate', 'naissLieu', 'decesDate', 'decesLieu', 'profession', 'notes'];
const MAX_GENS = 8;        // générations affichables
const MAX_DATA_GENS = 12;  // générations conservées à l'import GEDCOM
const R = 500;             // rayon de la roue (unités SVG)
const LH = 1.18;           // interligne

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const genOf = n => 31 - Math.clz32(n);
const f2 = v => Math.round(v * 100) / 100;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------------------------------------------------------------------
   État et sauvegarde
   --------------------------------------------------------------------- */

function defaultState() {
  return {
    title: '',
    settings: { gens: 5, shape: 360, palette: 'lignees', showSosa: false, showDetails: true },
    persons: {},
  };
}

function cleanPersons(src) {
  const out = {};
  if (!src || typeof src !== 'object') return out;
  for (const [k, v] of Object.entries(src)) {
    const n = parseInt(k, 10);
    if (!(n >= 1) || !v || typeof v !== 'object') continue;
    const p = {};
    for (const f of FIELDS) if (typeof v[f] === 'string' && v[f].trim()) p[f] = v[f];
    if (Object.keys(p).length) out[n] = p;
  }
  return out;
}

function normalizeState(s) {
  const d = defaultState();
  const st = { ...d.settings, ...(s && typeof s.settings === 'object' ? s.settings : {}) };
  st.gens = clamp(parseInt(st.gens, 10) || 5, 2, MAX_GENS);
  st.shape = [360, 270, 180].includes(+st.shape) ? +st.shape : 360;
  if (!['lignees', 'generations', 'sobre'].includes(st.palette)) st.palette = 'lignees';
  st.showSosa = !!st.showSosa;
  st.showDetails = st.showDetails !== false;
  delete st.showPlaces;
  return { title: typeof s?.title === 'string' ? s.title : '', settings: st, persons: cleanPersons(s?.persons) };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return normalizeState(JSON.parse(raw));
  } catch { /* stockage indisponible */ }
  return defaultState();
}

let state = loadState();
let saveTimer = 0;

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      const el = $('#saved');
      el.textContent = 'Enregistré automatiquement dans ce navigateur.';
      el.classList.add('flash');
      setTimeout(() => el.classList.remove('flash'), 900);
    } catch {
      $('#saved').textContent = 'Enregistrement automatique impossible : pensez à exporter une sauvegarde (.json).';
    }
  }, 250);
}

const person = n => state.persons[n] || null;
const isFilled = p => !!(p && ((p.prenom && p.prenom.trim()) || (p.nom && p.nom.trim())));
const fullName = p => [p?.prenom?.trim(), p?.nom?.trim().toUpperCase()].filter(Boolean).join(' ');

/* ---------------------------------------------------------------------
   Libellés généalogiques
   --------------------------------------------------------------------- */

const GEN_NAMES = {
  1: ['Père', 'Mère'],
  2: ['Grand-père', 'Grand-mère'],
  3: ['Arrière-grand-père', 'Arrière-grand-mère'],
  4: ['Trisaïeul', 'Trisaïeule'],
  5: ['Quadrisaïeul', 'Quadrisaïeule'],
};
const RING_NAMES = ['Centre', 'Parents', 'Grands-parents', 'Arrière-grands-parents', 'Trisaïeux', 'Quadrisaïeux', 'Génération 7', 'Génération 8'];

function roleOf(n) {
  if (n === 1) return 'Personne centrale';
  const g = genOf(n);
  const male = n % 2 === 0;
  let label = GEN_NAMES[g] ? GEN_NAMES[g][male ? 0 : 1] : `Ancêtre de la ${g + 1}ᵉ génération`;
  if (g >= 2) {
    const paternal = (n >> (g - 1)) === 2;
    const side = paternal ? 'paternel' : 'maternel';
    label += GEN_NAMES[g] ? ` ${side}${male ? '' : 'le'}` : ` (côté ${side})`;
  }
  return label;
}

function chainOf(n) {
  const parts = [];
  for (let k = genOf(n) - 1; k >= 0; k--) parts.push((n >> k) & 1 ? 'mère' : 'père');
  const s = parts.join(' › ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function yearOf(date) {
  if (!date) return '';
  const m = date.match(/\d{3,4}/);
  if (!m) return '';
  const low = date.trim().toLowerCase();
  let pre = '';
  if (/^(vers|v\.|env|ca\b|ca\.|circa|~)/.test(low)) pre = '~';
  else if (/^(avant|av\.|<)/.test(low)) pre = '<';
  else if (/^(après|apr\.|>)/.test(low)) pre = '>';
  return pre + m[0];
}

const firstPlace = pl => (pl || '').split(',')[0].trim();

function tooltip(n, p) {
  const head = `Sosa ${n} · ${roleOf(n)}`;
  if (!isFilled(p)) return `${head}\nCliquez pour compléter`;
  const out = [head, fullName(p)];
  if (p.naissDate || p.naissLieu) out.push('° ' + [p.naissDate, p.naissLieu].filter(Boolean).join(', '));
  if (p.decesDate || p.decesLieu) out.push('† ' + [p.decesDate, p.decesLieu].filter(Boolean).join(', '));
  if (p.profession) out.push(p.profession);
  return out.join('\n');
}

/* ---------------------------------------------------------------------
   Géométrie (angles en degrés, 0 = midi, sens horaire)
   --------------------------------------------------------------------- */

function pt(r, deg) {
  const a = deg * Math.PI / 180;
  return [r * Math.sin(a), -r * Math.cos(a)];
}

function sectorPath(r1, r2, a1, a2) {
  const large = a2 - a1 > 180 ? 1 : 0;
  const [x1, y1] = pt(r2, a1), [x2, y2] = pt(r2, a2);
  if (r1 <= 0) return `M0 0L${f2(x1)} ${f2(y1)}A${f2(r2)} ${f2(r2)} 0 ${large} 1 ${f2(x2)} ${f2(y2)}Z`;
  const [x3, y3] = pt(r1, a2), [x4, y4] = pt(r1, a1);
  return `M${f2(x1)} ${f2(y1)}A${f2(r2)} ${f2(r2)} 0 ${large} 1 ${f2(x2)} ${f2(y2)}` +
    `L${f2(x3)} ${f2(y3)}A${f2(r1)} ${f2(r1)} 0 ${large} 0 ${f2(x4)} ${f2(y4)}Z`;
}

function arcPath(r, a1, a2, reverse) {
  const large = a2 - a1 > 180 ? 1 : 0;
  const [x1, y1] = pt(r, a1), [x2, y2] = pt(r, a2);
  return reverse
    ? `M${f2(x2)} ${f2(y2)}A${f2(r)} ${f2(r)} 0 ${large} 0 ${f2(x1)} ${f2(y1)}`
    : `M${f2(x1)} ${f2(y1)}A${f2(r)} ${f2(r)} 0 ${large} 1 ${f2(x2)} ${f2(y2)}`;
}

function centerPath(r0, shape) {
  if (shape === 360) return `M${-r0} 0A${r0} ${r0} 0 1 1 ${r0} 0A${r0} ${r0} 0 1 1 ${-r0} 0Z`;
  return sectorPath(0, r0, -shape / 2, shape / 2);
}

// Épaisseur des anneaux : plus large quand le texte doit être écrit dans le sens du rayon.
function ringRadii(gens, shape) {
  const A = shape * Math.PI / 180;
  const w = [shape === 180 ? 1.3 : 1.1];
  for (let g = 1; g < gens; g++) w.push((g + 0.5) * A / 2 ** g > 1.3 ? 1 : 1.5);
  const k = R / w.reduce((a, b) => a + b, 0);
  const radii = [];
  let r = 0;
  for (const x of w) { radii.push([r, r + x * k]); r += x * k; }
  return radii;
}

function segmentPath(n, radii, shape) {
  const g = genOf(n);
  const [r1, r2] = radii[g];
  if (g === 0) return centerPath(r2, shape);
  const span = shape / 2 ** g;
  const a1 = -shape / 2 + (n - 2 ** g) * span;
  return sectorPath(r1, r2, a1, a1 + span);
}

function wheelBounds(shape) {
  const m = 14;
  const bottom = shape === 360 ? R : shape === 270 ? R * Math.SQRT1_2 : 0;
  return { x: -R - m, y: -R - m, w: 2 * (R + m), h: R + bottom + 2 * m };
}

/* ---------------------------------------------------------------------
   Couleurs
   --------------------------------------------------------------------- */

const QUARTER_HUES = [212, 166, 32, 346]; // GP paternel, GM paternelle, GP maternel, GM maternelle
const GEN_HUES = [38, 200, 150, 40, 345, 265, 95, 185];

function colorFor(n, g, filled, palette) {
  if (palette === 'sobre') return filled ? '#ffffff' : '#f7f4ee';
  if (g === 0) return filled ? 'hsl(38,40%,84%)' : 'hsl(38,30%,93%)';
  const hue = palette === 'generations'
    ? GEN_HUES[g % GEN_HUES.length]
    : g === 1 ? (n === 2 ? 195 : 8) : QUARTER_HUES[(n >> (g - 2)) - 4];
  if (!filled) return `hsl(${hue},30%,94%)`;
  const l = Math.min(90, 70 + g * 3);
  const s = Math.max(30, 50 - g * 2.5);
  return `hsl(${hue},${s}%,${l}%)`;
}

/* ---------------------------------------------------------------------
   Texte : mesure et ajustement
   --------------------------------------------------------------------- */

const mctx = document.createElement('canvas').getContext('2d');
const wcache = new Map();

function unitWidth(text, weight, italic) {
  const key = `${weight}${italic ? 'i' : ''}|${text}`;
  let w = wcache.get(key);
  if (w === undefined) {
    mctx.font = `${italic ? 'italic ' : ''}${weight} 100px ${FONT}`;
    w = mctx.measureText(text).width / 100;
    if (wcache.size > 8000) wcache.clear();
    wcache.set(key, w);
  }
  return w;
}

// Essaie chaque variante (préférée d'abord), réduit la taille si besoin, tronque en dernier recours.
function fitText(candidates, maxW, fs, weight, italic) {
  if (maxW <= 0) return null;
  const minFs = fs * 0.62;
  for (const c of candidates) {
    const w = unitWidth(c, weight, italic) * fs;
    if (w <= maxW) return { text: c, fs };
    if (fs * maxW / w >= minFs) return { text: c, fs: fs * maxW / w };
  }
  let c = candidates[candidates.length - 1];
  while (c.length > 1 && unitWidth(c + '…', weight, italic) * minFs > maxW) c = c.slice(0, -1);
  if (unitWidth(c + '…', weight, italic) * minFs > maxW) return null;
  return { text: c.trimEnd() + '…', fs: minFs };
}

function personLines(n, p) {
  const S = state.settings;
  if (!isFilled(p)) return [[{ c: [String(n)], w: 400, s: 1, color: MUTED }]];
  const L = [];
  if (S.showSosa) L.push({ c: [String(n)], w: 400, s: 0.68, color: MUTED });
  if (p.prenom && p.prenom.trim()) {
    const pr = p.prenom.trim().replace(/\s+/g, ' ');
    const first = pr.split(' ')[0];
    L.push({ c: first !== pr ? [pr, first] : [pr], w: 400, s: 1 });
  }
  if (p.nom && p.nom.trim()) L.push({ c: [p.nom.trim().toUpperCase()], w: 700, s: 1 });

  // Fiche détaillée, sur tous les anneaux (on zoome pour lire les plus petits). Deux dispositions sont
  // proposées : une information par ligne, ou date et lieu de naissance réunis ; la roue garde
  // celle qui donne le texte le plus lisible dans chaque case.
  if (S.showDetails) {
    const bDate = (p.naissDate || '').trim();
    const bPlace = firstPlace(p.naissLieu);
    const prof = (p.profession || '').trim();
    const tail = [];
    if (p.decesDate && p.decesDate.trim()) tail.push({ c: dateVariants('†', p.decesDate), w: 400, s: 0.8 });
    if (prof) tail.push({ c: [prof, prof.split(/[,;]/)[0].trim()], w: 400, s: 0.76, color: '#5f554b' });
    const dateLine = bDate ? [{ c: dateVariants('°', bDate), w: 400, s: 0.8 }] : [];
    const placeLine = bPlace ? [{ c: [bPlace], w: 400, s: 0.78, it: true }] : [];
    const variants = [[...L, ...dateLine, ...placeLine, ...tail]];
    if (bDate && bPlace) {
      variants.push([...L, { c: dateVariants('°', bDate).map(d => `${d}, ${bPlace}`), w: 400, s: 0.8 }, ...tail]);
    }
    return variants;
  }

  const b = yearOf(p.naissDate), d = yearOf(p.decesDate);
  if (b || d) {
    const full = [b && '° ' + b, d && '† ' + d].filter(Boolean).join('  ');
    L.push({ c: b && d ? [full, `${b}–${d}`] : [full], w: 400, s: 0.82 });
  }
  return [L];
}

const MONTH_ABBR = { janvier: 'janv.', février: 'févr.', avril: 'avr.', juillet: 'juil.', septembre: 'sept.', octobre: 'oct.', novembre: 'nov.', décembre: 'déc.' };

// Date complète, puis mois abrégés, puis année seule : on garde la plus longue qui tient dans la case.
function dateVariants(sym, date) {
  const full = date.trim().replace(/\s+/g, ' ');
  const abbr = full.replace(/[a-zéû]+/gi, w => MONTH_ABBR[w.toLowerCase()] || w);
  const year = yearOf(full);
  return [...new Set([full, abbr, year || full].map(v => `${sym} ${v}`))];
}

const baseFs = g => Math.max(5, 24 * Math.pow(0.84, g));
const sumScale = lines => lines.reduce((a, l) => a + l.s, 0);

// Décalage (centre de ligne) de chaque ligne, la première en haut (valeurs négatives).
function stackOffsets(lines, fs) {
  const hs = lines.map(l => l.s * fs * LH);
  const H = hs.reduce((a, b) => a + b, 0);
  let acc = 0;
  return lines.map((l, i) => { const o = -H / 2 + acc + hs[i] / 2; acc += hs[i]; return o; });
}

// Note d'une disposition : plus petite taille de police effective, pénalisée si un texte est tronqué.
function scoreFits(fits, lines) {
  let score = Infinity;
  fits.forEach((r, i) => {
    if (!r) { score = 0; return; }
    // Une variante abrégée (mois court, année seule) coûte un peu : on préfère l'information complète.
    const idx = lines[i].c.indexOf(r.text);
    score = Math.min(score, (r.fs / lines[i].s) * (idx < 0 ? 0.6 : 1 - 0.15 * idx));
  });
  return score === Infinity ? 0 : score;
}

function textMarkup(r, l, { x, y, href }) {
  const attrs = ` font-size="${f2(r.fs)}"` +
    (l.w !== 400 ? ` font-weight="${l.w}"` : '') +
    (l.it ? ' font-style="italic"' : '') +
    (l.color ? ` fill="${l.color}"` : '');
  if (href) return `<text${attrs}><textPath href="#${href}" startOffset="50%">${esc(r.text)}</textPath></text>`;
  return `<text x="${f2(x)}" y="${f2(y)}"${attrs}>${esc(r.text)}</text>`;
}

// Texte horizontal (case centrale).
function layoutCenter(lines, r0, shape) {
  const cfg = shape === 360 ? { cy: 0, h: r0 * 1.5 } : shape === 270 ? { cy: -r0 * 0.12, h: r0 * 1.2 } : { cy: -r0 * 0.42, h: r0 * 0.72 };
  const fs = Math.min(baseFs(0), cfg.h / (sumScale(lines) * LH));
  const offs = stackOffsets(lines, fs);
  const fits = lines.map((l, i) => {
    const y = cfg.cy + offs[i];
    const edge = Math.max(Math.abs(y - l.s * fs / 2), Math.abs(y + l.s * fs / 2));
    const chord = 2 * Math.sqrt(Math.max(0, r0 * r0 - edge * edge));
    return fitText(l.c, chord * 0.86, l.s * fs, l.w, l.it);
  });
  const svg = fits.map((r, i) => r ? textMarkup(r, lines[i], { x: 0, y: cfg.cy + offs[i] + r.fs * 0.35 }) : '').join('');
  return { svg, defs: [], score: scoreFits(fits, lines) };
}

// Texte le long de l'arc (anneaux intérieurs). Retourné sur la moitié basse pour rester lisible.
function layoutTangential(lines, r1, r2, a1, a2, fs0, idp) {
  const T = r2 - r1, rm = (r1 + r2) / 2;
  const fs = Math.min(fs0, T * 0.84 / (sumScale(lines) * LH));
  const mid = (a1 + a2) / 2;
  const nm = ((mid % 360) + 540) % 360 - 180;
  const flip = Math.abs(nm) > 90.01;
  const spanRad = (a2 - a1) * Math.PI / 180;
  const offs = stackOffsets(lines, fs);
  const defs = [];
  let svg = '';
  const fits = lines.map((l, i) => {
    const rc = flip ? rm + offs[i] : rm - offs[i];
    const r = fitText(l.c, rc * spanRad * 0.88 - 2, l.s * fs, l.w, l.it);
    if (!r) return null;
    const rb = flip ? rc + r.fs * 0.35 : rc - r.fs * 0.35;
    const id = `${idp}${i}`;
    defs.push(`<path id="${id}" d="${arcPath(rb, a1, a2, flip)}"/>`);
    svg += textMarkup(r, l, { href: id });
    return r;
  });
  return { svg, defs, score: scoreFits(fits, lines) };
}

// Texte dans le sens du rayon (anneaux extérieurs étroits).
function layoutRadial(lines, r1, r2, a1, a2, fs0) {
  const T = r2 - r1, rm = (r1 + r2) / 2;
  const spanRad = (a2 - a1) * Math.PI / 180;
  const across = Math.max(r1, 1) * spanRad * 0.9;
  const fs = Math.min(fs0, across / (sumScale(lines) * LH));
  const mid = (a1 + a2) / 2;
  const nmid = ((mid % 360) + 360) % 360;
  const rot = nmid < 180 ? mid - 90 : mid + 90;
  const [cx, cy] = pt(rm, mid);
  const offs = stackOffsets(lines, fs);
  const fits = lines.map(l => fitText(l.c, T * 0.9, l.s * fs, l.w, l.it));
  const inner = fits.map((r, i) => r ? textMarkup(r, lines[i], { x: 0, y: offs[i] + r.fs * 0.35 }) : '').join('');
  return { svg: `<g transform="translate(${f2(cx)} ${f2(cy)}) rotate(${f2(rot)})">${inner}</g>`, defs: [], score: scoreFits(fits, lines) };
}

/* ---------------------------------------------------------------------
   Construction du SVG
   --------------------------------------------------------------------- */

let selected = null;

function buildWheel(forExport) {
  const { gens, shape, palette } = state.settings;
  const radii = ringRadii(gens, shape);
  const half = shape / 2;
  const defs = [], shapes = [], texts = [];
  const idPrefix = forExport ? 'x' : 't';

  for (let g = 0; g < gens; g++) {
    const [r1, r2] = radii[g];
    const count = 2 ** g;
    const span = shape / count;
    for (let i = 0; i < count; i++) {
      const n = count + i;
      const p = person(n);
      const filled = isFilled(p);
      const a1 = -half + i * span, a2 = a1 + span;
      const d = g === 0 ? centerPath(r2, shape) : sectorPath(r1, r2, a1, a2);
      const tip = forExport ? '' : `<title>${esc(tooltip(n, p))}</title>`;
      shapes.push(`<path class="seg" data-sosa="${n}" d="${d}" fill="${colorFor(n, g, filled, palette)}">${tip}</path>`);

      const T = r2 - r1, rm = (r1 + r2) / 2;
      const tangential = rm * span * Math.PI / 180 >= T * 1.1;
      let best = null;
      for (const lines of personLines(n, p)) {
        if (!lines.length) continue;
        const lay = g === 0 ? layoutCenter(lines, r2, shape)
          : tangential ? layoutTangential(lines, r1, r2, a1, a2, baseFs(g), `${idPrefix}${n}_`)
          : layoutRadial(lines, r1, r2, a1, a2, baseFs(g));
        if (!best || lay.score > best.score) best = lay;
      }
      if (best) { texts.push(best.svg); defs.push(...best.defs); }
    }
  }

  const stroke = palette === 'sobre' ? '#6b6157' : '#fffaf2';
  const sw = palette === 'sobre' ? 0.9 : 1.6;
  let sel = '';
  if (!forExport && selected && genOf(selected) < gens) {
    sel = `<path d="${segmentPath(selected, radii, shape)}" fill="none" stroke="${ACCENT}" stroke-width="3.5" stroke-linejoin="round" pointer-events="none"/>`;
  }
  return `<defs>${defs.join('')}</defs>` +
    `<g stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round">${shapes.join('')}</g>` +
    `<g font-family="${FONT}" fill="${INK}" text-anchor="middle" pointer-events="none">${texts.join('')}</g>` + sel;
}

function defaultTitle() {
  const p = person(1);
  return isFilled(p) ? `Ascendance de ${fullName(p)}` : '';
}
const displayTitle = () => state.title.trim() || defaultTitle();

function exportSVGString() {
  const b = wheelBounds(state.settings.shape);
  const title = displayTitle();
  const band = title ? 90 : 0;
  const H = b.h + band;
  const bg = state.settings.palette === 'sobre' ? '#ffffff' : '#fbf7ef';
  let titleEl = '';
  if (title) {
    const r = fitText([title], b.w * 0.9, 34, 400, false);
    if (r) titleEl = `<text x="${f2(b.x + b.w / 2)}" y="${f2(b.y + b.h + band * 0.5)}" font-family="${FONT}" font-size="${f2(r.fs)}" fill="${INK}" text-anchor="middle">${esc(r.text)}</text>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f2(b.x)} ${f2(b.y)} ${f2(b.w)} ${f2(H)}" width="${f2(b.w)}" height="${f2(H)}">` +
    `<rect x="${f2(b.x)}" y="${f2(b.y)}" width="${f2(b.w)}" height="${f2(H)}" fill="${bg}"/>` +
    buildWheel(true) + titleEl + '</svg>';
}

/* ---------------------------------------------------------------------
   Rendu écran, zoom et déplacement
   --------------------------------------------------------------------- */

const svg = $('#wheel');
let view = null;
let raf = 0;

function render() {
  svg.innerHTML = buildWheel(false);
  updateStats();
  $('#title').placeholder = defaultTitle() || 'Titre (ex. Ascendance de Marie Dupont)';
}

function scheduleRender() {
  if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); });
}

function setView(v) {
  view = v;
  svg.setAttribute('viewBox', `${f2(v.x)} ${f2(v.y)} ${f2(v.w)} ${f2(v.h)}`);
}

function resetView() { setView(wheelBounds(state.settings.shape)); }

function toSvgPoint(cx, cy) {
  const p = svg.createSVGPoint();
  p.x = cx; p.y = cy;
  return p.matrixTransform(svg.getScreenCTM().inverse());
}

function zoomBy(f, p) {
  const b = wheelBounds(state.settings.shape);
  const w = clamp(view.w * f, b.w / 40, b.w * 1.3);
  const k = w / view.w;
  p = p || { x: view.x + view.w / 2, y: view.y + view.h / 2 };
  setView({ x: p.x - (p.x - view.x) * k, y: p.y - (p.y - view.y) * k, w: view.w * k, h: view.h * k });
}

svg.addEventListener('wheel', e => {
  e.preventDefault();
  zoomBy(Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), toSvgPoint(e.clientX, e.clientY));
}, { passive: false });

let drag = null;
let dragMoved = false;

svg.addEventListener('pointerdown', e => {
  if (e.button !== 0) return;
  drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, id: e.pointerId };
  dragMoved = false;
});

svg.addEventListener('pointermove', e => {
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if (!dragMoved && Math.hypot(dx, dy) < 5) return;
  if (!dragMoved) {
    dragMoved = true;
    svg.setPointerCapture(drag.id);
    svg.classList.add('panning');
  }
  const rect = svg.getBoundingClientRect();
  const k = Math.max(view.w / rect.width, view.h / rect.height);
  setView({ ...view, x: drag.vx - dx * k, y: drag.vy - dy * k });
});

function endDrag() {
  if (!drag) return;
  drag = null;
  svg.classList.remove('panning');
  setTimeout(() => { dragMoved = false; }, 0);
}
svg.addEventListener('pointerup', endDrag);
svg.addEventListener('pointercancel', endDrag);

svg.addEventListener('click', e => {
  if (dragMoved) return;
  const seg = e.target.closest('[data-sosa]');
  if (seg) select(+seg.dataset.sosa);
});

$$('[data-zoom]').forEach(b => b.addEventListener('click', () => {
  const z = b.dataset.zoom;
  if (z === 'reset') resetView();
  else zoomBy(z === 'in' ? 1 / 1.35 : 1.35);
}));

/* ---------------------------------------------------------------------
   Progression
   --------------------------------------------------------------------- */

function updateStats() {
  const { gens } = state.settings;
  let html = '', tot = 0, totMax = 0;
  for (let g = 0; g < gens; g++) {
    const max = 2 ** g;
    let c = 0;
    for (let n = max; n < max * 2; n++) if (isFilled(state.persons[n])) c++;
    tot += c; totMax += max;
    html += `<div class="stat"><span>${RING_NAMES[g]}</span><div class="bar"><i style="width:${(c / max) * 100}%"></i></div><span>${c} / ${max}</span></div>`;
  }
  html += `<div class="stat total"><span>Total</span><div class="bar"><i style="width:${(tot / totMax) * 100}%"></i></div><span>${tot} / ${totMax}</span></div>`;
  $('#stats').innerHTML = html;
}

/* ---------------------------------------------------------------------
   Fiche d'une personne
   --------------------------------------------------------------------- */

const panel = $('#panel');
const form = $('#form');

function select(n) {
  if (!(n >= 1) || genOf(n) >= MAX_GENS) return;
  if (genOf(n) >= state.settings.gens) {
    state.settings.gens = genOf(n) + 1;
    $('#gens').value = state.settings.gens;
    save();
    resetView();
  }
  selected = n;
  fillEditor();
  panel.classList.add('editing');
  document.body.classList.add('editing-mobile');
  render();
  if (matchMedia('(max-width: 860px)').matches) $('.stage').scrollIntoView({ block: 'start' });
  if (!matchMedia('(pointer: coarse)').matches) {
    form.elements.prenom.focus();
    form.elements.prenom.select();
  }
}

function closeEditor() {
  selected = null;
  panel.classList.remove('editing');
  document.body.classList.remove('editing-mobile');
  render();
}

function fillEditor() {
  const n = selected;
  const p = person(n) || {};
  $('#edSosa').textContent = `Sosa ${n}`;
  $('#edRole').textContent = roleOf(n);
  let path = n === 1 ? 'Point de départ de la roue' : chainOf(n);
  const child = n > 1 ? person(n >> 1) : null;
  if (n > 1 && isFilled(child)) path += ` · parent de ${fullName(child)}`;
  $('#edPath').textContent = path;
  for (const f of FIELDS) form.elements[f].value = p[f] || '';
  form.elements.nom.placeholder = n % 2 === 0 && child?.nom ? child.nom : '';
  const g = genOf(n);
  $('[data-go="child"]').disabled = n === 1;
  $('[data-go="father"]').disabled = g + 1 >= MAX_GENS;
  $('[data-go="mother"]').disabled = g + 1 >= MAX_GENS;
  $('[data-go="prev"]').disabled = n === 1;
  $('[data-go="next"]').disabled = n + 1 >= 2 ** state.settings.gens;
}

form.addEventListener('input', e => {
  const f = e.target.name;
  if (!f || selected == null) return;
  const n = selected;
  const p = { ...(state.persons[n] || {}) };
  const hadPrenom = !!(p.prenom && p.prenom.trim());
  p[f] = e.target.value;

  // Un père porte en général le nom de son enfant : on le propose dès qu'on tape le prénom.
  if (f === 'prenom' && !hadPrenom && n > 1 && n % 2 === 0 && !(p.nom && p.nom.trim())) {
    const child = person(n >> 1);
    if (child?.nom) { p.nom = child.nom; form.elements.nom.value = child.nom; }
  }

  for (const k of Object.keys(p)) if (!p[k] || !p[k].trim()) delete p[k];
  if (Object.keys(p).length) state.persons[n] = p; else delete state.persons[n];
  save();
  scheduleRender();
});

form.addEventListener('submit', e => e.preventDefault());

form.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.tagName === 'INPUT') {
    e.preventDefault();
    go(e.shiftKey ? 'prev' : 'next');
  }
});

function go(where) {
  const n = selected;
  if (n == null) return;
  const target = { child: n >> 1, father: 2 * n, mother: 2 * n + 1, prev: n - 1, next: n + 1 }[where];
  if (where === 'next' && target >= 2 ** state.settings.gens) {
    toast('Dernière case de la roue. Ajoutez une génération pour continuer.');
    return;
  }
  if (target >= 1) select(target);
}

$$('[data-go]').forEach(b => b.addEventListener('click', () => go(b.dataset.go)));
$('#edClose').addEventListener('click', closeEditor);
$('#edClear').addEventListener('click', () => {
  if (selected == null || !state.persons[selected]) return;
  delete state.persons[selected];
  fillEditor();
  save();
  render();
  toast(`Fiche Sosa ${selected} effacée.`);
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && selected != null && !$('#gedDialog').open) closeEditor();
});

/* ---------------------------------------------------------------------
   Réglages
   --------------------------------------------------------------------- */

function syncControls() {
  const s = state.settings;
  $('#gens').value = s.gens;
  $('#shape').value = s.shape;
  $('#palette').value = s.palette;
  $('#showSosa').checked = s.showSosa;
  $('#showDetails').checked = s.showDetails;
  $('#title').value = state.title;
}

$('#gens').addEventListener('change', e => {
  state.settings.gens = +e.target.value;
  if (selected != null && genOf(selected) >= state.settings.gens) closeEditor();
  else if (selected != null) fillEditor();
  save(); resetView(); render();
});
$('#shape').addEventListener('change', e => { state.settings.shape = +e.target.value; save(); resetView(); render(); });
$('#palette').addEventListener('change', e => { state.settings.palette = e.target.value; save(); render(); });
$('#showSosa').addEventListener('change', e => { state.settings.showSosa = e.target.checked; save(); render(); });
$('#showDetails').addEventListener('change', e => { state.settings.showDetails = e.target.checked; save(); render(); });
$('#title').addEventListener('input', e => { state.title = e.target.value; save(); });

/* ---------------------------------------------------------------------
   Menus, fichiers, export
   --------------------------------------------------------------------- */

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 3200);
}

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function fileBase() {
  const slug = (displayTitle() || 'roue-ascendance')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return slug || 'roue-ascendance';
}

function exportPNG() {
  const src = exportSVGString();
  const url = URL.createObjectURL(new Blob([src], { type: 'image/svg+xml;charset=utf-8' }));
  const img = new Image();
  img.onload = () => {
    const scale = 4000 / img.width;
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(url);
    c.toBlob(b => { download(b, `${fileBase()}.png`); toast('Image PNG exportée.'); }, 'image/png');
  };
  img.onerror = () => { URL.revokeObjectURL(url); toast("L'export PNG a échoué. Essayez l'export SVG."); };
  img.src = url;
}

function exportSVG() {
  download(new Blob(['<?xml version="1.0" encoding="UTF-8"?>\n' + exportSVGString()], { type: 'image/svg+xml' }), `${fileBase()}.svg`);
  toast('Image SVG exportée.');
}

function preparePrint() { $('#print-area').innerHTML = exportSVGString(); }
window.addEventListener('beforeprint', preparePrint);

function saveJSON() {
  const data = { app: 'roue-ascendance', version: 1, ...state };
  download(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), `${fileBase()}.json`);
  toast('Sauvegarde téléchargée.');
}

const hasData = () => Object.keys(state.persons).length > 0;

function replaceState(next) {
  state = next;
  selected = null;
  panel.classList.remove('editing');
  document.body.classList.remove('editing-mobile');
  syncControls();
  save();
  resetView();
  render();
}

async function openJSON(file) {
  try {
    const data = JSON.parse(await file.text());
    if (!data || typeof data !== 'object' || typeof data.persons !== 'object') throw new Error('format');
    if (hasData() && !confirm('Remplacer la roue actuelle par ce fichier ?')) return;
    replaceState(normalizeState(data));
    toast(`${Object.keys(state.persons).length} personnes chargées.`);
  } catch {
    toast("Ce fichier n'est pas une sauvegarde de roue d'ascendance valide.");
  }
}

function runAction(action) {
  switch (action) {
    case 'open-json': $('#fileJson').click(); break;
    case 'save-json': saveJSON(); break;
    case 'import-ged': $('#fileGed').click(); break;
    case 'export-png': exportPNG(); break;
    case 'export-svg': exportSVG(); break;
    case 'print': preparePrint(); window.print(); break;
    case 'clear-all':
      if (hasData() && confirm('Effacer toutes les personnes de la roue ? Cette action est définitive (pensez à enregistrer une sauvegarde avant).')) {
        replaceState({ ...state, title: '', persons: {} });
        toast('Roue effacée.');
      }
      break;
  }
}

$$('[data-action]').forEach(b => b.addEventListener('click', () => {
  b.closest('details')?.removeAttribute('open');
  runAction(b.dataset.action);
}));

// Un seul menu ouvert à la fois ; clic ailleurs = fermeture.
// Le menu s'aligne sur son bouton sans jamais sortir de l'écran.
function placeMenu(d) {
  const list = $('.menu-list', d);
  const btn = $('summary', d).getBoundingClientRect();
  list.style.left = '0px';
  const w = list.offsetWidth;
  const left = clamp(btn.right - w, 8, window.innerWidth - w - 8);
  list.style.left = `${left - btn.left}px`;
}

$$('details.menu').forEach(d => d.addEventListener('toggle', () => {
  if (!d.open) return;
  $$('details.menu').forEach(o => { if (o !== d) o.removeAttribute('open'); });
  placeMenu(d);
}));
window.addEventListener('resize', () => $$('details.menu[open]').forEach(placeMenu));
document.addEventListener('click', e => {
  $$('details.menu[open]').forEach(d => { if (!d.contains(e.target)) d.removeAttribute('open'); });
});

$('#fileJson').addEventListener('change', e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (f) openJSON(f);
});

/* ---------------------------------------------------------------------
   Import GEDCOM
   --------------------------------------------------------------------- */

function parseGedcom(text) {
  const recs = {};
  const stack = [];
  let cur = null;
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const line = raw.replace(/^﻿/, '').trim();
    if (!line) continue;
    const m = line.match(/^(\d+)\s+(@[^@]+@\s+)?(\S+)(?:\s(.*))?$/);
    if (!m) continue;
    const level = +m[1];
    const xref = m[2] ? m[2].trim() : null;
    const node = { tag: m[3].toUpperCase(), value: m[4] || '', children: [] };
    if (level === 0) {
      cur = xref ? node : null;
      if (xref) recs[xref] = node;
      stack.length = 0;
      stack[0] = node;
      continue;
    }
    if (!cur) continue;
    const parent = stack[level - 1];
    if (!parent) continue;
    if (node.tag === 'CONC') { parent.value += node.value; continue; }
    if (node.tag === 'CONT') { parent.value += '\n' + node.value; continue; }
    parent.children.push(node);
    stack[level] = node;
    stack.length = level + 1;
  }
  return recs;
}

const gChild = (node, tag) => node?.children.find(c => c.tag === tag);
const gVal = (node, tag) => (gChild(node, tag)?.value || '').trim();

const G_MONTHS = { JAN: 'janvier', FEB: 'février', MAR: 'mars', APR: 'avril', MAY: 'mai', JUN: 'juin', JUL: 'juillet', AUG: 'août', SEP: 'septembre', OCT: 'octobre', NOV: 'novembre', DEC: 'décembre' };
const G_WORDS = { ABT: 'vers', ABOUT: 'vers', EST: 'vers', CAL: 'vers', BEF: 'avant', AFT: 'après', BET: 'entre', AND: 'et', FROM: 'de', TO: 'à', INT: '' };

function gedDate(s) {
  if (!s) return '';
  return s.replace(/@#D[^@]*@/g, '').replace(/\(.*?\)/g, '').trim().split(/\s+/)
    .map(w => { const u = w.toUpperCase(); return G_MONTHS[u] ?? G_WORDS[u] ?? w; })
    .filter(Boolean).join(' ')
    .replace(/^1 /, '1er ');
}

const gedPlace = s => (s || '').split(',').map(x => x.trim()).filter(Boolean).join(', ');

function indiName(rec) {
  const nameNode = gChild(rec, 'NAME');
  let prenom = '', nom = '';
  if (nameNode) {
    const m = nameNode.value.match(/^([^/]*)\/([^/]*)\/?(.*)$/);
    if (m) { prenom = `${m[1]} ${m[3]}`.trim(); nom = m[2].trim(); }
    else prenom = nameNode.value.trim();
    prenom = gVal(nameNode, 'GIVN') || prenom;
    nom = gVal(nameNode, 'SURN') || nom;
  }
  return { prenom: prenom.replace(/\s+/g, ' '), nom };
}

function indiToPerson(rec) {
  const { prenom, nom } = indiName(rec);
  const ev = tags => {
    for (const t of tags) {
      const e = gChild(rec, t);
      if (e && (gVal(e, 'DATE') || gVal(e, 'PLAC'))) return { date: gedDate(gVal(e, 'DATE')), lieu: gedPlace(gVal(e, 'PLAC')) };
    }
    return { date: '', lieu: '' };
  };
  const b = ev(['BIRT', 'CHR', 'BAPM']);
  const d = ev(['DEAT', 'BURI']);
  const profession = rec.children.filter(c => c.tag === 'OCCU').map(c => c.value.trim()).filter(Boolean).join(', ');
  const notes = rec.children.filter(c => c.tag === 'NOTE' && !/^@.*@$/.test(c.value.trim())).map(c => c.value.trim()).filter(Boolean).join('\n');
  const p = { prenom, nom, naissDate: b.date, naissLieu: b.lieu, decesDate: d.date, decesLieu: d.lieu, profession, notes };
  for (const k of Object.keys(p)) if (!p[k]) delete p[k];
  return p;
}

let gedRecs = null;
let gedPeople = [];

async function readTextSmart(file) {
  const buf = await file.arrayBuffer();
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
  catch { return new TextDecoder('windows-1252').decode(buf); }
}

async function importGedcom(file) {
  try {
    gedRecs = parseGedcom(await readTextSmart(file));
  } catch {
    toast('Impossible de lire ce fichier GEDCOM.');
    return;
  }
  gedPeople = Object.entries(gedRecs)
    .filter(([, r]) => r.tag === 'INDI')
    .map(([id, r]) => {
      const { prenom, nom } = indiName(r);
      const birth = gChild(r, 'BIRT') || gChild(r, 'CHR') || gChild(r, 'BAPM');
      const death = gChild(r, 'DEAT');
      const years = [yearOf(gedDate(gVal(birth, 'DATE'))), yearOf(gedDate(gVal(death, 'DATE')))];
      const label = [nom.toUpperCase(), prenom].filter(Boolean).join(' ') || '(sans nom)';
      const key = label.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
      return { id, label, years: years.some(Boolean) ? `${years[0] || '?'} – ${years[1] || ''}`.trim() : '', key };
    })
    .sort((a, b) => a.key.localeCompare(b.key, 'fr'));

  if (!gedPeople.length) { toast('Aucune personne trouvée dans ce fichier GEDCOM.'); return; }
  $('#gedInfo').textContent = `${gedPeople.length} personnes trouvées dans « ${file.name} ». Choisissez la personne centrale : ses ancêtres rempliront la roue.`;
  $('#gedSearch').value = '';
  renderGedList();
  $('#gedDialog').showModal();
  $('#gedSearch').focus();
}

function renderGedList() {
  const q = $('#gedSearch').value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const words = q.split(/\s+/).filter(Boolean);
  const list = gedPeople.filter(p => words.every(w => p.key.includes(w)));
  const shown = list.slice(0, 300);
  $('#gedList').innerHTML = shown.map(p =>
    `<li><button type="button" data-id="${esc(p.id)}">${esc(p.label)}${p.years ? `<small>${esc(p.years)}</small>` : ''}</button></li>`
  ).join('') + (list.length > shown.length ? `<li class="muted" style="padding:9px 12px">… affinez la recherche (${list.length} résultats)</li>` : '')
    + (!list.length ? '<li class="muted" style="padding:9px 12px">Aucun résultat</li>' : '');
}

$('#gedSearch').addEventListener('input', renderGedList);

$('#gedList').addEventListener('click', e => {
  const b = e.target.closest('button[data-id]');
  if (!b) return;
  const persons = {};
  let maxGen = 0;
  const walk = (id, n) => {
    const r = gedRecs[id];
    if (!r || r.tag !== 'INDI' || genOf(n) >= MAX_DATA_GENS) return;
    persons[n] = indiToPerson(r);
    maxGen = Math.max(maxGen, genOf(n));
    const fam = gedRecs[gVal(r, 'FAMC')];
    if (!fam) return;
    walk(gVal(fam, 'HUSB'), 2 * n);
    walk(gVal(fam, 'WIFE'), 2 * n + 1);
  };
  walk(b.dataset.id, 1);
  $('#gedDialog').close();
  if (hasData() && !confirm("Remplacer la roue actuelle par l'ascendance importée ?")) return;
  const gens = clamp(Math.max(state.settings.gens, maxGen + 1), 2, MAX_GENS);
  replaceState({ title: '', settings: { ...state.settings, gens }, persons: cleanPersons(persons) });
  const total = Object.keys(state.persons).length;
  toast(`${total} ancêtre${total > 1 ? 's' : ''} importé${total > 1 ? 's' : ''}${maxGen + 1 > MAX_GENS ? ` (roue limitée à ${MAX_GENS} générations)` : ''}.`);
});

$('#fileGed').addEventListener('change', e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (f) importGedcom(f);
});

/* ---------------------------------------------------------------------
   Démarrage
   --------------------------------------------------------------------- */

syncControls();
resetView();
render();
