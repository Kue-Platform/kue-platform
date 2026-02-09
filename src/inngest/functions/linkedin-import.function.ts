import { inngest } from '../inngest.client';
import { getAppInstance } from '../inngest-app.context';
import { CsvParserService } from '../../linkedin/csv-parser.service';
import { GraphService } from '../../graph/graph.service';
import { DedupService } from '../../pipeline/dedup.service';
import { SupabaseService } from '../../database/supabase.service';
import { PosthogService } from '../../observability/posthog.service';
import { LoggerService } from '../../observability/logger.service';
import { MetricsService } from '../../observability/metrics.service';
import { PostHogEvents } from '../../common/types/events';

/**
 * Process a LinkedIn CSV import
 * Triggered by: kue/linkedin.import.requested
 *
 * The CSV content is passed via the event data (base64 encoded).
 */
export const linkedinImportFunction = inngest.createFunction(
  {
    id: 'linkedin-csv-import',
    name: 'LinkedIn CSV Import',
    retries: 2,
  },
  { event: 'kue/linkedin.import.requested' },
  async ({ event, step }) => {
    const { userId, jobId, csvBase64, userEmail } = event.data as {
      userId: string;
      jobId: string;
      csvBase64: string;
      userEmail: string;
    };

    // Step 1: Parse CSV
    const parseResult = await step.run('parse-csv', async () => {
      const app = getAppInstance();
      const csvParser = app.get(CsvParserService);

      const csvBuffer = Buffer.from(csvBase64, 'base64');
      return csvParser.parseLinkedInCSV(csvBuffer);
    });

    // Step 2: Dedup against existing contacts
    const dedupedContacts = await step.run('dedup-contacts', async () => {
      const app = getAppInstance();
      const dedup = app.get(DedupService);

      return dedup.deduplicateContacts(parseResult.contacts, userId);
    });

    // Step 3: Ingest into graph
    const ingestResult = await step.run('ingest-to-graph', async () => {
      const app = getAppInstance();
      const graph = app.get(GraphService);

      return graph.batchIngestContacts(dedupedContacts, userId, userEmail);
    });

    // Step 4: Update job status and analytics
    await step.run('finalize', async () => {
      const app = getAppInstance();
      const supabase = app.get(SupabaseService);
      const posthog = app.get(PosthogService);
      const logger = app.get(LoggerService);
      const metrics = app.get(MetricsService);

      await supabase.getClient()
        .from('sync_jobs')
        .update({
          status: 'completed',
          progress: 100,
          total_items: parseResult.totalRows,
          processed_items: dedupedContacts.length,
          completed_at: new Date().toISOString(),
        })
        .eq('id', jobId);

      posthog.capture(userId, PostHogEvents.CSV_IMPORTED, {
        contactCount: dedupedContacts.length,
      });

      metrics.recordJobDuration('linkedin_import', 0); // Duration tracked by Inngest

      logger.info('LinkedIn import complete', {
        userId,
        jobId,
        totalRows: parseResult.totalRows,
        contactsImported: dedupedContacts.length,
        skipped: parseResult.skipped,
        newPersons: ingestResult.newPersons,
        updatedPersons: ingestResult.updatedPersons,
      });
    });

    return {
      userId,
      jobId,
      totalRows: parseResult.totalRows,
      contactsImported: dedupedContacts.length,
      skipped: parseResult.skipped,
      newPersons: ingestResult.newPersons,
      updatedPersons: ingestResult.updatedPersons,
      status: 'completed',
    };
  },
);
