import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Neo4jService } from '../database/neo4j.service';
import { SupabaseService } from '../database/supabase.service';
import { LoggerService } from '../observability/logger.service';
import { SentryService } from '../observability/sentry.service';
import { MetricsService } from '../observability/metrics.service';
import { PosthogService } from '../observability/posthog.service';
import { ScoringService } from '../pipeline/scoring.service';
import { inngest } from '../inngest/inngest.client';

export interface EnrichmentData {
  title?: string;
  company?: string;
  location?: string;
  bio?: string;
  industry?: string;
  linkedinUrl?: string;
  avatarUrl?: string;
  skills?: string[];
  companySize?: string;
  companyIndustry?: string;
  companyDomain?: string;
}

export interface EnrichmentResult {
  personId: string;
  email: string;
  enriched: boolean;
  fieldsUpdated: string[];
  source: string;
}

@Injectable()
export class EnrichmentService {
  private enrichmentApiKey: string | null;

  constructor(
    private readonly configService: ConfigService,
    private readonly neo4j: Neo4jService,
    private readonly supabase: SupabaseService,
    private readonly logger: LoggerService,
    private readonly sentry: SentryService,
    private readonly metrics: MetricsService,
    private readonly posthog: PosthogService,
    private readonly scoring: ScoringService,
  ) {
    this.enrichmentApiKey = this.configService.get<string>('ENRICHMENT_API_KEY') || null;
  }

  /**
   * Trigger enrichment for a specific contact.
   * Sends an Inngest event for async processing.
   */
  async triggerEnrichment(userId: string, personId: string): Promise<{ queued: boolean }> {
    await inngest.send({
      name: 'kue/contact.enrich.requested',
      data: { personId, userId },
    });

    this.logger.info('Enrichment triggered', { userId, personId });
    return { queued: true };
  }

  /**
   * Trigger enrichment for multiple contacts (batch).
   * Queues up to `limit` un-enriched contacts.
   */
  async triggerBatchEnrichment(
    userId: string,
    options: { limit?: number; forceRefresh?: boolean } = {},
  ): Promise<{ queued: number }> {
    const { limit = 50, forceRefresh = false } = options;

    // Find contacts that haven't been enriched or need refresh
    const result = await this.neo4j.runQuery(
      `
      MATCH (u:KueUser {id: $userId})-[:KNOWS]->(p:Person {ownerId: $userId})
      WHERE ${forceRefresh ? 'true' : 'p.enrichedAt IS NULL'}
      RETURN p.id AS personId, p.email AS email
      ORDER BY p.createdAt DESC
      LIMIT $limit
      `,
      { userId, limit },
      'find_unenriched',
    );

    if (result.records.length === 0) {
      this.logger.info('No contacts to enrich', { userId });
      return { queued: 0 };
    }

    // Send batch of Inngest events
    const events = result.records.map((record) => ({
      name: 'kue/contact.enrich.requested' as const,
      data: {
        personId: record.get('personId') as string,
        userId,
      },
    }));

    await inngest.send(events);

    this.logger.info('Batch enrichment triggered', {
      userId,
      queued: events.length,
      forceRefresh,
    });

    this.posthog.capture(userId, 'enrichment_batch_triggered', {
      count: events.length,
      forceRefresh,
    });

    return { queued: events.length };
  }

