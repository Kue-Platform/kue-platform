import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PostHog } from 'posthog-node';

@Injectable()
export class PosthogService implements OnModuleDestroy {
  private client: PostHog | null = null;

  constructor(private configService: ConfigService) {
    const apiKey = this.configService.get<string>('POSTHOG_API_KEY');
    const host = this.configService.get<string>('POSTHOG_HOST');

    if (apiKey) {
      this.client = new PostHog(apiKey, { host });
    }
  }

  capture(
    userId: string,
    event: string,
    properties?: Record<string, unknown>,
  ): void {
    this.client?.capture({
      distinctId: userId,
      event,
      properties,
    });
  }

  identify(
    userId: string,
    properties?: Record<string, unknown>,
  ): void {
    this.client?.identify({
      distinctId: userId,
      properties,
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.shutdown();
  }
}
