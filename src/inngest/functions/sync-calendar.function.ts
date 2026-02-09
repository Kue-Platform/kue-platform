import { inngest } from '../inngest.client';
import { getAppInstance } from '../inngest-app.context';
import { SyncService } from '../../sync/sync.service';

/**
 * Sync attendees from Google Calendar events
 * Triggered by: kue/calendar.sync.requested
 */
export const syncCalendarFunction = inngest.createFunction(
  {
    id: 'sync-google-calendar',
    name: 'Sync Google Calendar',
    retries: 3,
    concurrency: {
      limit: 3,
    },
  },
  { event: 'kue/calendar.sync.requested' },
  async ({ event, step }) => {
    const { userId, jobId, isIncremental } = event.data as {
      userId: string;
      jobId: string;
      isIncremental?: boolean;
    };

    const result = await step.run('execute-calendar-sync', async () => {
      const app = getAppInstance();
      const syncService = app.get(SyncService);

      return syncService.executeCalendarSync(userId, jobId, {
        isIncremental: isIncremental || false,
      });
    });

    return result;
  },
);
