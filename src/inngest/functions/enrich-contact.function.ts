import { inngest } from '../inngest.client';
import { getAppInstance } from '../inngest-app.context';
import { EnrichmentService } from '../../enrichment/enrichment.service';
import { ScoringService } from '../../pipeline/scoring.service';
import { LoggerService } from '../../observability/logger.service';
import { MetricsService } from '../../observability/metrics.service';

/**
 * Enrich a contact with additional data from external APIs.
 * Triggered by: kue/contact.enrich.requested
 *
 * Steps:
 * 1. Fetch enrichment data (external API or fallback)
 * 2. Update Person node in Neo4j with enriched data
 * 3. Recalculate relationship score
 */
export const enrichContactFunction = inngest.createFunction(
  {
    id: 'enrich-contact',
    name: 'Enrich Contact',
    retries: 2,
    concurrency: {
      limit: 5, // Rate limit enrichment to avoid API throttling
    },
  },
  { event: 'kue/contact.enrich.requested' },
  async ({ event, step }) => {
    const { personId, userId } = event.data as {
      personId: string;
      userId: string;
    };

    const app = getAppInstance();
    const enrichmentService = app.get(EnrichmentService);
    const scoringService = app.get(ScoringService);
    const logger = app.get(LoggerService);
    const metrics = app.get(MetricsService);

    const startTime = Date.now();

    // Step 1: Execute enrichment (fetch external data + update Neo4j)
    const enrichmentResult = await step.run('execute-enrichment', async () => {
      logger.info('[enrich] Starting enrichment', { personId, userId });

      const result = await enrichmentService.executeEnrichment(userId, personId);

      logger.info('[enrich] Enrichment complete', {
        personId,
        enriched: result.enriched,
        fieldsUpdated: result.fieldsUpdated,
      });

      return {
        enriched: result.enriched,
        email: result.email,
        fieldsUpdated: result.fieldsUpdated,
        source: result.source,
      };
    });

    // Step 2: Recalculate relationship score if enrichment added data
    const scoreResult = await step.run('recalculate-score', async () => {
      if (!enrichmentResult.email) {
        logger.warn('[enrich] No email found, skipping score recalculation', { personId });
        return { recalculated: false, score: 0, breakdown: null };
      }

      const score = await scoringService.scoreContact(userId, enrichmentResult.email);

      logger.info('[enrich] Score recalculated', {
        personId,
        email: enrichmentResult.email,
        newScore: score?.score,
      });

      return {
        recalculated: true,
        score: score?.score || 0,
        breakdown: score?.breakdown || null,
      };
    });

    // Step 3: Record metrics
    await step.run('record-metrics', async () => {
      const durationMs = Date.now() - startTime;
      metrics.recordJobDuration('enrich-contact', durationMs);

      logger.info('[enrich] Job complete', {
        personId,
        userId,
        enriched: enrichmentResult.enriched,
        fieldsUpdated: enrichmentResult.fieldsUpdated,
        scoreRecalculated: scoreResult.recalculated,
        newScore: scoreResult.score,
        durationMs,
      });
    });

    return {
      personId,
      userId,
      status: 'completed',
      enriched: enrichmentResult.enriched,
      fieldsUpdated: enrichmentResult.fieldsUpdated,
      newScore: scoreResult.score,
    };
  },
);
