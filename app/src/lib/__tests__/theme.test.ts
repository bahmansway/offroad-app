import { difficultySegments, isAppearancePref, mapStyleUrl, palettes, resolveScheme } from '../theme';
import { buildPins, pinCss } from '../../components/map/shared';
import { targetSize, absoluteUrl } from '../photos';
import { validateCar, validateProfile } from '../validation';

describe('theme tokens', () => {
  it('match the SPEC-v2 design tokens', () => {
    expect(palettes.light).toMatchObject({
      bg: '#F2F2F7', card: '#FFFFFF', label: '#000000', label2: '#6C6C70', tint: '#C2410C', onTint: '#FFFFFF',
      tintSoft: '#FBEAE0', tintSoftText: '#B4380A', destructive: '#D70015', glass: 'rgba(255,255,255,0.68)',
      separator: 'rgba(60,60,67,0.18)', fill: 'rgba(118,118,128,0.12)',
    });
    expect(palettes.dark).toMatchObject({
      bg: '#000000', card: '#1C1C1E', label: '#FFFFFF', label2: '#AEAEB2', tint: '#FF8A3D', onTint: '#1A0A00',
      tintSoft: '#3A2A20', tintSoftText: '#FF8A3D', destructive: '#FF6961', glass: 'rgba(28,28,30,0.62)',
      separator: 'rgba(84,84,88,0.65)', fill: 'rgba(118,118,128,0.24)',
    });
  });
  it('light and dark have the same keys', () => {
    expect(Object.keys(palettes.dark).sort()).toEqual(Object.keys(palettes.light).sort());
  });
  it('is light by default and follows the phone on "auto"', () => {
    expect(resolveScheme('auto', null)).toBe('light');
    expect(resolveScheme('auto', 'light')).toBe('light');
    expect(resolveScheme('auto', 'dark')).toBe('dark');
    expect(resolveScheme('light', 'dark')).toBe('light');
    expect(resolveScheme('dark', 'light')).toBe('dark');
    expect(isAppearancePref('auto')).toBe(true);
    expect(isAppearancePref('blue')).toBe(false);
  });
  it('picks the OpenFreeMap style by scheme', () => {
    expect(mapStyleUrl('light')).toBe('https://tiles.openfreemap.org/styles/positron');
    expect(mapStyleUrl('dark')).toBe('https://tiles.openfreemap.org/styles/dark');
  });
  it('fills difficulty segments up to the level', () => {
    expect(difficultySegments(2)).toEqual([true, true, false, false, false]);
    expect(difficultySegments(5)).toEqual([true, true, true, true, true]);
    expect(difficultySegments(null)).toEqual([false, false, false, false, false]);
    expect(difficultySegments(7)).toEqual([false, false, false, false, false]);
  });
  it('pin CSS uses the scheme colours', () => {
    expect(pinCss('light')).toContain('#C2410C');
    expect(pinCss('dark')).toContain('#FF8A3D');
  });
  it('pins show the level number or a tent, escaped', () => {
    const pins = buildPins({
      spots: [{ id: '1', type: 'trail', difficulty: 3, lat: 40, lng: 49 } as never, { id: '2', type: 'camp', difficulty: null, lat: 41, lng: 49 } as never],
      picked: null,
      pinLabel: () => 'x',
    });
    expect(pins[0].html).toBe('3');
    expect(pins[1].html).toContain('<svg');
  });
});

describe('photos', () => {
  it('only shrinks, keeping the longest side at the limit', () => {
    expect(targetSize(4000, 3000, 1024)).toEqual({ width: 1024 });
    expect(targetSize(3000, 4000, 512)).toEqual({ height: 512 });
    expect(targetSize(400, 300, 1024)).toEqual({});
  });
  it('makes server image paths absolute', () => {
    expect(absoluteUrl('/api/images/abc', 'https://x.app/')).toBe('https://x.app/api/images/abc');
    expect(absoluteUrl('https://cdn/x.jpg', 'https://x.app')).toBe('https://cdn/x.jpg');
    expect(absoluteUrl(null, 'https://x.app')).toBeNull();
  });
});

describe('car + profile validation (SPEC-v2 limits)', () => {
  const ok = { make: 'Toyota', model: 'Hilux', year: '2020', engine: '', engineL: '', hp: '', drive: null, transmission: null, fuel: null, color: '', description: '' };
  it('accepts empty optional specs', () => {
    expect(Object.values(validateCar(ok)).every((v) => v === null)).toBe(true);
  });
  it('checks spec ranges', () => {
    expect(validateCar({ ...ok, engineL: '0.4' }).engineL).toBe('specs.engineLInvalid');
    expect(validateCar({ ...ok, engineL: '2,8' }).engineL).toBeNull();
    expect(validateCar({ ...ok, hp: '19' }).hp).toBe('specs.hpInvalid');
    expect(validateCar({ ...ok, hp: '2001' }).hp).toBe('specs.hpInvalid');
    expect(validateCar({ ...ok, drive: 'tank' }).drive).toBe('errors.validation');
    expect(validateCar({ ...ok, color: 'x'.repeat(31) }).color).toBe('specs.colorTooLong');
  });
  it('checks profile limits', () => {
    expect(validateProfile({ displayName: 'A', city: '', bio: '' }).displayName).toBe('auth.nameInvalid');
    expect(validateProfile({ displayName: 'Ali', city: 'x'.repeat(61), bio: 'x'.repeat(301) })).toEqual({
      displayName: null, city: 'profile.cityTooLong', bio: 'profile.bioTooLong',
    });
  });
});
