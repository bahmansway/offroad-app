/**
 * Simple generated pictures for demo data: terrain-tone avatars and car silhouettes.
 * Pure SVG shapes (no text), so they render without any fonts installed (node:22-slim on Railway).
 * The SVG is rasterised to PNG here, then goes through the normal image pipeline (processImage).
 */
import sharp from 'sharp';

/** Small deterministic PRNG so the same seed gives the same picture. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const hashString = (s: string) => {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.codePointAt(0)!, 16777619);
  return h >>> 0;
};

const SKIES = [
  ['#F6C28B', '#E9845A'],
  ['#9CC7E8', '#E6EEF3'],
  ['#F2D49B', '#C9A25E'],
  ['#B7A6D9', '#F0C7A4'],
  ['#8FB9A8', '#E8E1C8'],
];
const EARTH = ['#6A4A32', '#8A5A2B', '#4E5B3A', '#7A6248', '#5B4636', '#3E5B3A'];

function ridge(r: () => number, w: number, h: number, base: number, amp: number, steps: number) {
  const pts: string[] = [`0,${h}`];
  for (let i = 0; i <= steps; i++) {
    const x = (w * i) / steps;
    const y = base - r() * amp;
    pts.push(`${x.toFixed(0)},${y.toFixed(0)}`);
  }
  pts.push(`${w},${h}`);
  return pts.join(' ');
}

export async function avatarPng(seed: string) {
  const r = rng(hashString(seed));
  const [s1, s2] = SKIES[Math.floor(r() * SKIES.length)];
  const e1 = EARTH[Math.floor(r() * EARTH.length)];
  const e2 = EARTH[Math.floor(r() * EARTH.length)];
  const sunX = 120 + r() * 270;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">
    <defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${s1}"/><stop offset="1" stop-color="${s2}"/></linearGradient></defs>
    <rect width="512" height="512" fill="url(#s)"/>
    <circle cx="${sunX.toFixed(0)}" cy="${(150 + r() * 60).toFixed(0)}" r="${(46 + r() * 30).toFixed(0)}" fill="#FFF4E0" opacity="0.85"/>
    <polygon points="${ridge(r, 512, 512, 330, 140, 5)}" fill="${e1}" opacity="0.75"/>
    <polygon points="${ridge(r, 512, 512, 420, 90, 7)}" fill="${e2}"/>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** Side view of an offroad car in its colour on a landscape. */
export async function carPng(seed: string, color: string, body: 'suv' | 'pickup' | 'small' = 'suv') {
  const r = rng(hashString(seed));
  const [s1, s2] = SKIES[Math.floor(r() * SKIES.length)];
  const e1 = EARTH[Math.floor(r() * EARTH.length)];
  const W = 1024;
  const H = 640;
  const ground = 520;
  const small = body === 'small';
  const len = small ? 520 : 680;
  const x0 = (W - len) / 2;
  const wheelR = small ? 62 : 74;
  const bodyTop = ground - wheelR - (small ? 120 : 140);
  const bodyBottom = ground - wheelR * 0.55;
  const cabinStart = x0 + (body === 'pickup' ? len * 0.2 : len * 0.12);
  const cabinEnd = body === 'pickup' ? x0 + len * 0.58 : x0 + len * 0.9;
  const roofY = bodyTop - (small ? 105 : 115);
  const w1 = x0 + len * 0.2;
  const w2 = x0 + len * 0.8;
  const rack = !small && r() > 0.5;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${s1}"/><stop offset="1" stop-color="${s2}"/></linearGradient></defs>
    <rect width="${W}" height="${H}" fill="url(#s)"/>
    <polygon points="${ridge(r, W, H, 380, 200, 6)}" fill="${e1}" opacity="0.55"/>
    <rect y="${ground}" width="${W}" height="${H - ground}" fill="#8C7556"/>
    <ellipse cx="${W / 2}" cy="${ground + 6}" rx="${len / 2 + 30}" ry="16" fill="#000" opacity="0.25"/>
    <rect x="${x0}" y="${bodyTop}" width="${len}" height="${bodyBottom - bodyTop}" rx="22" fill="${color}" stroke="#1A1A1A" stroke-opacity="0.35" stroke-width="4"/>
    <path d="M${cabinStart} ${bodyTop} L${cabinStart + 30} ${roofY} L${cabinEnd - 10} ${roofY} L${cabinEnd} ${bodyTop} Z" fill="${color}" stroke="#1A1A1A" stroke-opacity="0.35" stroke-width="4"/>
    <path d="M${cabinStart + 22} ${bodyTop - 8} L${cabinStart + 44} ${roofY + 14} L${(cabinStart + cabinEnd) / 2 - 6} ${roofY + 14} L${(cabinStart + cabinEnd) / 2 - 6} ${bodyTop - 8} Z" fill="#2B3540" opacity="0.85"/>
    <path d="M${(cabinStart + cabinEnd) / 2 + 6} ${bodyTop - 8} L${(cabinStart + cabinEnd) / 2 + 6} ${roofY + 14} L${cabinEnd - 22} ${roofY + 14} L${cabinEnd - 12} ${bodyTop - 8} Z" fill="#2B3540" opacity="0.85"/>
    ${rack ? `<rect x="${cabinStart + 30}" y="${roofY - 18}" width="${cabinEnd - cabinStart - 40}" height="10" fill="#222"/>` : ''}
    <rect x="${x0 - 8}" y="${bodyBottom - 34}" width="34" height="26" rx="6" fill="#222"/>
    <rect x="${x0 + len - 26}" y="${bodyBottom - 34}" width="34" height="26" rx="6" fill="#222"/>
    <rect x="${x0 + len - 22}" y="${bodyTop + 16}" width="18" height="22" rx="4" fill="#FFE9A8"/>
    ${[w1, w2]
      .map(
        (cx) =>
          `<circle cx="${cx}" cy="${ground - wheelR}" r="${wheelR}" fill="#151515"/><circle cx="${cx}" cy="${ground - wheelR}" r="${wheelR * 0.5}" fill="#8E9296"/><circle cx="${cx}" cy="${ground - wheelR}" r="${wheelR * 0.16}" fill="#3A3A3A"/>`,
      )
      .join('')}
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** Clan logo: a mountain on a coloured disc. */
export async function logoPng(seed: string, hue: string) {
  const r = rng(hashString(seed));
  const peak = 180 + r() * 150;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">
    <rect width="512" height="512" fill="${hue}"/>
    <circle cx="256" cy="256" r="200" fill="#FFFFFF" opacity="0.12"/>
    <polygon points="76,380 ${peak.toFixed(0)},130 436,380" fill="#FFFFFF"/>
    <polygon points="${(peak - 40).toFixed(0)},210 ${peak.toFixed(0)},130 ${(peak + 40).toFixed(0)},210 ${peak.toFixed(0)},190" fill="${hue}" opacity="0.6"/>
    <path d="M150 380 Q256 300 362 380" stroke="${hue}" stroke-width="22" fill="none"/>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
