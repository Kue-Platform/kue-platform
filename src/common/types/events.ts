export const PostHogEvents = {
  USER_SIGNED_UP: 'user_signed_up',
  USER_SIGNED_IN: 'user_signed_in',
  AUTH_OTP_SENT: 'auth_otp_sent',
  AUTH_OTP_VERIFIED: 'auth_otp_verified',
  PLATFORM_CONNECTED: 'platform_connected',
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
}
