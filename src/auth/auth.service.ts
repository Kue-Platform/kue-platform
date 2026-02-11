import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { google, Auth } from 'googleapis';
import { SupabaseService } from '../database/supabase.service';
import { LoggerService } from '../observability/logger.service';
import { PosthogService } from '../observability/posthog.service';
import { SentryService } from '../observability/sentry.service';
import { PostHogEvents } from '../common/types/events';

export interface GoogleTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date;
  scopes: string[];
}

const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/contacts.readonly',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
];

@Injectable()
export class AuthService {
  private oauth2Client: Auth.OAuth2Client;

  constructor(
    private readonly config: ConfigService,
    private readonly supabase: SupabaseService,
    private readonly logger: LoggerService,
    private readonly posthog: PosthogService,
    private readonly sentry: SentryService,
  ) {
    this.oauth2Client = new google.auth.OAuth2(
      this.config.get<string>('GOOGLE_CLIENT_ID'),
      this.config.get<string>('GOOGLE_CLIENT_SECRET'),
      this.config.get<string>('GOOGLE_REDIRECT_URI'),
    );
  }

  /**
   * Send OTP code to user's email (works for both new and existing users)
   */
  async sendOtp(email: string): Promise<{ success: boolean; message: string }> {
    try {
      const { error } = await this.supabase.getClient().auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: true, // Creates user if doesn't exist
        },
      });

      if (error) {
        this.logger.error('Failed to send OTP', { email, error: error.message });
        throw new Error(`Failed to send OTP: ${error.message}`);
      }

      this.logger.info('OTP sent successfully', { email });
      this.posthog.capture(email, PostHogEvents.AUTH_OTP_SENT, { email });

      return {
        success: true,
        message: 'Verification code sent to your email',
      };
    } catch (error) {
      this.sentry.captureException(error as Error, { email, context: 'send_otp' });
      throw error;
    }
  }

  /**
   * Verify OTP code and create/authenticate user session
   */
  async verifyOtp(email: string, token: string): Promise<{
    accessToken: string;
    refreshToken: string;
    user: {
      id: string;
      email: string;
      createdAt: string;
    };
    isNewUser: boolean;
  }> {
    try {
      const { data, error } = await this.supabase.getClient().auth.verifyOtp({
        email,
        token,
        type: 'email',
      });

      if (error || !data.session || !data.user) {
        this.logger.error('OTP verification failed', { email, error: error?.message });
        throw new UnauthorizedException('Invalid or expired verification code');
      }

      // Check if this is a new user (created just now)
      const isNewUser = new Date(data.user.created_at).getTime() > Date.now() - 60000; // Within last minute

      this.logger.info('OTP verified successfully', {
        userId: data.user.id,
        email,
        isNewUser,
      });

      this.posthog.capture(data.user.id, PostHogEvents.AUTH_OTP_VERIFIED, {
        email,
        isNewUser,
      });

      if (isNewUser) {
        this.posthog.capture(data.user.id, PostHogEvents.USER_SIGNED_UP, {
          email,
          method: 'otp',
        });
      } else {
        this.posthog.capture(data.user.id, PostHogEvents.USER_SIGNED_IN, {
          email,
          method: 'otp',
        });
      }

      return {
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
        user: {
          id: data.user.id,
          email: data.user.email!,
          createdAt: data.user.created_at,
        },
        isNewUser,
      };
    } catch (error) {
      this.sentry.captureException(error as Error, { email, context: 'verify_otp' });
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException('Failed to verify code');
    }
  }

  /**
   * Exchange Supabase access token for backend session
   */
  async exchangeSession(accessToken: string): Promise<{
    user: {
      id: string;
      email: string;
      createdAt: string;
    };
    isNewUser: boolean;
  }> {
    try {
      // Verify the token with Supabase
      const {
        data: { user },
        error,
      } = await this.supabase.getClient().auth.getUser(accessToken);

      if (error || !user) {
        this.logger.error('Token exchange failed', { error: error?.message });
        throw new UnauthorizedException('Invalid or expired token');
      }

      // Check if this is a new user (created within last minute)
      const isNewUser = new Date(user.created_at).getTime() > Date.now() - 60000;

      this.logger.info('Token exchange successful', {
        userId: user.id,
        email: user.email,
        isNewUser,
      });

      // Track sign-in event
      if (isNewUser) {
        this.posthog.capture(user.id, PostHogEvents.USER_SIGNED_UP, {
          email: user.email,
          method: 'oauth_google',
        });
      } else {
        this.posthog.capture(user.id, PostHogEvents.USER_SIGNED_IN, {
          email: user.email,
          method: 'oauth_google',
        });
      }

      return {
        user: {
          id: user.id,
          email: user.email!,
          createdAt: user.created_at,
        },
        isNewUser,
      };
    } catch (error) {
      this.sentry.captureException(error as Error, { context: 'exchange_session' });
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException('Failed to exchange token');
    }
  }

  /**
   * Check if an email already exists in the system (optional helper)
   */
  async checkEmailExists(email: string): Promise<boolean> {
    try {
      // Check in Supabase auth.users table using admin API
      const { data, error } = await this.supabase.getClient().auth.admin.listUsers();

      if (error) {
        this.logger.error('Failed to check email existence', { email, error: error.message });
        return false;
      }

      // Check if any user has this email
      const userExists = data.users.some(user => user.email?.toLowerCase() === email.toLowerCase());

      return userExists;
    } catch (error) {
      this.logger.error('Error checking email existence', {
        email,
        error: error instanceof Error ? error.message : String(error),
      });
      // If error, assume email doesn't exist
      return false;
    }
  }

  /**
   * Generate Supabase OAuth (Google) sign-in URL for frontend authentication
   */
  async getGoogleSignInUrl(redirectTo: string = 'http://localhost:8081/'): Promise<string> {
    const { data, error } = await this.supabase.getClient().auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo,
        queryParams: {
          access_type: 'offline',
          prompt: 'consent',
        },
      },
    });

    if (error) {
      this.logger.error('Failed to generate Google sign-in URL', { error: error.message });
      throw new Error(`Failed to generate sign-in URL: ${error.message}`);
    }
    return data.url;
  }

  /**
   * Generate the Google OAuth consent URL (for data sync)
   */
  getGoogleAuthUrl(state?: string): string {
    const url = this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: GOOGLE_SCOPES,
      state,
    });

    this.logger.info('Generated Google OAuth URL');
    return url;
  }

  /**
   * Exchange authorization code for tokens, store in Supabase
   */
  async handleGoogleCallback(
    code: string,
    userId: string,
  ): Promise<GoogleTokens> {
    try {
      const { tokens } = await this.oauth2Client.getToken(code);

      if (!tokens.access_token) {
        throw new UnauthorizedException('Failed to obtain access token');
      }

      const googleTokens: GoogleTokens = {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || null,
        expiresAt: new Date(tokens.expiry_date || Date.now() + 3600 * 1000),
        scopes: tokens.scope?.split(' ') || GOOGLE_SCOPES,
      };

      // Get user's Google profile info
      this.oauth2Client.setCredentials(tokens);
      const oauth2 = google.oauth2({ version: 'v2', auth: this.oauth2Client });
      const { data: profile } = await oauth2.userinfo.get();

      // Upsert connected account in Supabase
      const { error } = await this.supabase.getClient()
        .from('connected_accounts')
        .upsert(
          {
            user_id: userId,
            provider: 'google',
            provider_account_id: profile.id || profile.email || 'unknown',
            access_token: googleTokens.accessToken,
            refresh_token: googleTokens.refreshToken,
            token_expires_at: googleTokens.expiresAt.toISOString(),
            scopes: googleTokens.scopes,
            metadata: {
              email: profile.email,
              name: profile.name,
              picture: profile.picture,
            },
          },
          { onConflict: 'user_id,provider,provider_account_id' },
        );

      if (error) {
        this.logger.error('Failed to store connected account', { error: error.message });
        throw new Error(`Failed to store tokens: ${error.message}`);
      }

      this.posthog.capture(userId, PostHogEvents.PLATFORM_CONNECTED, {
        platform: 'google',
        scopeCount: googleTokens.scopes.length,
      });

      this.logger.info('Google account connected', {
        userId,
        email: profile.email,
      });

      return googleTokens;
    } catch (error) {
      this.sentry.captureException(error as Error, { userId, context: 'google_callback' });
      this.logger.error('Google OAuth callback failed', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get a valid OAuth2 client for a user, refreshing tokens if needed
   */
  async getAuthenticatedClient(userId: string): Promise<Auth.OAuth2Client> {
    const { data, error } = await this.supabase.getClient()
      .from('connected_accounts')
      .select('*')
      .eq('user_id', userId)
      .eq('provider', 'google')
      .single();

    if (error || !data) {
      throw new UnauthorizedException('Google account not connected');
    }

    const client = new google.auth.OAuth2(
      this.config.get<string>('GOOGLE_CLIENT_ID'),
      this.config.get<string>('GOOGLE_CLIENT_SECRET'),
      this.config.get<string>('GOOGLE_REDIRECT_URI'),
    );

    client.setCredentials({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
    });

    // Check if token is expired or about to expire (within 5 min)
    const expiresAt = new Date(data.token_expires_at);
    const isExpiring = expiresAt.getTime() - Date.now() < 5 * 60 * 1000;

    if (isExpiring && data.refresh_token) {
      try {
        const { credentials } = await client.refreshAccessToken();

        // Update stored tokens
        await this.supabase.getClient()
          .from('connected_accounts')
          .update({
            access_token: credentials.access_token,
            token_expires_at: new Date(
              credentials.expiry_date || Date.now() + 3600 * 1000,
            ).toISOString(),
          })
          .eq('id', data.id);

        this.logger.info('Refreshed Google tokens', { userId });
      } catch (refreshError) {
        this.logger.error('Failed to refresh Google tokens', {
          userId,
          error: refreshError instanceof Error ? refreshError.message : String(refreshError),
        });
        throw new UnauthorizedException('Google tokens expired. Please re-authenticate.');
      }
    }

    return client;
  }

  /**
   * Check if a user has a connected Google account
   */
  async hasGoogleConnection(userId: string): Promise<boolean> {
    const { data, error } = await this.supabase.getClient()
      .from('connected_accounts')
      .select('id')
      .eq('user_id', userId)
      .eq('provider', 'google')
      .single();

    return !error && !!data;
  }

  /**
   * Disconnect a Google account
   */
  async disconnectGoogle(userId: string): Promise<void> {
    const { error } = await this.supabase.getClient()
      .from('connected_accounts')
      .delete()
      .eq('user_id', userId)
      .eq('provider', 'google');

    if (error) {
      this.logger.error('Failed to disconnect Google', { userId, error: error.message });
      throw new Error('Failed to disconnect Google account');
    }

    this.logger.info('Google account disconnected', { userId });
  }
}
