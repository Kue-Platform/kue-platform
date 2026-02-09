import { Injectable } from '@nestjs/common';
import { AuthService } from '../auth/auth.service';
import { GmailService, GmailSyncResult } from '../google/gmail.service';
import { ContactsService, ContactsSyncResult } from '../google/contacts.service';
import { CalendarService, CalendarSyncResult } from '../google/calendar.service';
import { GraphService } from '../graph/graph.service';
import { SupabaseService } from '../database/supabase.service';
import { LoggerService } from '../observability/logger.service';
import { PosthogService } from '../observability/posthog.service';
import { SentryService } from '../observability/sentry.service';
import { MetricsService } from '../observability/metrics.service';
import { PostHogEvents } from '../common/types/events';
import { Contact } from '../common/types';

export type SyncSource = 'gmail' | 'google_contacts' | 'calendar';

export interface SyncJobResult {
  jobId: string;
  source: SyncSource;
  contactsFound: number;
  newPersons: number;
  updatedPersons: number;
  durationMs: number;
  status: 'completed' | 'failed';
  error?: string;
}

@Injectable()
export class SyncService {
  constructor(
    private readonly auth: AuthService,
    private readonly gmail: GmailService,
    private readonly contacts: ContactsService,
    private readonly calendar: CalendarService,
    private readonly graph: GraphService,
    private readonly supabase: SupabaseService,
    private readonly logger: LoggerService,
    private readonly posthog: PosthogService,
    private readonly sentry: SentryService,
    private readonly metrics: MetricsService,
  ) {}

