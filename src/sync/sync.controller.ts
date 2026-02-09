import {
  Controller,
  Post,
  Get,
  Query,
  UseGuards,
  HttpStatus,
  HttpCode,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
  ApiResponse,
} from '@nestjs/swagger';
import { AuthGuard } from '../common/guards/auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { SyncService } from './sync.service';
import { InngestService } from '../inngest/inngest.service';
import { LoggerService } from '../observability/logger.service';
import { SupabaseService } from '../database/supabase.service';

@ApiTags('Sync')
@Controller('sync')
@UseGuards(AuthGuard)
@ApiBearerAuth()
export class SyncController {
  constructor(
    private readonly sync: SyncService,
    private readonly inngest: InngestService,
    private readonly logger: LoggerService,
    private readonly supabase: SupabaseService,
  ) {}

  @Post('gmail')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Trigger Gmail contacts sync' })
  @ApiQuery({ name: 'incremental', required: false, type: Boolean, description: 'Use incremental sync (default: false)' })
  @ApiResponse({ status: 202, description: 'Sync job queued' })
  async triggerGmailSync(
    @CurrentUser() user: AuthenticatedUser,
    @Query('incremental') incremental?: string,
  ) {
    const isIncremental = incremental === 'true';
    const jobId = await this.sync.createSyncJob(user.id, 'gmail_contacts');

    // Send event to Inngest to process async
    await this.inngest.sendEvent('kue/email.sync.requested', {
      userId: user.id,
      jobId,
      isIncremental,
    });

    this.logger.info('Gmail sync triggered', {
      userId: user.id,
      jobId,
      isIncremental,
    });

    return {
      statusCode: HttpStatus.ACCEPTED,
      message: 'Gmail sync queued',
      data: { jobId, isIncremental },
    };
  }

  @Post('contacts')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Trigger Google Contacts sync' })
  @ApiQuery({ name: 'incremental', required: false, type: Boolean })
  @ApiResponse({ status: 202, description: 'Sync job queued' })
  async triggerContactsSync(
    @CurrentUser() user: AuthenticatedUser,
    @Query('incremental') incremental?: string,
  ) {
    const isIncremental = incremental === 'true';
    const jobId = await this.sync.createSyncJob(user.id, 'google_contacts');

    await this.inngest.sendEvent('kue/contacts.sync.requested', {
      userId: user.id,
      jobId,
      isIncremental,
    });

    this.logger.info('Google Contacts sync triggered', {
      userId: user.id,
      jobId,
      isIncremental,
    });

    return {
      statusCode: HttpStatus.ACCEPTED,
      message: 'Google Contacts sync queued',
      data: { jobId, isIncremental },
    };
  }

  @Post('calendar')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Trigger Google Calendar sync' })
  @ApiQuery({ name: 'incremental', required: false, type: Boolean })
  @ApiResponse({ status: 202, description: 'Sync job queued' })
  async triggerCalendarSync(
    @CurrentUser() user: AuthenticatedUser,
    @Query('incremental') incremental?: string,
  ) {
    const isIncremental = incremental === 'true';
    const jobId = await this.sync.createSyncJob(user.id, 'google_calendar');

    await this.inngest.sendEvent('kue/calendar.sync.requested', {
      userId: user.id,
      jobId,
      isIncremental,
    });

    this.logger.info('Calendar sync triggered', {
      userId: user.id,
      jobId,
      isIncremental,
    });

    return {
      statusCode: HttpStatus.ACCEPTED,
      message: 'Calendar sync queued',
      data: { jobId, isIncremental },
    };
  }

  @Get('jobs')
  @ApiOperation({ summary: 'Get sync job history for the authenticated user' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'List of sync jobs' })
  async getSyncJobs(
    @CurrentUser() user: AuthenticatedUser,
    @Query('limit') limit?: string,
  ) {
    const { data, error } = await this.supabase.getClient()
      .from('sync_jobs')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(parseInt(limit || '20', 10));

    if (error) {
      this.logger.error('Failed to fetch sync jobs', { error: error.message });
      return { statusCode: HttpStatus.INTERNAL_SERVER_ERROR, message: 'Failed to fetch sync jobs' };
    }

    return {
      statusCode: HttpStatus.OK,
      data: data || [],
    };
  }

  @Get('jobs/status')
  @ApiOperation({ summary: 'Get status of a specific sync job' })
  @ApiQuery({ name: 'jobId', required: true, type: String })
  @ApiResponse({ status: 200, description: 'Sync job details' })
  async getSyncJobStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Query('jobId') jobId: string,
  ) {
    const { data, error } = await this.supabase.getClient()
      .from('sync_jobs')
      .select('*')
      .eq('id', jobId)
      .eq('user_id', user.id)
      .single();

    if (error || !data) {
      return { statusCode: HttpStatus.NOT_FOUND, message: 'Sync job not found' };
    }

    return {
      statusCode: HttpStatus.OK,
      data,
    };
  }
}