  /**
   * Execute enrichment for a single contact.
   * Called by the Inngest function.
   */
  async executeEnrichment(
    userId: string,
    personId: string,
  ): Promise<EnrichmentResult> {
    const startTime = Date.now();

    try {
      // Fetch the person's current data from Neo4j
      const personResult = await this.neo4j.runQuery(
        `
        MATCH (p:Person {id: $personId, ownerId: $userId})
        RETURN p {
          .id, .email, .name, .firstName, .lastName, .title, .company,
          .location, .linkedinUrl, .bio, .source
        } AS person
        `,
        { personId, userId },
        'enrichment_fetch_person',
      );

      if (personResult.records.length === 0) {
        this.logger.warn('Person not found for enrichment', { personId, userId });
        return { personId, email: '', enriched: false, fieldsUpdated: [], source: 'none' };
      }

      const person = personResult.records[0].get('person') as Record<string, unknown>;
      const email = person.email as string;

      // Fetch enrichment data from external API
      const enrichmentData = await this.fetchEnrichmentData(email, person);

      if (!enrichmentData) {
        return { personId, email, enriched: false, fieldsUpdated: [], source: 'api' };
      }

      // Update the Person node with enriched data
      const fieldsUpdated = await this.applyEnrichmentData(personId, userId, enrichmentData);

      // Update company info if we got new company data
      if (enrichmentData.company && enrichmentData.companyDomain) {
        await this.enrichCompany(enrichmentData);
      }

      const durationMs = Date.now() - startTime;
      this.metrics.recordHistogram('enrichment.duration_ms', durationMs);
      this.metrics.incrementCounter('enrichment.completed');

      this.posthog.capture(userId, 'enrichment_completed', {
        personId,
        email,
        fieldsUpdated: fieldsUpdated.length,
        durationMs,
      });

      this.logger.info('Contact enriched', {
        userId,
        personId,
        email,
        fieldsUpdated,
        durationMs,
      });

      return {
        personId,
        email,
        enriched: fieldsUpdated.length > 0,
        fieldsUpdated,
        source: 'api',
      };
    } catch (error) {
      this.metrics.incrementCounter('enrichment.failures');
      this.sentry.captureException(error as Error, {
        userId,
        personId,
        context: 'execute_enrichment',
      });
      throw error;
    }
  }

