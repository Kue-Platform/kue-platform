import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Logtail } from '@logtail/node';

@Injectable()
export class LoggerService implements OnModuleDestroy {
  private logtail: Logtail | null = null;

  constructor(private configService: ConfigService) {
    const token = this.configService.get<string>('LOGTAIL_SOURCE_TOKEN');
    if (token) {
      this.logtail = new Logtail(token);
    }
  }

  info(message: string, context?: Record<string, unknown>): void {
    if (this.logtail) {
      this.logtail.info(message, context);
    } else {
      console.log(JSON.stringify({ level: 'info', message, ...context }));
    }
  }

  warn(message: string, context?: Record<string, unknown>): void {
    if (this.logtail) {
      this.logtail.warn(message, context);
    } else {
      console.warn(JSON.stringify({ level: 'warn', message, ...context }));
    }
  }

  error(message: string, context?: Record<string, unknown>): void {
    if (this.logtail) {
      this.logtail.error(message, context);
    } else {
      console.error(JSON.stringify({ level: 'error', message, ...context }));
    }
  }

  debug(message: string, context?: Record<string, unknown>): void {
    if (this.logtail) {
      this.logtail.debug(message, context);
    } else {
      console.debug(JSON.stringify({ level: 'debug', message, ...context }));
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.logtail?.flush();
  }
}
