/**
 * Platform-neutral API error carrying an HTTP status. Each provider's client
 * throws this (or a subclass) so the app can map auth failures (401/403) to a
 * sign-in prompt without knowing which platform it's on.
 */
export class PlatformApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'PlatformApiError';
  }
}
