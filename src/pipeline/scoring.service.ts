import { Injectable } from '@nestjs/common';
import { Neo4jService } from '../database/neo4j.service';
import { LoggerService } from '../observability/logger.service';
import { SentryService } from '../observability/sentry.service';
import { MetricsService } from '../observability/metrics.service';

/**
 * Composite scoring weights (must sum to 1.0):
 * - Recency:    0.30 — How recently you interacted
 * - Frequency:  0.30 — How often you interact
 * - Reciprocity: 0.20 — Two-way communication
 * - Diversity:  0.10 — Multiple channels (email, calendar, LinkedIn)
 * - Duration:   0.10 — Length of the relationship
 */
const WEIGHTS = {
  recency: 0.3,
  frequency: 0.3,
  reciprocity: 0.2,
  diversity: 0.1,
  duration: 0.1,
} as const;

/** Max days for recency normalization (365 days) */
const RECENCY_MAX_DAYS = 365;

/** Max interactions for frequency normalization */
const FREQUENCY_MAX = 100;

/** Max relationship age in days for duration normalization (5 years) */
const DURATION_MAX_DAYS = 1825;

export interface ScoreResult {
  personId: string;
  email: string;
  score: number;
  breakdown: {
    recency: number;
    frequency: number;
    reciprocity: number;
    diversity: number;
    duration: number;
  };
}

@Injectable()
export class ScoringService {
  constructor(
    private readonly neo4j: Neo4jService,
    private readonly logger: LoggerService,
    private readonly sentry: SentryService,
    private readonly metrics: MetricsService,
  ) {}

  /**
   * Calculate relationship strength scores for all contacts of a user.
   * Updates the KNOWS relationship `strength` property in Neo4j.
   */
  async scoreAllContacts(userId: string): Promise<{
    scored: number;
    averageScore: number;
    durationMs: number;
  }> {
    const startTime = Date.now();

    try {
      // Fetch all relationships with interaction data
      const result = await this.neo4j.runQuery(
        `
        MATCH (u:KueUser {id: $userId})-[r:KNOWS]->(p:Person {ownerId: $userId})
        RETURN
          p.id AS personId,
          p.email AS email,
          p.source AS sources,
          r.interactionCount AS interactionCount,
          r.lastContact AS lastContact,
          r.firstContact AS firstContact,
          r.emailsSent AS emailsSent,
          r.emailsReceived AS emailsReceived,
          r.meetingCount AS meetingCount,
          r.source AS relationshipSource
        `,
        { userId },
        'score_fetch_all',
      );

      if (result.records.length === 0) {
        this.logger.info('No contacts to score', { userId });
        return { scored: 0, averageScore: 0, durationMs: Date.now() - startTime };
      }

      const now = Date.now();
      let totalScore = 0;
      const batchSize = 50;
      const allScores: ScoreResult[] = [];

      for (const record of result.records) {
        const personId = record.get('personId') as string;
        const email = record.get('email') as string;
        const sources = record.get('sources') as string[] | null;
        const interactionCount = this.toNumber(record.get('interactionCount')) || 0;
        const lastContact = this.toDate(record.get('lastContact'));
        const firstContact = this.toDate(record.get('firstContact'));
        const emailsSent = this.toNumber(record.get('emailsSent')) || 0;
        const emailsReceived = this.toNumber(record.get('emailsReceived')) || 0;
        const meetingCount = this.toNumber(record.get('meetingCount')) || 0;

        const breakdown = this.calculateBreakdown({
          now,
          lastContact,
          firstContact,
          interactionCount,
          emailsSent,
          emailsReceived,
          meetingCount,
          sources: sources || [],
        });

        const score = this.computeCompositeScore(breakdown);

        allScores.push({ personId, email, score, breakdown });
        totalScore += score;
      }

      // Batch update scores in Neo4j
      for (let i = 0; i < allScores.length; i += batchSize) {
        const batch = allScores.slice(i, i + batchSize);
        await this.batchUpdateScores(userId, batch);
      }

      const durationMs = Date.now() - startTime;
      const averageScore = Math.round((totalScore / allScores.length) * 100) / 100;

      this.logger.info('Scoring complete', {
        userId,
        scored: allScores.length,
        averageScore,
        durationMs,
      });

      this.metrics.recordHistogram('scoring.duration_ms', durationMs, { userId });

      return { scored: allScores.length, averageScore, durationMs };
    } catch (error) {
      this.sentry.captureException(error as Error, {
        userId,
        context: 'score_all_contacts',
      });
      throw error;
    }
  }