  /**
   * Execute a Gmail sync for a user
   * Called by the Inngest function or directly
   */
  async executeGmailSync(
    userId: string,
    jobId: string,
    options: { isIncremental?: boolean; maxResults?: number } = {},
  ): Promise<SyncJobResult> {
    const startTime = Date.now();
    const { isIncremental = false, maxResults = 500 } = options;

    try {
      // Update job status to running
      await this.updateJobStatus(jobId, 'running', 0);

      this.posthog.capture(userId, PostHogEvents.SYNC_STARTED, {
        source: 'gmail',
        isIncremental,
      });

      // Get authenticated Google client
      const authClient = await this.auth.getAuthenticatedClient(userId);

      // Get user's email for filtering
      const { data: profile } = await this.supabase.getClient()
        .from('profiles')
        .select('email')
        .eq('id', userId)
        .single();

      const userEmail = profile?.email;

      // Fetch previous historyId for incremental sync
      let historyId: string | undefined;
      if (isIncremental) {
        const { data: account } = await this.supabase.getClient()
          .from('connected_accounts')
          .select('metadata')
          .eq('user_id', userId)
          .eq('provider', 'google')
          .single();
        historyId = account?.metadata?.gmail_history_id as string | undefined;
      }

      // Step 1: Fetch messages and extract contacts
      await this.updateJobStatus(jobId, 'running', 20);
      const gmailResult: GmailSyncResult = await this.gmail.fetchAndExtractContacts(
        authClient,
        { maxResults, historyId, userEmail },
      );

      this.logger.info('Gmail contacts extracted', {
        userId,
        contactsFound: gmailResult.contacts.length,
        messagesProcessed: gmailResult.messagesProcessed,
      });

      // Step 2: Ingest contacts into Neo4j graph
      await this.updateJobStatus(jobId, 'running', 50);
      const ingestResult = await this.graph.batchIngestContacts(
        gmailResult.contacts,
        userId,
        userEmail || '',
      );

      // Step 3: Store latest historyId for future incremental syncs
      if (gmailResult.historyId) {
        await this.supabase.getClient()
          .from('connected_accounts')
          .update({
            metadata: {
              gmail_history_id: gmailResult.historyId,
              last_gmail_sync: new Date().toISOString(),
            },
          })
          .eq('user_id', userId)
          .eq('provider', 'google');
      }

      const duration = Date.now() - startTime;

      // Step 4: Update job status to completed
      await this.updateJobStatus(jobId, 'completed', 100, {
        total_items: gmailResult.messagesProcessed,
        processed_items: gmailResult.contacts.length,
      });

      this.posthog.capture(userId, PostHogEvents.SYNC_COMPLETED, {
        source: 'gmail',
        contactsFound: gmailResult.contacts.length,
        durationMs: duration,
      });

      this.metrics.recordJobDuration('gmail_sync', duration);

      return {
        jobId,
        source: 'gmail',
        contactsFound: gmailResult.contacts.length,
        newPersons: ingestResult.newPersons,
        updatedPersons: ingestResult.updatedPersons,
        durationMs: duration,
        status: 'completed',
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      await this.updateJobStatus(jobId, 'failed', 0, {
        error_message: errorMessage,
      });

      this.posthog.capture(userId, PostHogEvents.SYNC_FAILED, {
        source: 'gmail',
        error: errorMessage,
      });

      this.metrics.recordJobFailure('gmail_sync');
      this.sentry.captureException(error as Error, { userId, jobId, source: 'gmail' });

      return {
        jobId,
        source: 'gmail',
        contactsFound: 0,
        newPersons: 0,
        updatedPersons: 0,
        durationMs: duration,
        status: 'failed',
        error: errorMessage,
      };
    }
  }

  /**
   * Execute a Google Contacts sync
   */
  async executeContactsSync(
    userId: string,
    jobId: string,
    options: { isIncremental?: boolean } = {},
  ): Promise<SyncJobResult> {
    const startTime = Date.now();
    const { isIncremental = false } = options;

    try {
      await this.updateJobStatus(jobId, 'running', 0);

      this.posthog.capture(userId, PostHogEvents.SYNC_STARTED, {
        source: 'google_contacts',
        isIncremental,
      });

      const authClient = await this.auth.getAuthenticatedClient(userId);

      const { data: profile } = await this.supabase.getClient()
        .from('profiles')
        .select('email')
        .eq('id', userId)
        .single();

      // Get syncToken for incremental sync
      let syncToken: string | undefined;
      if (isIncremental) {
        const { data: account } = await this.supabase.getClient()
          .from('connected_accounts')
          .select('metadata')
          .eq('user_id', userId)
          .eq('provider', 'google')
          .single();
        syncToken = account?.metadata?.contacts_sync_token as string | undefined;
      }

      await this.updateJobStatus(jobId, 'running', 30);
      const contactsResult: ContactsSyncResult = await this.contacts.fetchContacts(
        authClient,
        { syncToken },
      );

      await this.updateJobStatus(jobId, 'running', 60);
      const ingestResult = await this.graph.batchIngestContacts(
        contactsResult.contacts,
        userId,
        profile?.email || '',
      );

      // Store syncToken
      if (contactsResult.syncToken) {
        await this.supabase.getClient()
          .from('connected_accounts')
          .update({
            metadata: {
              contacts_sync_token: contactsResult.syncToken,
              last_contacts_sync: new Date().toISOString(),
            },
          })
          .eq('user_id', userId)
          .eq('provider', 'google');
      }

      const duration = Date.now() - startTime;

      await this.updateJobStatus(jobId, 'completed', 100, {
        total_items: contactsResult.totalSynced,
        processed_items: contactsResult.contacts.length,
      });

      this.posthog.capture(userId, PostHogEvents.SYNC_COMPLETED, {
        source: 'google_contacts',
        contactsFound: contactsResult.contacts.length,
        durationMs: duration,
      });

      this.metrics.recordJobDuration('contacts_sync', duration);

      return {
        jobId,
        source: 'google_contacts',
        contactsFound: contactsResult.contacts.length,
        newPersons: ingestResult.newPersons,
        updatedPersons: ingestResult.updatedPersons,
        durationMs: duration,
        status: 'completed',
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      await this.updateJobStatus(jobId, 'failed', 0, { error_message: errorMessage });
      this.posthog.capture(userId, PostHogEvents.SYNC_FAILED, { source: 'google_contacts', error: errorMessage });
      this.metrics.recordJobFailure('contacts_sync');
      this.sentry.captureException(error as Error, { userId, jobId, source: 'google_contacts' });

      return {
        jobId,
        source: 'google_contacts',
        contactsFound: 0,
        newPersons: 0,
        updatedPersons: 0,
        durationMs: duration,
        status: 'failed',
        error: errorMessage,
      };
    }
  }

  /**
   * Execute a Calendar sync
   */
  async executeCalendarSync(
    userId: string,
    jobId: string,
    options: { isIncremental?: boolean } = {},
  ): Promise<SyncJobResult> {
    const startTime = Date.now();
    const { isIncremental = false } = options;

    try {
      await this.updateJobStatus(jobId, 'running', 0);

      this.posthog.capture(userId, PostHogEvents.SYNC_STARTED, {
        source: 'calendar',
        isIncremental,
      });

      const authClient = await this.auth.getAuthenticatedClient(userId);

      const { data: profile } = await this.supabase.getClient()
        .from('profiles')
        .select('email')
        .eq('id', userId)
        .single();

      let syncToken: string | undefined;
      if (isIncremental) {
        const { data: account } = await this.supabase.getClient()
          .from('connected_accounts')
          .select('metadata')
          .eq('user_id', userId)
          .eq('provider', 'google')
          .single();
        syncToken = account?.metadata?.calendar_sync_token as string | undefined;
      }

      await this.updateJobStatus(jobId, 'running', 30);
      const calendarResult: CalendarSyncResult = await this.calendar.fetchAndExtractAttendees(
        authClient,
        { syncToken, userEmail: profile?.email },
      );

      await this.updateJobStatus(jobId, 'running', 60);
      const ingestResult = await this.graph.batchIngestContacts(
        calendarResult.contacts,
        userId,
        profile?.email || '',
      );

      if (calendarResult.syncToken) {
        await this.supabase.getClient()
          .from('connected_accounts')
          .update({
            metadata: {
              calendar_sync_token: calendarResult.syncToken,
              last_calendar_sync: new Date().toISOString(),
            },
          })
          .eq('user_id', userId)
          .eq('provider', 'google');
      }

      const duration = Date.now() - startTime;

      await this.updateJobStatus(jobId, 'completed', 100, {
        total_items: calendarResult.eventsProcessed,
        processed_items: calendarResult.contacts.length,
      });

      this.posthog.capture(userId, PostHogEvents.SYNC_COMPLETED, {
        source: 'calendar',
        contactsFound: calendarResult.contacts.length,
        durationMs: duration,
      });

      this.metrics.recordJobDuration('calendar_sync', duration);

      return {
        jobId,
        source: 'calendar',
        contactsFound: calendarResult.contacts.length,
        newPersons: ingestResult.newPersons,
        updatedPersons: ingestResult.updatedPersons,
        durationMs: duration,
        status: 'completed',
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      await this.updateJobStatus(jobId, 'failed', 0, { error_message: errorMessage });
      this.posthog.capture(userId, PostHogEvents.SYNC_FAILED, { source: 'calendar', error: errorMessage });
      this.metrics.recordJobFailure('calendar_sync');
      this.sentry.captureException(error as Error, { userId, jobId, source: 'calendar' });

      return {
        jobId,
        source: 'calendar',
        contactsFound: 0,
        newPersons: 0,
        updatedPersons: 0,
        durationMs: duration,
        status: 'failed',
        error: errorMessage,
      };
    }
  }

  /**
   * Create a sync job record in Supabase and return the job ID
   */
  async createSyncJob(
    userId: string,
    jobType: string,
  ): Promise<string> {
    const { data, error } = await this.supabase.getClient()
      .from('sync_jobs')
      .insert({
        user_id: userId,
        job_type: jobType,
        status: 'pending',
        progress: 0,
      })
      .select('id')
      .single();

    if (error || !data) {
      throw new Error(`Failed to create sync job: ${error?.message}`);
    }

    return data.id;
  }

  /**
   * Update a sync job's status and progress
   */
  private async updateJobStatus(
    jobId: string,
    status: string,
    progress: number,
    extra?: Record<string, unknown>,
  ): Promise<void> {
    const update: Record<string, unknown> = { status, progress };

    if (status === 'running' && progress === 0) {
      update.started_at = new Date().toISOString();
    }
    if (status === 'completed' || status === 'failed') {
      update.completed_at = new Date().toISOString();
    }
    if (extra) {
      Object.assign(update, extra);
    }

    await this.supabase.getClient()
      .from('sync_jobs')
      .update(update)
      .eq('id', jobId);
  }
}
