import { Injectable } from '@nestjs/common';
import { GraphService } from '../graph/graph.service';
import { CsvParserService } from '../linkedin/csv-parser.service';
import { DedupService } from '../pipeline/dedup.service';
import { InngestService } from '../inngest/inngest.service';
import { SupabaseService } from '../database/supabase.service';
import { LoggerService } from '../observability/logger.service';
import { PosthogService } from '../observability/posthog.service';
import { SentryService } from '../observability/sentry.service';
import { PostHogEvents } from '../common/types/events';

export interface ImportCsvResult {
  jobId: string;
  totalRows: number;
  contactsFound: number;
  status: 'queued' | 'completed';
}

@Injectable()
export class ContactsService {
  constructor(
    private readonly graph: GraphService,
    private readonly csvParser: CsvParserService,
    private readonly dedup: DedupService,
    private readonly inngest: InngestService,
    private readonly supabase: SupabaseService,
    private readonly logger: LoggerService,
    private readonly posthog: PosthogService,
    private readonly sentry: SentryService,
  ) {}

  /**
   * Get paginated contacts for a user
   */
  async getContacts(
    userId: string,
    options: {
      page?: number;
      limit?: number;
      sortBy?: string;
      search?: string;
    } = {},
  ) {
    const { page = 1, limit = 50, sortBy = 'name', search } = options;
    const skip = (page - 1) * limit;

    const [contacts, totalCount] = await Promise.all([
      this.graph.getContacts(userId, { skip, limit, sortBy }),
      this.graph.getContactCount(userId),
    ]);

    return {
      contacts,
      pagination: {
        page,
        limit,
        total: totalCount,
        totalPages: Math.ceil(totalCount / limit),
      },
    };
  }

  /**
   * Import a LinkedIn CSV — queue for async processing via Inngest
   */
  async importLinkedInCsv(
    userId: string,
    userEmail: string,
    csvBuffer: Buffer,
  ): Promise<ImportCsvResult> {
    // Quick validation: parse to check format is valid
    const quickParse = this.csvParser.parseLinkedInCSV(csvBuffer);

    if (quickParse.totalRows === 0) {
      throw new Error('CSV file is empty or could not be parsed');
    }

    this.logger.info('LinkedIn CSV validated', {
      userId,
      totalRows: quickParse.totalRows,
      contactsFound: quickParse.contacts.length,
    });

    // For small CSVs (< 100 rows), process synchronously
    if (quickParse.totalRows < 100) {
      return this.processImportSync(userId, userEmail, quickParse);
    }

    // For larger CSVs, queue via Inngest
    return this.processImportAsync(userId, userEmail, csvBuffer);
  }

  /**
   * Synchronous import for small CSVs
   */
  private async processImportSync(
    userId: string,
    userEmail: string,
    parseResult: ReturnType<CsvParserService['parseLinkedInCSV']>,
  ): Promise<ImportCsvResult> {
    const jobId = await this.createImportJob(userId);

    try {
      // Dedup contacts
      const deduped = await this.dedup.deduplicateContacts(
        parseResult.contacts,
        userId,
      );

      // Ingest into graph
      const ingestResult = await this.graph.batchIngestContacts(
        deduped,
        userId,
        userEmail,
      );

      // Update job
      await this.supabase.getClient()
        .from('sync_jobs')
        .update({
          status: 'completed',
          progress: 100,
          total_items: parseResult.totalRows,
          processed_items: deduped.length,
          completed_at: new Date().toISOString(),
        })
        .eq('id', jobId);

      this.posthog.capture(userId, PostHogEvents.CSV_IMPORTED, {
        contactCount: deduped.length,
      });

      this.logger.info('LinkedIn CSV import complete (sync)', {
        userId,
        jobId,
        totalRows: parseResult.totalRows,
        imported: deduped.length,
        newPersons: ingestResult.newPersons,
      });

      return {
        jobId,
        totalRows: parseResult.totalRows,
        contactsFound: deduped.length,
        status: 'completed',
      };
    } catch (error) {
      await this.supabase.getClient()
        .from('sync_jobs')
        .update({
          status: 'failed',
          error_message: error instanceof Error ? error.message : String(error),
          completed_at: new Date().toISOString(),
        })
        .eq('id', jobId);

      this.sentry.captureException(error as Error, { userId, jobId });
      throw error;
    }
  }

  /**
   * Async import for larger CSVs — queue via Inngest
   */
  private async processImportAsync(
    userId: string,
    userEmail: string,
    csvBuffer: Buffer,
  ): Promise<ImportCsvResult> {
    const jobId = await this.createImportJob(userId);

    // Encode CSV as base64 to pass via Inngest event
    const csvBase64 = csvBuffer.toString('base64');

    await this.inngest.sendEvent('kue/linkedin.import.requested', {
      userId,
      jobId,
      csvBase64,
      userEmail,
    });

    this.logger.info('LinkedIn CSV import queued (async)', {
      userId,
      jobId,
      csvSizeBytes: csvBuffer.length,
    });

    return {
      jobId,
      totalRows: 0, // Will be determined during processing
      contactsFound: 0,
      status: 'queued',
    };
  }

  /**
   * Create an import job record in Supabase
   */
  private async createImportJob(userId: string): Promise<string> {
    const { data, error } = await this.supabase.getClient()
      .from('sync_jobs')
      .insert({
        user_id: userId,
        job_type: 'csv_import',
        status: 'pending',
        progress: 0,
      })
      .select('id')
      .single();

    if (error || !data) {
      throw new Error(`Failed to create import job: ${error?.message}`);
    }

    return data.id;
  }
}