  /**
   * Fetch enrichment data from external API.
   * Currently a framework — plug in Clearbit, People Data Labs, etc.
   */
  private async fetchEnrichmentData(
    email: string,
    existingData: Record<string, unknown>,
  ): Promise<EnrichmentData | null> {
    if (!this.enrichmentApiKey) {
      this.logger.debug('No enrichment API key configured, using fallback enrichment');
      return this.fallbackEnrichment(email, existingData);
    }

    try {
      // TODO: Integrate with enrichment provider (Clearbit, People Data Labs, etc.)
      // Example API call structure:
      //
      // const response = await fetch(`https://api.enrichment-provider.com/v1/person`, {
      //   method: 'POST',
      //   headers: {
      //     'Authorization': `Bearer ${this.enrichmentApiKey}`,
      //     'Content-Type': 'application/json',
      //   },
      //   body: JSON.stringify({ email }),
      // });
      //
      // if (!response.ok) return null;
      // const data = await response.json();
      // return this.mapEnrichmentResponse(data);

      this.logger.debug('Enrichment API integration pending — using fallback', { email });
      return this.fallbackEnrichment(email, existingData);
    } catch (error) {
      this.logger.error('Enrichment API call failed', {
        email,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Fallback enrichment: derive what we can from existing data
   * (email domain → company, name parsing, etc.)
   */
  private fallbackEnrichment(
    email: string,
    existingData: Record<string, unknown>,
  ): EnrichmentData | null {
    const data: EnrichmentData = {};
    let hasNewData = false;

    // Try to extract company domain from email
    const domain = this.extractDomain(email);
    if (domain && !existingData.company) {
      // Derive company name from domain (capitalize, remove TLD)
      const companyGuess = domain.split('.')[0];
      data.company = companyGuess.charAt(0).toUpperCase() + companyGuess.slice(1);
      data.companyDomain = domain;
      hasNewData = true;
    }

    // If we have a company domain, store it
    if (domain && !data.companyDomain) {
      data.companyDomain = domain;
    }

    return hasNewData ? data : null;
  }

  /**
   * Apply enrichment data to a Person node in Neo4j.
   * Only updates fields that are currently empty.
   */
  private async applyEnrichmentData(
    personId: string,
    userId: string,
    data: EnrichmentData,
  ): Promise<string[]> {
    const fieldsUpdated: string[] = [];
    const setClauses: string[] = [];
    const params: Record<string, unknown> = { personId, userId };

    // Only update fields that have values and the person doesn't already have
    const fieldMappings: [keyof EnrichmentData, string][] = [
      ['title', 'title'],
      ['company', 'company'],
      ['location', 'location'],
      ['bio', 'bio'],
      ['linkedinUrl', 'linkedinUrl'],
      ['avatarUrl', 'avatarUrl'],
    ];

    for (const [dataKey, nodeKey] of fieldMappings) {
      if (data[dataKey]) {
        setClauses.push(`p.${nodeKey} = CASE WHEN p.${nodeKey} IS NULL THEN $${dataKey} ELSE p.${nodeKey} END`);
        params[dataKey] = data[dataKey];
        fieldsUpdated.push(nodeKey);
      }
    }

    if (setClauses.length === 0) return [];

    // Always update enrichedAt
    setClauses.push('p.enrichedAt = datetime()');

    await this.neo4j.runQuery(
      `
      MATCH (p:Person {id: $personId, ownerId: $userId})
      SET ${setClauses.join(',\n          ')}
      `,
      params,
      'apply_enrichment',
    );

    return fieldsUpdated;
  }

  /**
   * Enrich company node with additional data
   */
  private async enrichCompany(data: EnrichmentData): Promise<void> {
    if (!data.company) return;

    const setClauses: string[] = [];
    const params: Record<string, unknown> = { companyName: data.company };

    if (data.companyDomain) {
      setClauses.push('c.domain = COALESCE(c.domain, $domain)');
      params.domain = data.companyDomain;
    }
    if (data.companyIndustry) {
      setClauses.push('c.industry = COALESCE(c.industry, $industry)');
      params.industry = data.companyIndustry;
    }
    if (data.companySize) {
      setClauses.push('c.size = COALESCE(c.size, $size)');
      params.size = data.companySize;
    }

    if (setClauses.length === 0) return;

    await this.neo4j.runQuery(
      `
      MATCH (c:Company {name: $companyName})
      SET ${setClauses.join(',\n          ')}
      `,
      params,
      'enrich_company',
    );
  }

  /**
   * Recalculate score for a contact after enrichment
   */
  async recalculateScore(userId: string, personEmail: string): Promise<void> {
    await this.scoring.scoreContact(userId, personEmail);
  }

  /**
   * Get enrichment queue status for a user
   */
  async getEnrichmentStatus(userId: string): Promise<{
    total: number;
    enriched: number;
    pending: number;
    percentComplete: number;
  }> {
    const result = await this.neo4j.runQuery(
      `
      MATCH (u:KueUser {id: $userId})-[:KNOWS]->(p:Person {ownerId: $userId})
      WITH count(p) AS total,
           count(p.enrichedAt) AS enriched
      RETURN total, enriched, total - enriched AS pending,
             CASE WHEN total > 0 THEN toFloat(enriched) / total * 100 ELSE 0 END AS percentComplete
      `,
      { userId },
      'enrichment_status',
    );

    const record = result.records[0];
    if (!record) {
      return { total: 0, enriched: 0, pending: 0, percentComplete: 0 };
    }

    const toNum = (val: unknown): number => {
      if (typeof val === 'number') return val;
      if (typeof val === 'object' && val !== null && 'toNumber' in val) {
        return (val as { toNumber: () => number }).toNumber();
      }
      return Number(val) || 0;
    };

    return {
      total: toNum(record.get('total')),
      enriched: toNum(record.get('enriched')),
      pending: toNum(record.get('pending')),
      percentComplete: Math.round(toNum(record.get('percentComplete')) * 100) / 100,
    };
  }

  private extractDomain(email: string): string | null {
    const parts = email.split('@');
    if (parts.length !== 2) return null;
    const domain = parts[1].toLowerCase();

    const freeProviders = [
      'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com',
      'aol.com', 'icloud.com', 'mail.com', 'protonmail.com',
      'live.com', 'msn.com', 'ymail.com', 'linkedin.placeholder',
    ];
    if (freeProviders.includes(domain)) return null;

    return domain;
  }
}
