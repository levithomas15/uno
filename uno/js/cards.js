/* Das Kartenbild.
 *
 * Jede Karte wird als SVG gezeichnet – im Aufbau der Originalkarte:
 * farbiger Grund mit weissem Rand, schraeges weisses Oval in der Mitte,
 * grosses Zeichen darin, dazu die kleinen Zeichen in zwei gegenueber-
 * liegenden Ecken.
 */

export const CARD_COLORS = {
  red: '#d8232f',
  yellow: '#f7c800',
  green: '#3ba33b',
  blue: '#0a5cb8',
  wild: '#101014',
};

/* Etwas dunklerer Ton fuer den Schatten unter dem grossen Zeichen. */
const SHADE = {
  red: '#9e161f',
  yellow: '#b78f00',
  green: '#27722a',
  blue: '#063f80',
  wild: '#000000',
};

const W = 140;
const H = 210;

function esc(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* --------------------------------------------------------------- Zeichen */

/* Aussetzen: Kreis mit Balken. */
function skipGlyph(color, scale, stroke) {
  return `<g transform="scale(${scale})" stroke="${color}" fill="none" stroke-width="${stroke}">
    <circle cx="0" cy="0" r="15"/>
    <line x1="-11" y1="11" x2="11" y2="-11"/>
  </g>`;
}

/* Retour: zwei gegenlaeufige Pfeile. */
function reverseGlyph(color, scale) {
  return `<g transform="scale(${scale})" fill="${color}">
    <path d="M -13 6 L -2 6 L -2 12 L -14 3 L -2 -6 L -2 0 L -13 0 Z" transform="rotate(-25)"/>
    <path d="M 13 -6 L 2 -6 L 2 -12 L 14 -3 L 2 6 L 2 0 L 13 0 Z" transform="rotate(-25)"/>
  </g>`;
}

/* Zieh Zwei: zwei versetzte Karten. */
function drawTwoGlyph(color, scale) {
  return `<g transform="scale(${scale})">
    <rect x="-13" y="-14" width="16" height="24" rx="3" fill="#ffffff" stroke="${color}" stroke-width="2.5"/>
    <rect x="-3" y="-8" width="16" height="24" rx="3" fill="${color}" stroke="#ffffff" stroke-width="2.5"/>
  </g>`;
}

/* Farbwunsch: vier Farbfelder im Kreis. */
function wildGlyph(scale) {
  const r = 16;
  const q = (start, fill) => {
    const a0 = (start * Math.PI) / 180;
    const a1 = ((start + 90) * Math.PI) / 180;
    return `<path d="M 0 0 L ${(r * Math.cos(a0)).toFixed(2)} ${(r * Math.sin(a0)).toFixed(2)} A ${r} ${r} 0 0 1 ${(r * Math.cos(a1)).toFixed(2)} ${(r * Math.sin(a1)).toFixed(2)} Z" fill="${fill}"/>`;
  };
  return `<g transform="scale(${scale})">
    ${q(180, CARD_COLORS.red)}${q(270, CARD_COLORS.blue)}${q(0, CARD_COLORS.yellow)}${q(90, CARD_COLORS.green)}
    <circle cx="0" cy="0" r="${r}" fill="none" stroke="#ffffff" stroke-width="2"/>
  </g>`;
}

/* Zieh Vier: vier kleine Karten in den vier Farben. */
function wild4Glyph(scale) {
  const card = (x, y, fill, rot) =>
    `<rect x="${x}" y="${y}" width="13" height="19" rx="2.5" fill="${fill}" stroke="#ffffff" stroke-width="2" transform="rotate(${rot} ${x + 6} ${y + 9})"/>`;
  return `<g transform="scale(${scale})">
    ${card(-15, -16, CARD_COLORS.blue, -12)}
    ${card(1, -16, CARD_COLORS.red, 12)}
    ${card(-15, -1, CARD_COLORS.yellow, -12)}
    ${card(1, -1, CARD_COLORS.green, 12)}
  </g>`;
}

function bigGlyph(card) {
  const color = CARD_COLORS[card.color] || CARD_COLORS.wild;
  switch (card.kind) {
    case 'skip':    return skipGlyph(color, 1.55, 6);
    case 'reverse': return reverseGlyph(color, 1.5);
    case 'draw2':   return drawTwoGlyph(color, 1.5);
    case 'wild':    return wildGlyph(1.7);
    case 'wild4':   return wild4Glyph(1.5);
    default:        return null; // Zahlen werden als Text gesetzt
  }
}

function cornerGlyph(card) {
  switch (card.kind) {
    case 'skip':    return skipGlyph('#ffffff', 0.55, 7);
    case 'reverse': return reverseGlyph('#ffffff', 0.5);
    case 'draw2':   return `<g transform="scale(0.42)">
        <rect x="-11" y="-13" width="15" height="22" rx="3" fill="#ffffff"/>
        <rect x="-2" y="-7" width="15" height="22" rx="3" fill="#ffffff" stroke="${CARD_COLORS[card.color]}" stroke-width="3"/>
      </g>`;
    case 'wild':    return wildGlyph(0.6);
    case 'wild4':   return `<g transform="scale(0.85)"><text x="0" y="0" text-anchor="middle" dominant-baseline="central"
        font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="26" fill="#ffffff">+4</text></g>`;
    default:        return `<text x="0" y="0" text-anchor="middle" dominant-baseline="central"
        font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="30" fill="#ffffff">${esc(card.kind)}</text>`;
  }
}

/* Die fertige Karte als SVG-Text. */
export function cardSvg(card) {
  const base = CARD_COLORS[card.color] || CARD_COLORS.wild;
  const shade = SHADE[card.color] || SHADE.wild;
  const isNum = card.kind.length === 1 && card.kind >= '0' && card.kind <= '9';
  const glyph = bigGlyph(card);

  const centre = isNum
    ? `<text x="0" y="4" text-anchor="middle" dominant-baseline="central"
         font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="96"
         fill="${base}" stroke="${shade}" stroke-width="2" paint-order="stroke">${esc(card.kind)}</text>`
    : glyph;

  return `<svg class="card-face" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-hidden="true">
  <rect x="0" y="0" width="${W}" height="${H}" rx="14" fill="#ffffff"/>
  <rect x="7" y="7" width="${W - 14}" height="${H - 14}" rx="10" fill="${base}"/>
  <ellipse cx="${W / 2}" cy="${H / 2}" rx="53" ry="33" fill="#ffffff" transform="rotate(-22 ${W / 2} ${H / 2})"/>
  <g transform="translate(${W / 2} ${H / 2})">${centre}</g>
  <g transform="translate(24 28)">${cornerGlyph(card)}</g>
  <g transform="translate(${W - 24} ${H - 28}) rotate(180)">${cornerGlyph(card)}</g>
</svg>`;
}

/* Kartenrueckseite. */
export function cardBackSvg() {
  return `<svg class="card-face" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-hidden="true">
  <rect x="0" y="0" width="${W}" height="${H}" rx="14" fill="#ffffff"/>
  <rect x="7" y="7" width="${W - 14}" height="${H - 14}" rx="10" fill="#101014"/>
  <ellipse cx="${W / 2}" cy="${H / 2}" rx="58" ry="36" fill="${CARD_COLORS.red}" transform="rotate(-22 ${W / 2} ${H / 2})"/>
  <text x="${W / 2}" y="${H / 2}" text-anchor="middle" dominant-baseline="central"
    transform="rotate(-22 ${W / 2} ${H / 2})"
    font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="40"
    fill="#f7c800" stroke="#ffffff" stroke-width="2" paint-order="stroke">UNO</text>
</svg>`;
}
