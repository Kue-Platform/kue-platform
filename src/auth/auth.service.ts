import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { google, Auth } from 'googleapis';
import { SupabaseService } from '../database/supabase.service';
import { LoggerService } from '../observability/logger.service';
import { PosthogService } from '../observability/posthog.service';
import { SentryService } from '../observability/sentry.service';
import { PostHogEvents } from '../common/types/events';
import { SessionService } from './session.service';

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
const GOOGLE_SOURCES = ['gmail', 'google_contacts', 'google_calendar'] as const;

@Injectable()
export class AuthService {
  private oauth2Client: Auth.OAuth2Client;

  constructor(
    private readonly config: ConfigService,
    private readonly supabase: SupabaseService,
    private readonly logger: LoggerService,
    private readonly posthog: PosthogService,
    private readonly sentry: SentryService,
    private readonly sessionService: SessionService,
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

      try {
        await this.ensureTenantMembership(data.user.id, data.user.email || email);
      } catch (tenantError) {
        this.logger.warn('Tenant provisioning skipped during OTP login', {
          userId: data.user.id,
          error: tenantError instanceof Error ? tenantError.message : String(tenantError),
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

      try {
        await this.ensureTenantMembership(user.id, user.email || '');
      } catch (tenantError) {
        this.logger.warn('Tenant provisioning skipped during session exchange', {
          userId: user.id,
          error: tenantError instanceof Error ? tenantError.message : String(tenantError),
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
  getGoogleAuthUrl(userId: string): string {
    const stateToken = this.sessionService.createGoogleOAuthStateToken(userId);
    const url = this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: GOOGLE_SCOPES,
      state: stateToken,
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
      const tenantId = this.getDefaultTenantId(userId);
      await this.ensureTenantMembership(userId, profile.email || undefined, profile.name || undefined);

      // Keep one Google connection set per user for auth-only scope.
      const { error: deleteError } = await this.supabase.getClient()
        .from('source_connections')
        .delete()
        .eq('tenant_id', tenantId)
        .eq('user_id', userId)
        .in('source', [...GOOGLE_SOURCES]);

      if (deleteError) {
        this.logger.error('Failed to clean existing Google connection', {
          userId,
          error: deleteError.message,
        });
        throw new Error(`Failed to prepare Google connection: ${deleteError.message}`);
      }

      const { error: insertError } = await this.supabase.getClient()
        .from('source_connections')
        .upsert(
          GOOGLE_SOURCES.map(source => ({
            tenant_id: tenantId,
            user_id: userId,
            source,
            external_account_id: profile.id || profile.email || 'unknown',
            token_json: {
              access_token: googleTokens.accessToken,
              refresh_token: googleTokens.refreshToken,
              expires_at: googleTokens.expiresAt.toISOString(),
              scopes: googleTokens.scopes,
              profile: {
                email: profile.email,
                name: profile.name,
                picture: profile.picture,
              },
            },
            status: 'active',
          })),
          { onConflict: 'tenant_id,user_id,source,external_account_id' },
        );

      if (insertError) {
        this.logger.error('Failed to store connected account', { error: insertError.message });
        throw new Error(`Failed to store tokens: ${insertError.message}`);
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
    const tenantId = this.getDefaultTenantId(userId);
    const { data, error } = await this.supabase.getClient()
      .from('source_connections')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('user_id', userId)
      .in('source', [...GOOGLE_SOURCES])
      .eq('status', 'active')
      .order('updated_at', { ascending: false })
      .limit(1);

    const account = data?.[0];

    if (error || !account) {
      throw new UnauthorizedException('Google account not connected');
    }

    const client = new google.auth.OAuth2(
      this.config.get<string>('GOOGLE_CLIENT_ID'),
      this.config.get<string>('GOOGLE_CLIENT_SECRET'),
      this.config.get<string>('GOOGLE_REDIRECT_URI'),
    );
    const tokenJson = (account.token_json ?? {}) as {
      access_token?: string;
      refresh_token?: string;
      expires_at?: string;
    };

    client.setCredentials({
      access_token: tokenJson.access_token,
      refresh_token: tokenJson.refresh_token,
    });

    // Check if token is expired or about to expire (within 5 min)
    const expiresAt = tokenJson.expires_at
      ? new Date(tokenJson.expires_at)
      : new Date(Date.now() + 60 * 60 * 1000);
    const isExpiring = expiresAt.getTime() - Date.now() < 5 * 60 * 1000;

    if (isExpiring && tokenJson.refresh_token) {
      try {
        const { credentials } = await client.refreshAccessToken();

        // Update stored tokens
        const updatedTokenJson = {
          ...tokenJson,
          access_token: credentials.access_token,
          expires_at: new Date(
            credentials.expiry_date || Date.now() + 3600 * 1000,
          ).toISOString(),
        };

        await this.supabase.getClient()
          .from('source_connections')
          .update({
            token_json: updatedTokenJson,
            status: 'active',
          })
          .eq('id', account.id);

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
    const tenantId = this.getDefaultTenantId(userId);
    const { data, error } = await this.supabase.getClient()
      .from('source_connections')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('user_id', userId)
      .in('source', [...GOOGLE_SOURCES])
      .eq('status', 'active')
      .limit(1);

    return !error && !!data?.length;
  }

  /**
   * Disconnect a Google account
   */
  async disconnectGoogle(userId: string): Promise<void> {
    const tenantId = this.getDefaultTenantId(userId);
    const { error } = await this.supabase.getClient()
      .from('source_connections')
      .update({ status: 'revoked' })
      .eq('tenant_id', tenantId)
      .eq('user_id', userId)
      .in('source', [...GOOGLE_SOURCES]);

    if (error) {
      this.logger.error('Failed to disconnect Google', { userId, error: error.message });
      throw new Error('Failed to disconnect Google account');
    }

    this.logger.info('Google account disconnected', { userId });
  }

  private getDefaultTenantId(userId: string): string {
    return `tenant_${userId}`;
  }

  private async ensureTenantMembership(
    userId: string,
    email?: string,
    displayName?: string,
  ): Promise<void> {
    const tenantId = this.getDefaultTenantId(userId);
    const tenantName = email ? `${email.split('@')[0]}'s workspace` : 'My Workspace';

    const { error: tenantError } = await this.supabase.getClient()
      .from('tenants')
      .upsert(
        {
          tenant_id: tenantId,
          name: tenantName,
          plan: 'free',
          settings_json: {},
        },
        { onConflict: 'tenant_id' },
      );

    if (tenantError) {
      this.logger.error('Failed to upsert tenant', { userId, error: tenantError.message });
      throw new Error(`Failed to initialize tenant: ${tenantError.message}`);
    }

    const { error: membershipError } = await this.supabase.getClient()
      .from('tenant_users')
      .upsert(
        {
          tenant_id: tenantId,
          user_id: userId,
          email: email || '',
          display_name: displayName || email || 'User',
          role: 'admin',
          status: 'active',
        },
        { onConflict: 'tenant_id,user_id' },
      );

    if (membershipError) {
      this.logger.error('Failed to upsert tenant user', { userId, error: membershipError.message });
      throw new Error(`Failed to initialize tenant user: ${membershipError.message}`);
    }
  }
}
