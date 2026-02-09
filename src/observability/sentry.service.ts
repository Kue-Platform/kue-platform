import { Injectable } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';

@Injectable()
export class SentryService {
  captureException(error: unknown, context?: Record<string, unknown>): void {
    Sentry.withScope((scope) => {
      if (context) {
        scope.setExtras(context);
      }
      Sentry.captureException(error);
    });
  }

  captureMessage(message: string, level: Sentry.SeverityLevel = 'info'): void {
    Sentry.captureMessage(message, level);
  }

  setUser(user: { id: string; email?: string }): void {
    Sentry.setUser(user);
  }

  startSpan<T>(
    name: string,
    op: string,
    fn: () => T | Promise<T>,
  ): T | Promise<T> {
    return Sentry.startSpan({ name, op }, fn);
  }
}
