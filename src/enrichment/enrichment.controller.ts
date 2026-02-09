import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  UseGuards,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
  ApiQuery,
  ApiBody,
} from '@nestjs/swagger';
import { AuthGuard } from '../common/guards/auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { EnrichmentService } from './enrichment.service';

@ApiTags('Enrichment')
@Controller('enrichment')
@UseGuards(AuthGuard)
@ApiBearerAuth()
export class EnrichmentController {
  constructor(private readonly enrichment: EnrichmentService) {}

  @Post()
  @ApiOperation({ summary: 'Trigger enrichment for a specific contact' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        personId: { type: 'string', description: 'Person ID to enrich' },
      },
      required: ['personId'],
    },
  })
  @ApiResponse({ status: 200, description: 'Enrichment queued' })
  @ApiResponse({ status: 400, description: 'Missing person ID' })
  async triggerEnrichment(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { personId: string },
  ) {
    if (!body.personId) {
      throw new BadRequestException('personId is required');
    }

    const result = await this.enrichment.triggerEnrichment(user.id, body.personId);

    return {
      statusCode: HttpStatus.OK,
      message: 'Enrichment queued',
      data: result,
    };
  }

  @Post('batch')
  @ApiOperation({ summary: 'Trigger enrichment for multiple un-enriched contacts' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max contacts to enrich (default: 50)' },
        forceRefresh: { type: 'boolean', description: 'Re-enrich already enriched contacts' },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Batch enrichment queued' })
  async triggerBatchEnrichment(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { limit?: number; forceRefresh?: boolean },
  ) {
    const result = await this.enrichment.triggerBatchEnrichment(user.id, {
      limit: body.limit,
      forceRefresh: body.forceRefresh,
    });

    return {
      statusCode: HttpStatus.OK,
      message: `${result.queued} contacts queued for enrichment`,
      data: result,
    };
  }

  @Get('status')
  @ApiOperation({ summary: 'Get enrichment progress for your contacts' })
  @ApiResponse({ status: 200, description: 'Enrichment status' })
  async getEnrichmentStatus(@CurrentUser() user: AuthenticatedUser) {
    const status = await this.enrichment.getEnrichmentStatus(user.id);

    return {
      statusCode: HttpStatus.OK,
      data: status,
    };
  }
}
