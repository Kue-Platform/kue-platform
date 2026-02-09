import { inngest } from '../inngest.client';
import { getAppInstance } from '../inngest-app.context';
import { SyncService } from '../../sync/sync.service';

/**
 * Sync contacts from Google Contacts (People API)
 * Triggered by: kue/contacts.sync.requested
 */
export const syncContactsFunction = inngest.createFunction(
  {
    id: 'sync-google-contacts',
    name: 'Sync Google Contacts',
    retries: 3,
    concurrency: {
      limit: 3,
    },
  },
  { event: 'kue/contacts.sync.requested' },
  async ({ event, step }) => {
    const { userId, jobId, isIncremental } = event.data as {
      userId: string;
      jobId: string;
      isIncremental?: boolean;
    };

    const result = await step.run('execute-contacts-sync', async () => {
      const app = getAppInstance();
      const syncService = app.get(SyncService);

      return syncService.executeContactsSync(userId, jobId, {
        isIncremental: isIncremental || false,
      });
    });

    return result;
  },
);
