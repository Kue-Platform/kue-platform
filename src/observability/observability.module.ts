import { Global, Module } from '@nestjs/common';
import { SentryService } from './sentry.service';
import { PosthogService } from './posthog.service';
import { LoggerService } from './logger.service';
import { MetricsService } from './metrics.service';

@Global()
@Module({
  providers: [SentryService, PosthogService, LoggerService, MetricsService],
  exports: [SentryService, PosthogService, LoggerService, MetricsService],
})
export class ObservabilityModule {}
