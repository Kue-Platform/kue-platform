import { inngest } from '../inngest.client';
import { getAppInstance } from '../inngest-app.context';
import { SyncService } from '../../sync/sync.service';

/**
 * Sync email contacts from Gmail
 * Triggered by: kue/email.sync.requested
 *
 * Delegates to SyncService which orchestrates the full pipeline:
 * 1. Authenticate with Google OAuth
 * 2. Fetch Gmail messages and extract contacts
 * 3. Ingest contacts into Neo4j graph
 * 4. Update sync job status in Supabase
 */
export const syncEmailFunction = inngest.createFunction(
  {
    id: 'sync-email-contacts',
    name: 'Sync Email Contacts',
    retries: 3,
    concurrency: {
      limit: 3, // Limit concurrent Gmail syncs
    },
  },
  { event: 'kue/email.sync.requested' },
  async ({ event, step }) => {
    const { userId, jobId, isIncremental } = event.data as {
      userId: string;
      jobId: string;
      isIncremental?: boolean;
    };

    const result = await step.run('execute-gmail-sync', async () => {
      const app = getAppInstance();
      const syncService = app.get(SyncService);

      return syncService.executeGmailSync(userId, jobId, {
        isIncremental: isIncremental || false,
      });
    });

    return result;
  },
);
