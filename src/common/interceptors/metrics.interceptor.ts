import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { FastifyRequest } from 'fastify';
import { MetricsService } from '../../observability/metrics.service';

@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const startTime = Date.now();
    const route = request.routeOptions?.url || request.url;
    const method = request.method;

    return next.handle().pipe(
      tap({
        next: () => {
          const duration = Date.now() - startTime;
          const statusCode = context.switchToHttp().getResponse().statusCode;
          this.metrics.recordApiLatency(route, method, statusCode, duration);
        },
        error: () => {
          const duration = Date.now() - startTime;
          this.metrics.recordApiLatency(route, method, 500, duration);
        },
      }),
    );
  }
}
