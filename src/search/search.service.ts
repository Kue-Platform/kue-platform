import { Injectable } from '@nestjs/common';
import { Neo4jService } from '../database/neo4j.service';
import { RedisService } from '../database/redis.service';
import { LoggerService } from '../observability/logger.service';
import { MetricsService } from '../observability/metrics.service';
import { PosthogService } from '../observability/posthog.service';
import { SentryService } from '../observability/sentry.service';
import { QueryParserChain } from '../ai/chains/query-parser.chain';
import { ResultFormatterChain } from '../ai/chains/result-formatter.chain';
import { CypherBuilderService } from './cypher-builder.service';
import { SupabaseService } from '../database/supabase.service';
import type { SearchIntent } from '../common/types';

/** Cache TTL: 5 minutes for search results */
const CACHE_TTL_SECONDS = 300;

export interface SearchResponse {
  query: string;
  intent: SearchIntent;
  results: Record<string, unknown>[];
  totalResults: number;
  summary: string;
  cached: boolean;
  timings: {
    parseMs: number;
    queryMs: number;
    formatMs: number;
    totalMs: number;
  };
}

@Injectable()
export class SearchService {
  constructor(
    private readonly neo4j: Neo4jService,
    private readonly redis: RedisService,
    private readonly supabase: SupabaseService,
    private readonly logger: LoggerService,
    private readonly metrics: MetricsService,
    private readonly posthog: PosthogService,
    private readonly sentry: SentryService,
    private readonly queryParser: QueryParserChain,
    private readonly resultFormatter: ResultFormatterChain,
    private readonly cypherBuilder: CypherBuilderService,
  ) {}

  /**
   * Full search pipeline:
   * 1. Check Redis cache
   * 2. Parse NL query → SearchIntent (via LangChain)
   * 3. Build Cypher query from SearchIntent
   * 4. Execute against Neo4j
   * 5. Format results (via LangChain)
   * 6. Cache results in Redis
   * 7. Log search to Supabase + PostHog
   */
  async search(
    query: string,
    userId: string,
    options: { format?: boolean; page?: number; limit?: number } = {},
  ): Promise<SearchResponse> {
    const totalStart = Date.now();
    const { format = true, page = 1, limit = 20 } = options;

    try {
      // Step 1: Check cache
      const cacheKey = this.buildCacheKey(userId, query);
      const cached = await this.redis.get<SearchResponse>(cacheKey);

      if (cached) {
        this.logger.debug('Search cache hit', { query, userId });
        this.metrics.recordCacheHit();

        // Track even cached searches
        this.trackSearch(userId, query, cached.intent, cached.totalResults, true);

        return { ...cached, cached: true };
      }

      // Step 2: Parse query → SearchIntent
      const parseStart = Date.now();
      const intent = await this.queryParser.parse(query);
      const parseMs = Date.now() - parseStart;

      // Step 3: Build Cypher query
      const cypherQuery = this.cypherBuilder.build(intent, userId);

      // Step 4: Execute against Neo4j
      const queryStart = Date.now();
      const neo4jResult = await this.neo4j.runQuery(
        cypherQuery.cypher,
        cypherQuery.params,
        `search_${cypherQuery.queryType}`,
      );
      const queryMs = Date.now() - queryStart;

      // Extract results
      const allResults = neo4jResult.records.map((record) => {
        // Different query types return data differently
        if (cypherQuery.queryType === 'intro_path') {
          return {
            nodes: record.get('nodes'),
            relationships: record.get('relationships'),
            pathLength: this.toNumber(record.get('pathLength')),
          };
        }
        return record.get('result') as Record<string, unknown>;
      });

      // Paginate results
      const startIndex = (page - 1) * limit;
      const paginatedResults = allResults.slice(startIndex, startIndex + limit);

      // Step 5: Format results (optional)
      const formatStart = Date.now();
      let summary: string;
      if (format) {
        summary = await this.resultFormatter.format(query, allResults, cypherQuery.queryType);
      } else {
        summary = `Found ${allResults.length} result${allResults.length !== 1 ? 's' : ''}.`;
      }
      const formatMs = Date.now() - formatStart;

      const totalMs = Date.now() - totalStart;

      const response: SearchResponse = {
        query,
        intent,
        results: paginatedResults,
        totalResults: allResults.length,
        summary,
        cached: false,
        timings: {
          parseMs,
          queryMs,
          formatMs,
          totalMs,
        },
      };

      // Step 6: Cache results
      await this.redis.set(cacheKey, response, CACHE_TTL_SECONDS);

      // Step 7: Track search
      this.trackSearch(userId, query, intent, allResults.length, false);

      // Metrics
      this.metrics.recordHistogram('search.duration_ms', totalMs);
      this.metrics.incrementCounter('search.executed', {
        queryType: intent.queryType,
        cached: 'false',
      });

      this.logger.info('Search executed', {
        userId,
        query,
        queryType: intent.queryType,
        resultCount: allResults.length,
        parseMs,
        queryMs,
        formatMs,
        totalMs,
      });

      return response;
    } catch (error) {
      const totalMs = Date.now() - totalStart;
      this.metrics.incrementCounter('search.errors');

      this.sentry.captureException(error as Error, {
        userId,
        query,
        context: 'search',
      });

      this.logger.error('Search failed', {
        userId,
        query,
        error: error instanceof Error ? error.message : String(error),
        totalMs,
      });

      throw error;
    }
  }

