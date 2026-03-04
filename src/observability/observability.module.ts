import { Global, Module } from '@nestjs/common';
import { SentryService } from './sentry.service';
import { PosthogService } from './posthog.service';
import { LoggerService } from './logger.service';

@Global()
@Module({
  providers: [SentryService, PosthogService, LoggerService],
  exports: [SentryService, PosthogService, LoggerService],
})
export class ObservabilityModule {}
