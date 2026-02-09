import { inngest } from '../inngest.client';
import { getAppInstance } from '../inngest-app.context';
import { ScoringService } from '../../pipeline/scoring.service';
import { DedupService } from '../../pipeline/dedup.service';
import { LoggerService } from '../../observability/logger.service';
import { MetricsService } from '../../observability/metrics.service';
import { Neo4jService } from '../../database/neo4j.service';

/**
 * Daily maintenance cron job.
 * Runs at 3:00 AM UTC every day.
 *
 * Tasks:
 * 1. Recalculate all relationship scores
 * 2. Detect and merge duplicate contacts
 * 3. Identify stale contacts
 * 4. Log maintenance summary
 */
export const maintenanceFunction = inngest.createFunction(
  {
    id: 'daily-maintenance',
    name: 'Daily Maintenance',
    retries: 1,
    concurrency: {
      limit: 1, // Only one maintenance job at a time
    },
  },
  { cron: '0 3 * * *' }, // Every day at 3:00 AM UTC
  async ({ step }) => {
    const app = getAppInstance();
    const scoringService = app.get(ScoringService);
    const dedupService = app.get(DedupService);
    const neo4j = app.get(Neo4jService);
    const logger = app.get(LoggerService);
    const metrics = app.get(MetricsService);

    const startTime = Date.now();

    // Step 1: Get all active users
    const users = await step.run('fetch-active-users', async () => {
      const result = await neo4j.runQuery(
        `
        MATCH (u:KueUser)
        WHERE u.id IS NOT NULL
        RETURN u.id AS userId, u.email AS email
        `,
        {},
        'maintenance_fetch_users',
      );

      const userList = result.records.map((r) => ({
        id: r.get('userId') as string,
        email: r.get('email') as string,
      }));

      logger.info('[maintenance] Found active users', { count: userList.length });
      return userList;
    });

    // Step 2: Rescore all contacts for each user
    const scoringResults = await step.run('rescore-all-users', async () => {
      const results: { userId: string; scored: number; averageScore: number }[] = [];

      for (const user of users) {
        try {
          const result = await scoringService.scoreAllContacts(user.id);
          results.push({
            userId: user.id,
            scored: result.scored,
            averageScore: result.averageScore,
          });

          logger.info('[maintenance] Rescored user contacts', {
            userId: user.id,
            scored: result.scored,
            averageScore: result.averageScore,
          });
        } catch (error) {
          logger.error('[maintenance] Failed to rescore user', {
            userId: user.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      return results;
    });

    // Step 3: Run deduplication for each user
    const dedupResults = await step.run('dedup-all-users', async () => {
      const results: { userId: string; mergedCount: number }[] = [];

      for (const user of users) {
        try {
          const result = await dedupService.findAndMergeDuplicates(user.id);
          results.push({
            userId: user.id,
            mergedCount: result.mergedCount,
          });

          if (result.mergedCount > 0) {
            logger.info('[maintenance] Merged duplicates', {
              userId: user.id,
              mergedCount: result.mergedCount,
            });
          }
        } catch (error) {
          logger.error('[maintenance] Failed to dedup user', {
            userId: user.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      return results;
    });

    // Step 4: Identify stale contacts
    const staleResults = await step.run('find-stale-contacts', async () => {
      const results: { userId: string; staleCount: number }[] = [];

      for (const user of users) {
        try {
          const stale = await scoringService.findStaleContacts(user.id, {
            staleDays: 90,
            maxScore: 20,
            limit: 100,
          });

          results.push({
            userId: user.id,
            staleCount: stale.length,
          });

          if (stale.length > 0) {
            logger.info('[maintenance] Found stale contacts', {
              userId: user.id,
              staleCount: stale.length,
              examples: stale.slice(0, 3).map((s) => ({
                email: s.email,
                daysSince: s.daysSinceContact,
                score: s.score,
              })),
            });
          }
        } catch (error) {
          logger.error('[maintenance] Failed to find stale contacts', {
            userId: user.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      return results;
    });

    // Step 5: Record maintenance metrics
    await step.run('record-maintenance-metrics', async () => {
      const durationMs = Date.now() - startTime;

      const totalScored = scoringResults.reduce((sum, r) => sum + r.scored, 0);
      const totalMerged = dedupResults.reduce((sum, r) => sum + r.mergedCount, 0);
      const totalStale = staleResults.reduce((sum, r) => sum + r.staleCount, 0);

      metrics.recordJobDuration('daily-maintenance', durationMs);
      metrics.incrementCounter('maintenance.contacts_scored', {}, totalScored);
      metrics.incrementCounter('maintenance.duplicates_merged', {}, totalMerged);
      metrics.incrementCounter('maintenance.stale_contacts', {}, totalStale);

      logger.info('[maintenance] Daily maintenance complete', {
        durationMs,
        usersProcessed: users.length,
        totalScored,
        totalMerged,
        totalStale,
        scoringDetails: scoringResults,
        dedupDetails: dedupResults,
        staleDetails: staleResults,
      });
    });

    return {
      status: 'completed',
      usersProcessed: users.length,
      totalScored: scoringResults.reduce((sum, r) => sum + r.scored, 0),
      totalMerged: dedupResults.reduce((sum, r) => sum + r.mergedCount, 0),
      totalStale: staleResults.reduce((sum, r) => sum + r.staleCount, 0),
      durationMs: Date.now() - startTime,
    };
  },
);