  /**
   * Quick search — skips LLM formatting for faster responses.
   * Useful for autocomplete / typeahead scenarios.
   */
  async quickSearch(
    query: string,
    userId: string,
    limit = 10,
  ): Promise<{ results: Record<string, unknown>[]; totalResults: number }> {
    const response = await this.search(query, userId, {
      format: false,
      limit,
    });

    return {
      results: response.results,
      totalResults: response.totalResults,
    };
  }

  /**
   * Search suggestions based on user's network.
   * Returns commonly-searched patterns or notable contacts.
   */
  async getSuggestions(userId: string): Promise<string[]> {
    try {
      // Fetch user's top companies and roles for suggestions
      const result = await this.neo4j.runQuery(
        `
        MATCH (u:KueUser {id: $userId})-[r:KNOWS]->(p:Person {ownerId: $userId})
        WHERE p.company IS NOT NULL
        WITH p.company AS company, count(p) AS contactCount
        ORDER BY contactCount DESC
        LIMIT 5
        RETURN collect(company) AS topCompanies
        `,
        { userId },
        'search_suggestions',
      );

      const companies = (result.records[0]?.get('topCompanies') as string[]) || [];
      const suggestions: string[] = [];

      for (const company of companies.slice(0, 3)) {
        suggestions.push(`Who do I know at ${company}?`);
      }

      suggestions.push('My strongest connections');
      suggestions.push('People I haven\'t talked to recently');

      return suggestions;
    } catch (error) {
      this.logger.error('Failed to get search suggestions', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [
        'My strongest connections',
        'People I haven\'t talked to recently',
        'Engineers in my network',
      ];
    }
  }

  /**
   * Log search to Supabase search_history table and PostHog
   */
  private trackSearch(
    userId: string,
    query: string,
    intent: SearchIntent,
    resultCount: number,
    cached: boolean,
  ): void {
    // Fire-and-forget — don't block the response
    this.saveSearchHistory(userId, query, intent, resultCount).catch((error) => {
      this.logger.error('Failed to save search history', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
    });

    this.posthog.capture(userId, 'search_performed', {
      query,
      queryType: intent.queryType,
      resultCount,
      cached,
      filters: intent.filters,
    });
  }

  private async saveSearchHistory(
    userId: string,
    query: string,
    intent: SearchIntent,
    resultCount: number,
  ): Promise<void> {
    try {
      const client = this.supabase.getClient();
      await client.from('search_history').insert({
        user_id: userId,
        query,
        query_type: intent.queryType,
        filters: intent.filters,
        result_count: resultCount,
      });
    } catch {
      // Silently fail — search history is non-critical
    }
  }

  private buildCacheKey(userId: string, query: string): string {
    // Normalize query for cache dedup
    const normalized = query.toLowerCase().trim().replace(/\s+/g, ' ');
    return `search:${userId}:${normalized}`;
  }

  private toNumber(val: unknown): number {
    if (val === null || val === undefined) return 0;
    if (typeof val === 'number') return val;
    if (typeof val === 'object' && val !== null && 'toNumber' in val) {
      return (val as { toNumber: () => number }).toNumber();
    }
    return Number(val) || 0;
  }
}