  /**
   * Calculate score for a single contact
   */
  async scoreContact(userId: string, personEmail: string): Promise<ScoreResult | null> {
    const result = await this.neo4j.runQuery(
      `
      MATCH (u:KueUser {id: $userId})-[r:KNOWS]->(p:Person {email: $personEmail, ownerId: $userId})
      RETURN
        p.id AS personId,
        p.email AS email,
        p.source AS sources,
        r.interactionCount AS interactionCount,
        r.lastContact AS lastContact,
        r.firstContact AS firstContact,
        r.emailsSent AS emailsSent,
        r.emailsReceived AS emailsReceived,
        r.meetingCount AS meetingCount
      `,
      { userId, personEmail },
      'score_single',
    );

    if (result.records.length === 0) return null;

    const record = result.records[0];
    const now = Date.now();

    const breakdown = this.calculateBreakdown({
      now,
      lastContact: this.toDate(record.get('lastContact')),
      firstContact: this.toDate(record.get('firstContact')),
      interactionCount: this.toNumber(record.get('interactionCount')) || 0,
      emailsSent: this.toNumber(record.get('emailsSent')) || 0,
      emailsReceived: this.toNumber(record.get('emailsReceived')) || 0,
      meetingCount: this.toNumber(record.get('meetingCount')) || 0,
      sources: (record.get('sources') as string[] | null) || [],
    });

    const score = this.computeCompositeScore(breakdown);
    const scoreResult: ScoreResult = {
      personId: record.get('personId') as string,
      email: record.get('email') as string,
      score,
      breakdown,
    };

    // Update in Neo4j
    await this.neo4j.runQuery(
      `
      MATCH (u:KueUser {id: $userId})-[r:KNOWS]->(p:Person {email: $personEmail, ownerId: $userId})
      SET r.strength = $score,
          r.scoreBreakdown = $breakdownJson,
          r.scoredAt = datetime()
      `,
      {
        userId,
        personEmail,
        score,
        breakdownJson: JSON.stringify(breakdown),
      },
      'score_update_single',
    );

    return scoreResult;
  }

  /**
   * Calculate individual component scores
   */
  private calculateBreakdown(data: {
    now: number;
    lastContact: Date | null;
    firstContact: Date | null;
    interactionCount: number;
    emailsSent: number;
    emailsReceived: number;
    meetingCount: number;
    sources: string[];
  }): ScoreResult['breakdown'] {
    // Recency: exponential decay based on days since last contact
    let recency = 0;
    if (data.lastContact) {
      const daysSinceLast = (data.now - data.lastContact.getTime()) / (1000 * 60 * 60 * 24);
      recency = Math.max(0, 1 - daysSinceLast / RECENCY_MAX_DAYS);
      // Apply exponential decay for more sensitivity to recent interactions
      recency = Math.pow(recency, 0.5);
    }

    // Frequency: log-normalized interaction count (diminishing returns)
    const frequency = data.interactionCount > 0
      ? Math.min(1, Math.log(data.interactionCount + 1) / Math.log(FREQUENCY_MAX + 1))
      : 0;

    // Reciprocity: balance between sent and received (1.0 = perfect balance)
    let reciprocity = 0;
    const totalDirectional = data.emailsSent + data.emailsReceived;
    if (totalDirectional > 0) {
      const ratio = Math.min(data.emailsSent, data.emailsReceived) /
        Math.max(data.emailsSent, data.emailsReceived);
      // Boost if there are meetings too (signals strong reciprocal relationship)
      const meetingBoost = data.meetingCount > 0 ? 0.2 : 0;
      reciprocity = Math.min(1, ratio + meetingBoost);
    } else if (data.meetingCount > 0) {
      // Meetings imply reciprocity even without email data
      reciprocity = 0.5;
    }

    // Diversity: how many distinct channels/sources exist
    const uniqueSources = new Set(data.sources);
    // Possible sources: gmail, google_contacts, calendar, linkedin
    const maxSources = 4;
    const sourceScore = uniqueSources.size / maxSources;
    // Also factor in meeting + email diversity
    const channelTypes = [
      data.emailsSent > 0 || data.emailsReceived > 0,
      data.meetingCount > 0,
      uniqueSources.has('linkedin'),
      uniqueSources.has('google_contacts'),
    ].filter(Boolean).length;
    const diversity = Math.min(1, (sourceScore + channelTypes / 4) / 2);

    // Duration: length of relationship (capped at 5 years)
    let duration = 0;
    if (data.firstContact) {
      const daysKnown = (data.now - data.firstContact.getTime()) / (1000 * 60 * 60 * 24);
      duration = Math.min(1, daysKnown / DURATION_MAX_DAYS);
    }

    return {
      recency: Math.round(recency * 100) / 100,
      frequency: Math.round(frequency * 100) / 100,
      reciprocity: Math.round(reciprocity * 100) / 100,
      diversity: Math.round(diversity * 100) / 100,
      duration: Math.round(duration * 100) / 100,
    };
  }

