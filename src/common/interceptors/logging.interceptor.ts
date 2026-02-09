import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { FastifyRequest } from 'fastify';
import { LoggerService } from '../../observability/logger.service';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  constructor(private readonly logger: LoggerService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const { method, url } = request;
    const userAgent = request.headers['user-agent'] || 'unknown';
    const startTime = Date.now();

    this.logger.info(`Incoming request`, {
      method,
      url,
      userAgent,
    });

    return next.handle().pipe(
      tap({
        next: () => {
          const duration = Date.now() - startTime;
          this.logger.info(`Request completed`, {
            method,
            url,
            duration,
            statusCode: context.switchToHttp().getResponse().statusCode,
          });
        },
        error: (error: Error) => {
          const duration = Date.now() - startTime;
          this.logger.error(`Request failed`, {
            method,
            url,
            duration,
            error: error.message,
          });
        },
      }),
    );
  }
}
