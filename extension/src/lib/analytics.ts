/**
 * One-shot install ping over the GA4 Measurement Protocol, sent from the
 * background service worker on first install (see background.ts).
 *
 * Why the protocol and not a tag: the worker is not a page, so it cannot run
 * gtag/GTM. The protocol is a plain HTTPS POST and needs no manifest
 * permission. It also ignores the site's Consent Mode, so this ping counts
 * every install while the welcome-page view counts only consenting visitors.
 *
 * GA4 silently drops protocol events from standard reports unless they carry
 * a session_id and engagement_time_msec — both are always set here. Nothing
 * is persisted: a single event per install needs no stable client id.
 *
 * Configuration comes from Vite env vars (extension/.env.local, git-ignored):
 *   VITE_GA_MEASUREMENT_ID  the web stream's G-XXXXXXX id
 *   VITE_GA_API_SECRET      a Measurement Protocol API secret on that stream
 *   VITE_GA_DEBUG=1         post to Google's validation endpoint and log the
 *                           result instead of sending a real hit
 * When id or secret is missing (dev builds, tests) nothing is sent.
 */

const ENDPOINT = 'https://www.google-analytics.com/mp/collect';
const DEBUG_ENDPOINT = 'https://www.google-analytics.com/debug/mp/collect';

export const INSTALL_EVENT = 'extension_install';

export type InstallPayload = {
  client_id: string;
  events: [
    {
      name: typeof INSTALL_EVENT;
      params: {
        session_id: string;
        engagement_time_msec: number;
        extension_version: string;
      };
    },
  ];
};

export function buildInstallPayload(
  version: string,
  now: number = Date.now(),
  clientId: string = crypto.randomUUID(),
): InstallPayload {
  return {
    client_id: clientId,
    events: [
      {
        name: INSTALL_EVENT,
        params: {
          session_id: String(Math.floor(now / 1000)),
          engagement_time_msec: 100,
          extension_version: version,
        },
      },
    ],
  };
}

export async function sendInstallEvent(version: string): Promise<void> {
  const id = import.meta.env.VITE_GA_MEASUREMENT_ID;
  const secret = import.meta.env.VITE_GA_API_SECRET;
  if (!id || !secret) return;

  const debug = import.meta.env.VITE_GA_DEBUG === '1';
  const url = `${debug ? DEBUG_ENDPOINT : ENDPOINT}?measurement_id=${id}&api_secret=${secret}`;
  try {
    // No Content-Type header on purpose: a "simple" request needs no CORS
    // preflight, which is what lets the worker post here without a host permission.
    const res = await fetch(url, { method: 'POST', body: JSON.stringify(buildInstallPayload(version)) });
    if (debug) console.log('[convograph] GA validation:', res.status, await res.json());
  } catch (err) {
    if (debug) console.warn('[convograph] GA install ping failed:', err);
  }
}
