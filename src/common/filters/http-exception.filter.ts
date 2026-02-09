import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { SentryService } from '../../observability/sentry.service';
import { LoggerService } from '../../observability/logger.service';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  constructor(
    private readonly sentry: SentryService,
    private readonly logger: LoggerService,
  ) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const message =
      exception instanceof HttpException
        ? exception.getResponse()
        : 'Internal server error';

    const errorResponse = {
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      method: request.method,
      message:
        typeof message === 'string'
          ? message
          : (message as Record<string, unknown>).message || message,
    };

    // Log all errors
    this.logger.error(`HTTP Exception: ${status} ${request.method} ${request.url}`, {
      status,
      method: request.method,
      url: request.url,
      error: exception instanceof Error ? exception.message : String(exception),
      stack: exception instanceof Error ? exception.stack : undefined,
    });

    // Report non-4xx errors to Sentry
    if (status >= 500 && exception instanceof Error) {
      this.sentry.captureException(exception, {
        url: request.url,
        method: request.method,
        statusCode: status,
      });
    }

    response.status(status).send(errorResponse);
  }
}
