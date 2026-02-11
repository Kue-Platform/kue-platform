export const PostHogEvents = {
  USER_SIGNED_UP: 'user_signed_up',
  USER_SIGNED_IN: 'user_signed_in',
  AUTH_OTP_SENT: 'auth_otp_sent',
  AUTH_OTP_VERIFIED: 'auth_otp_verified',
  PLATFORM_CONNECTED: 'platform_connected',
  SYNC_STARTED: 'sync_started',
  SYNC_COMPLETED: 'sync_completed',
  SYNC_FAILED: 'sync_failed',
  CSV_IMPORTED: 'csv_imported',
  SEARCH_PERFORMED: 'search_performed',
  CONTACT_VIEWED: 'contact_viewed',
  ENRICHMENT_COMPLETED: 'enrichment_completed',
} as const;

export type PostHogEventName =
  (typeof PostHogEvents)[keyof typeof PostHogEvents];

export interface PostHogEventProperties {
  [PostHogEvents.USER_SIGNED_UP]: { email: string; method: string };
  [PostHogEvents.USER_SIGNED_IN]: { email: string; method: string };
  [PostHogEvents.AUTH_OTP_SENT]: { email: string };
  [PostHogEvents.AUTH_OTP_VERIFIED]: { email: string; isNewUser: boolean };
  [PostHogEvents.PLATFORM_CONNECTED]: {
    platform: string;
    scopeCount: number;
  };
  [PostHogEvents.SYNC_STARTED]: { source: string; isIncremental: boolean };
  [PostHogEvents.SYNC_COMPLETED]: {
    source: string;
    contactsFound: number;
    durationMs: number;
  };
  [PostHogEvents.SYNC_FAILED]: { source: string; error: string };
  [PostHogEvents.CSV_IMPORTED]: { contactCount: number };
  [PostHogEvents.SEARCH_PERFORMED]: {
    query: string;
    resultCount: number;
    latencyMs: number;
    cacheHit: boolean;
  };
  [PostHogEvents.CONTACT_VIEWED]: { contactId: string };
  [PostHogEvents.ENRICHMENT_COMPLETED]: { fieldsEnriched: string[] };
}