  /**
   * Compute the composite weighted score from breakdown components
   */
  private computeCompositeScore(breakdown: ScoreResult['breakdown']): number {
    const score =
      breakdown.recency * WEIGHTS.recency +
      breakdown.frequency * WEIGHTS.frequency +
      breakdown.reciprocity * WEIGHTS.reciprocity +
      breakdown.diversity * WEIGHTS.diversity +
      breakdown.duration * WEIGHTS.duration;

    // Normalize to 0-100 scale
    return Math.round(score * 100 * 100) / 100;
  }

  /**
   * Batch update scores in Neo4j
   */
  private async batchUpdateScores(
    userId: string,
    scores: ScoreResult[],
  ): Promise<void> {
    const scoreData = scores.map((s) => ({
      personId: s.personId,
      score: s.score,
      breakdownJson: JSON.stringify(s.breakdown),
    }));

    await this.neo4j.runQuery(
      `
      UNWIND $scores AS s
      MATCH (u:KueUser {id: $userId})-[r:KNOWS]->(p:Person {id: s.personId, ownerId: $userId})
      SET r.strength = s.score,
          r.scoreBreakdown = s.breakdownJson,
          r.scoredAt = datetime()
      `,
      { userId, scores: scoreData },
      'score_batch_update',
    );
  }

  /**
   * Identify stale contacts (no interaction in 90+ days, low score)
   */
  async findStaleContacts(
    userId: string,
    options: { staleDays?: number; maxScore?: number; limit?: number } = {},
  ): Promise<{ personId: string; email: string; daysSinceContact: number; score: number }[]> {
    const { staleDays = 90, maxScore = 30, limit = 50 } = options;

    const result = await this.neo4j.runQuery(
      `
      MATCH (u:KueUser {id: $userId})-[r:KNOWS]->(p:Person {ownerId: $userId})
      WHERE r.lastContact IS NOT NULL
        AND duration.inDays(r.lastContact, datetime()).days > $staleDays
        AND r.strength <= $maxScore
      RETURN
        p.id AS personId,
        p.email AS email,
        p.name AS name,
        duration.inDays(r.lastContact, datetime()).days AS daysSinceContact,
        r.strength AS score
      ORDER BY r.strength ASC
      LIMIT $limit
      `,
      { userId, staleDays, maxScore, limit },
      'find_stale_contacts',
    );

    return result.records.map((r) => ({
      personId: r.get('personId') as string,
      email: r.get('email') as string,
      daysSinceContact: this.toNumber(r.get('daysSinceContact')) || 0,
      score: r.get('score') as number || 0,
    }));
  }

  /**
   * Helper: convert Neo4j integer or number to JS number
   */
  private toNumber(val: unknown): number {
    if (val === null || val === undefined) return 0;
    if (typeof val === 'number') return val;
    if (typeof val === 'object' && val !== null && 'toNumber' in val) {
      return (val as { toNumber: () => number }).toNumber();
    }
    return Number(val) || 0;
  }

  /**
   * Helper: convert Neo4j DateTime or string to JS Date
   */
  private toDate(val: unknown): Date | null {
    if (val === null || val === undefined) return null;
    if (val instanceof Date) return val;
    if (typeof val === 'string') return new Date(val);
    // Neo4j DateTime object
    if (typeof val === 'object' && val !== null && 'toStandardDate' in val) {
      return (val as { toStandardDate: () => Date }).toStandardDate();
    }
    return null;
  }
}
