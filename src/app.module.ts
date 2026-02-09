import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { SentryGlobalFilter, SentryModule } from '@sentry/nestjs/setup';
import { ConfigModule } from './config/config.module';
import { ObservabilityModule } from './observability/observability.module';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { AiModule } from './ai/ai.module';
import { InngestModule } from './inngest/inngest.module';
import { AuthModule } from './auth/auth.module';
import { GoogleModule } from './google/google.module';
import { GraphModule } from './graph/graph.module';
import { SyncModule } from './sync/sync.module';
import { LinkedinModule } from './linkedin/linkedin.module';
import { PipelineModule } from './pipeline/pipeline.module';
import { ContactsModule } from './contacts/contacts.module';
import { NetworkModule } from './network/network.module';
import { EnrichmentModule } from './enrichment/enrichment.module';
import { SearchModule } from './search/search.module';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { MetricsInterceptor } from './common/interceptors/metrics.interceptor';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { AppController } from './app.controller';

@Module({
  imports: [
    SentryModule.forRoot(),
    ConfigModule,
    ObservabilityModule,
    DatabaseModule,
    HealthModule,
    AiModule,
    InngestModule,
    AuthModule,
    GoogleModule,
    GraphModule,
    SyncModule,
    LinkedinModule,
    PipelineModule,
    ContactsModule,
    NetworkModule,
    EnrichmentModule,
    SearchModule,
  ],
  controllers: [AppController],
  providers: [
    {
      provide: APP_FILTER,
      useClass: SentryGlobalFilter,
    },
    {
      provide: APP_FILTER,
      useClass: HttpExceptionFilter,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: MetricsInterceptor,
    },
  ],
})
export class AppModule { }
