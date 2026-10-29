import {
  contrastRatio, palettes, signColors, terrain, thumbTone, TERRAIN_TONES, type Scheme,
} from '../theme';
import { carTotalDisplay, formatAvg, formatPrice, formatShortDate } from '../format';
import { groupByWeek, isSoon } from '../eventLogic';
import { buildPins, pinCss, spotPinInner } from '../../components/map/shared';
import az from '../../locales/az';
import en from '../../locales/en';

const SCHEMES: Scheme[] = ['light', 'dark'];

describe('trail-sign difficulty colours', () => {
  it('has a plate for levels 1–5 only', () => {
    expect(signColors(0, 'light')).toBeNull();
    expect(signColors(6, 'light')).toBeNull();
    expect(signColors(null, 'dark')).toBeNull();
    expect(signColors(2.5, 'dark')).toBeNull();
  });
  it('keeps text and number at 4.5:1 or more on the plate (light and dark)', () => {
    for (const sc of SCHEMES) {
      for (const n of [1, 2, 3, 4, 5]) {
        const col = signColors(n, sc)!;
        expect(contrastRatio(col.text, col.plate)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(col.num, col.plate)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
  it('matches the design table', () => {
    expect(signColors(1, 'light')).toMatchObject({ plate: '#E7DCC8', text: '#5A4628' });
    expect(signColors(3, 'light')).toMatchObject({ plate: '#C2410C', text: '#FFFFFF' });
    expect(signColors(4, 'dark')).toMatchObject({ plate: '#FFFFFF', text: '#000000' });
    expect(signColors(5, 'light')).toMatchObject({ plate: '#1C1C1E', num: '#FF8A3D', ring: '#C2410C' });
    expect(signColors(5, 'dark')).toMatchObject({ num: '#C2410C', ring: '#FF8A3D' });
  });
  it('has short level words in both languages', () => {
    expect(az.levels.short).toEqual(['Asan', 'Orta', 'Çətin', 'Ekstrem', 'Peşəkar']);
    expect(en.levels.short).toHaveLength(5);
  });
});

describe('terrain tones', () => {
  it('chip text is readable on its soft background, and white glyphs on the solid tile (3:1)', () => {
    for (const sc of SCHEMES) {
      for (const tone of TERRAIN_TONES) {
        const x = terrain(palettes[sc], tone);
        expect(contrastRatio(x.text, x.soft)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio('#FFFFFF', x.solid)).toBeGreaterThanOrEqual(3);
      }
    }
  });
  it('colour comes from the type, not the id', () => {
    expect(thumbTone('trail')).toBe('clay');
    expect(thumbTone('camp')).toBe('forest');
    expect(thumbTone('event')).toBe('sand');
    expect(thumbTone('car')).toBe('stone');
    expect(thumbTone('clan')).toBe('stone');
  });
  it('date block month strip is readable and the tint strip stands out on the card (3:1)', () => {
    for (const sc of SCHEMES) {
      const c = palettes[sc];
      expect(contrastRatio(c.onTint, c.tint)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(c.paperText, c.paper)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(c.tint, c.card)).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('car total (owner vs others)', () => {
  const mods = [
    { price: 1800, currency: 'AZN', pricePublic: false },
    { price: 2400, currency: 'AZN', pricePublic: true },
  ];
  const car = { mods, totalPublicSpend: { AZN: 2400 }, hiddenPriceCount: 1 };
  it('owner sees the real total and what others see', () => {
    expect(carTotalDisplay(car, true, 'az')).toEqual({ total: formatPrice(4200, 'AZN', 'az'), othersSee: formatPrice(2400, 'AZN', 'az') });
  });
  it('owner with no private prices gets no second line', () => {
    const pub = { mods: [mods[1]], totalPublicSpend: { AZN: 2400 }, hiddenPriceCount: 0 };
    expect(carTotalDisplay(pub, true, 'en')).toEqual({ total: '2,400 AZN', othersSee: null });
  });
  it('others only ever see the public total, even if a private price leaked into the data', () => {
    // the server sends price=null for private mods to non-owners; even if it did not, we never sum them
    expect(carTotalDisplay(car, false, 'az')).toEqual({ total: formatPrice(2400, 'AZN', 'az'), othersSee: null });
    const asSentToOthers = { mods: [{ price: null, currency: 'AZN', pricePublic: false }, mods[1]], totalPublicSpend: { AZN: 2400 }, hiddenPriceCount: 1 };
    expect(carTotalDisplay(asSentToOthers, false, 'az').total).toBe(formatPrice(2400, 'AZN', 'az'));
  });
  it('shows 0 AZN when nothing is priced', () => {
    expect(carTotalDisplay({ mods: [], totalPublicSpend: {}, hiddenPriceCount: 0 }, true)).toEqual({ total: '0 AZN', othersSee: null });
  });
  it('formats the average with one decimal', () => {
    expect(formatAvg(4, 'en')).toBe('4.0');
    expect(formatAvg(4.26, 'az')).toBe('4,3');
    expect(formatAvg(null)).toBe('–');
  });
});

describe('short list dates', () => {
  const now = new Date(2026, 9, 29, 15, 0);
  const w = { today: 'bu gün', yesterday: 'dünən', monthsShort: az.events.monthsShort };
  it('says today / yesterday / day + short month', () => {
    expect(formatShortDate(new Date(2026, 9, 29, 8).toISOString(), w, 'az', now)).toBe('bu gün');
    expect(formatShortDate(new Date(2026, 9, 28, 23).toISOString(), w, 'az', now)).toBe('dünən');
    expect(formatShortDate(new Date(2026, 9, 2).toISOString(), w, 'az', now)).toBe('2 okt');
    expect(formatShortDate(new Date(2025, 5, 2).toISOString(), w, 'az', now)).toBe('2 iyn 2025');
    expect(formatShortDate('nope', w, 'az', now)).toBe('');
  });
});

describe('events: this week / later', () => {
  const now = new Date('2026-10-29T10:00:00Z');
  it('groups by the next 7 days and keeps order', () => {
    const items = [
      { id: 1, startsAt: '2026-10-30T05:00:00Z' },
      { id: 2, startsAt: '2026-11-20T05:00:00Z' },
      { id: 3, startsAt: '2026-11-04T05:00:00Z' },
    ];
    const g = groupByWeek(items, now);
    expect(g.thisWeek.map((e) => e.id)).toEqual([1, 3]);
    expect(g.later.map((e) => e.id)).toEqual([2]);
    expect(isSoon('2026-11-05T10:00:00Z', now)).toBe(false);
    expect(isSoon('bad', now)).toBe(false);
  });
  it('has spelled-out weekdays in both languages', () => {
    expect(az.events.weekdaysLong[6]).toBe('Şənbə');
    expect(en.events.weekdaysLong).toHaveLength(7);
  });
});

describe('map pins', () => {
  it('trail pin = teardrop + escaped number, camp = forest class + tent, picked = tint class', () => {
    expect(spotPinInner({ type: 'trail', difficulty: '<b>' as never })).toContain('&lt;b&gt;');
    const pins = buildPins({ spots: [], picked: { lat: 40, lng: 49 }, pinLabel: () => '' });
    expect(pins[0].className).toBe('or-pin or-pin--picked');
    const css = pinCss('dark');
    expect(css).toContain('.or-pin--camp .or-drop path{fill:#5E7F58');
    expect(css).toContain('.or-cluster');
    expect(css).toContain('height:48px');
  });
});
