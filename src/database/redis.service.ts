import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from '@upstash/redis';
import { MetricsService } from '../observability/metrics.service';
import { LoggerService } from '../observability/logger.service';

@Injectable()
export class RedisService implements OnModuleInit {
  private client: Redis | null = null;

  constructor(
    private configService: ConfigService,
    private metrics: MetricsService,
    private logger: LoggerService,
  ) {}

  onModuleInit(): void {
    const url = this.configService.get<string>('UPSTASH_REDIS_REST_URL');
    const token = this.configService.get<string>('UPSTASH_REDIS_REST_TOKEN');

    if (url && token) {
      this.client = new Redis({ url, token });
      this.logger.info('Redis client initialized');
    } else {
      this.logger.warn('Redis credentials not configured, skipping connection');
    }
  }

  async get<T>(key: string): Promise<T | null> {
    if (!this.client) return null;
    const value = await this.client.get<T>(key);
    if (value !== null && value !== undefined) {
      this.metrics.recordCacheHit();
    } else {
      this.metrics.recordCacheMiss();
    }
    return value;
  }

  async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    if (!this.client) return;
    if (ttlSeconds) {
      await this.client.set(key, value, { ex: ttlSeconds });
    } else {
      await this.client.set(key, value);
    }
  }

  async del(key: string): Promise<void> {
    if (!this.client) return;
    await this.client.del(key);
  }

  async verifyConnectivity(): Promise<boolean> {
    if (!this.client) return false;
    try {
      await this.client.ping();
      return true;
    } catch {
      return false;
    }
  }
}
