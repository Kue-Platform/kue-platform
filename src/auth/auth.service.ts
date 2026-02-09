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
   * Generate the Google OAuth consent URL
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
