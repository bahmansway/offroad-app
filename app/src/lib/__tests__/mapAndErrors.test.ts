import { isAllowedExternalLink, parseMapMessage, buildPins } from '../../components/map/shared';
import { errorMessage } from '../errors';
import { ApiError } from '../apiClient';
import { translate } from '../i18n';
import { parsePriceInput } from '../format';

describe('map messages from the WebView', () => {
  it('accepts well-formed messages', () => {
    expect(parseMapMessage('{"type":"mapPress","lat":40.4,"lng":49.8}')).toEqual({ type: 'mapPress', lat: 40.4, lng: 49.8 });
    expect(parseMapMessage('{"type":"spotPress","id":"abc"}')).toEqual({ type: 'spotPress', id: 'abc' });
    expect(parseMapMessage('{"type":"ready"}')).toEqual({ type: 'ready' });
  });
  it('rejects bad payloads', () => {
    expect(parseMapMessage('not json')).toBeNull();
    expect(parseMapMessage('{"type":"mapPress","lat":"40","lng":49}')).toBeNull();
    expect(parseMapMessage('{"type":"mapPress","lat":95,"lng":49}')).toBeNull();
    expect(parseMapMessage('{"type":"spotPress","id":5}')).toBeNull();
    expect(parseMapMessage('{"type":"eval","code":"x"}')).toBeNull();
    expect(parseMapMessage('{"type":"openLink","url":"https://evil.example"}')).toBeNull();
  });
  it('only allows attribution links', () => {
    expect(isAllowedExternalLink('https://www.openstreetmap.org/copyright')).toBe(true);
    expect(isAllowedExternalLink('https://openfreemap.org')).toBe(true);
    expect(isAllowedExternalLink('https://openstreetmap.org.evil.com/')).toBe(false);
    expect(isAllowedExternalLink('javascript:alert(1)')).toBe(false);
  });
  it('escapes pin numbers into HTML safely', () => {
    const pins = buildPins({
      spots: [{ id: '1', type: 'trail', difficulty: 3, lat: 40, lng: 49 } as never],
      picked: null,
      pinLabel: () => '<b>x</b>',
    });
    expect(pins[0].html).toBe('3');
    const odd = buildPins({ spots: [{ id: '2', type: 'trail', difficulty: '<img>' as never, lat: 40, lng: 49 } as never], picked: null, pinLabel: () => '' });
    expect(odd[0].html).toBe('&lt;img&gt;');
  });
});

describe('error messages', () => {
  const t = (k: string, p?: Record<string, string | number>) => translate('en', k, p);
  it('explains rate limits on create and missing report targets', () => {
    expect(errorMessage(new ApiError(429, 'RATE_LIMITED', ''), t, 'create')).toMatch(/last hour/);
    expect(errorMessage(new ApiError(429, 'RATE_LIMITED', ''), t)).toMatch(/Too many attempts/);
    expect(errorMessage(new ApiError(404, 'NOT_FOUND', ''), t, 'report')).toMatch(/no longer exists/);
    expect(errorMessage(new ApiError(0, 'NETWORK', 'Request timed out'), t)).toMatch(/too long/);
    expect(errorMessage(new ApiError(401, 'UNAUTHORIZED', ''), t, 'auth')).toMatch(/Wrong email/);
  });
});

describe('price input', () => {
  it('allows at most 2 decimals', () => {
    expect(parsePriceInput('10.99')).toBe(10.99);
    expect(parsePriceInput('10.999')).toBeNaN();
  });
});
