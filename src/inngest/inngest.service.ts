import { Injectable } from '@nestjs/common';
import { inngest } from './inngest.client';
import { LoggerService } from '../observability/logger.service';

@Injectable()
export class InngestService {
  constructor(private readonly logger: LoggerService) {}

  /**
   * Send an event to trigger Inngest functions
   */
  async sendEvent(name: string, data: Record<string, unknown>) {
    try {
      await inngest.send({ name, data });
      this.logger.info(`Inngest event sent: ${name}`, { eventName: name });
    } catch (error) {
      this.logger.error(`Failed to send Inngest event: ${name}`, {
        eventName: name,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Send a batch of events
   */
  async sendEvents(
    events: Array<{ name: string; data: Record<string, unknown> }>,
  ) {
    try {
      await inngest.send(events);
      this.logger.info(`Inngest batch sent: ${events.length} events`, {
        count: events.length,
        eventNames: events.map((e) => e.name),
      });
    } catch (error) {
      this.logger.error(`Failed to send Inngest event batch`, {
        count: events.length,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
