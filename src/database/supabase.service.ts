import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { LoggerService } from '../observability/logger.service';

@Injectable()
export class SupabaseService implements OnModuleInit {
  private client: SupabaseClient | null = null;

  constructor(
    private configService: ConfigService,
    private logger: LoggerService,
  ) {}

  onModuleInit(): void {
    const url = this.configService.get<string>('SUPABASE_URL');
    const serviceRoleKey = this.configService.get<string>(
      'SUPABASE_SERVICE_ROLE_KEY',
    );

    if (url && serviceRoleKey) {
      this.client = createClient(url, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      this.logger.info('Supabase client initialized', { url });
    } else {
      this.logger.warn(
        'Supabase credentials not configured, skipping connection',
      );
    }
  }

  getClient(): SupabaseClient {
    if (!this.client) {
      throw new Error('Supabase client not initialized');
    }
    return this.client;
  }

  async verifyConnectivity(): Promise<boolean> {
    if (!this.client) return false;
    try {
      const { error } = await this.client.from('profiles').select('id').limit(0);
      return !error;
    } catch {
      return false;
    }
  }
}
