import { Controller, All, Req, Res } from '@nestjs/common';
import { serve } from 'inngest/fastify';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ApiTags, ApiExcludeEndpoint } from '@nestjs/swagger';
import { inngest } from './inngest.client';
import { Public } from '../common/decorators/public.decorator';
import { syncEmailFunction } from './functions/sync-email.function';
import { syncContactsFunction } from './functions/sync-contacts.function';
import { syncCalendarFunction } from './functions/sync-calendar.function';
import { enrichContactFunction } from './functions/enrich-contact.function';
import { linkedinImportFunction } from './functions/linkedin-import.function';
import { maintenanceFunction } from './functions/maintenance.function';

// Create the Inngest serve handler for Fastify
const handler = serve({
  client: inngest,
  functions: [
    syncEmailFunction,
    syncContactsFunction,
    syncCalendarFunction,
    enrichContactFunction,
    linkedinImportFunction,
    maintenanceFunction,
  ],
});

@ApiTags('Inngest')
@Controller('api/inngest')
export class InngestController {
  @All()
  @Public()
  @ApiExcludeEndpoint()
  async handleInngest(
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    // Delegate to Inngest's Fastify handler
    // The serve handler from inngest/fastify expects raw Fastify request/reply
    const inngestHandler = handler as any;

    try {
      await inngestHandler(request, reply);
    } catch (error) {
      reply.status(500).send({
        error: 'Inngest handler error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
