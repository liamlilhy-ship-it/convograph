import { afterEach, describe, expect, it, vi } from 'vitest';
import { INSTALL_EVENT, buildInstallPayload, sendInstallEvent } from '../lib/analytics';

// Vitest loads .env.local too, so every send test stubs the env explicitly and
// replaces fetch — nothing here may reach Google.
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('buildInstallPayload', () => {
  it('carries the fields GA4 needs to count a Measurement Protocol event', () => {
    const p = buildInstallPayload('1.2.3', 1_700_000_000_500, 'cid');
    expect(p.client_id).toBe('cid');
    expect(p.events).toHaveLength(1);
    const [ev] = p.events;
    expect(ev.name).toBe(INSTALL_EVENT);
    expect(ev.params.session_id).toBe('1700000000');
    expect(ev.params.engagement_time_msec).toBeGreaterThan(0);
    expect(ev.params.extension_version).toBe('1.2.3');
  });

  it('generates a fresh client id by default', () => {
    expect(buildInstallPayload('1.0.0').client_id).not.toBe(buildInstallPayload('1.0.0').client_id);
  });
});

describe('sendInstallEvent', () => {
  it('sends nothing when the measurement id or secret is missing', async () => {
    vi.stubEnv('VITE_GA_MEASUREMENT_ID', '');
    vi.stubEnv('VITE_GA_API_SECRET', '');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await sendInstallEvent('1.0.0');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts the install event to the collect endpoint with id and secret', async () => {
    vi.stubEnv('VITE_GA_MEASUREMENT_ID', 'G-TEST');
    vi.stubEnv('VITE_GA_API_SECRET', 'sekret');
    vi.stubEnv('VITE_GA_DEBUG', '');
    const fetchMock = vi.fn().mockResolvedValue({ status: 204, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    await sendInstallEvent('1.0.0');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://www.google-analytics.com/mp/collect?measurement_id=G-TEST&api_secret=sekret');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body.events[0].name).toBe(INSTALL_EVENT);
    expect(body.events[0].params.extension_version).toBe('1.0.0');
  });

  it('swallows network failures', async () => {
    vi.stubEnv('VITE_GA_MEASUREMENT_ID', 'G-TEST');
    vi.stubEnv('VITE_GA_API_SECRET', 'sekret');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await expect(sendInstallEvent('1.0.0')).resolves.toBeUndefined();
  });
});
