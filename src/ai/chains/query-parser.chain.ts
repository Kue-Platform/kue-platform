import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatAnthropic } from '@langchain/anthropic';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { LoggerService } from '../../observability/logger.service';
import { MetricsService } from '../../observability/metrics.service';
import type { SearchIntent } from '../../common/types';

const QUERY_PARSER_PROMPT = `You are a search query parser for Kue, a professional network intelligence platform. Your job is to parse natural language queries about professional contacts into structured search intents.

Given a user's query, produce a JSON object with these fields:

{
  "queryType": one of "person_search", "company_search", "relationship_query", "intro_path", "general",
  "filters": {
    "roles": ["engineer", "manager"],     // job titles/roles mentioned
    "companies": ["Google", "Meta"],       // company names mentioned
    "locations": ["San Francisco"],        // locations mentioned
    "industries": ["fintech", "AI"],       // industries mentioned
    "skills": ["Python", "ML"],            // skills mentioned
    "name": "John Smith",                  // specific person name
    "title": "VP of Engineering",          // specific title
    "degree": 1 or 2 or 3,               // connection degree (1=direct, 2=friend-of-friend)
    "sort": "strength" or "recency" or "relevance"
  }
}

Rules:
- queryType "person_search": looking for specific people by role, company, location, skills
- queryType "company_search": looking for companies or people at specific companies
- queryType "relationship_query": asking about relationship strength, recent contacts, interaction history
- queryType "intro_path": asking "who can introduce me to X?" or "how do I reach X?"
- queryType "general": catch-all for ambiguous queries
- If the query mentions "second degree", "friend of friend", "mutual", set degree to 2
- If the query mentions "strong connections" or "close contacts", set sort to "strength"
- If the query mentions "recently" or "latest", set sort to "recency"
- Only include filters that are explicitly or strongly implied by the query
- Respond with valid JSON only, no markdown, no explanation

Examples:
- "engineers at Google" → person_search, roles: ["engineer"], companies: ["Google"]
- "who do I know at Stripe?" → company_search, companies: ["Stripe"]
- "introduce me to Sarah Chen" → intro_path, name: "Sarah Chen"
- "my strongest connections" → relationship_query, sort: "strength"
- "people I haven't talked to recently" → relationship_query, sort: "recency"
- "VPs in fintech in New York" → person_search, roles: ["VP"], industries: ["fintech"], locations: ["New York"]
- "second degree connections at Meta" → person_search, companies: ["Meta"], degree: 2`;

@Injectable()
export class QueryParserChain {
  private model: ChatAnthropic | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly logger: LoggerService,
    private readonly metrics: MetricsService,
  ) {
    const apiKey = this.config.get<string>('ANTHROPIC_API_KEY');
    if (apiKey) {
      // Use Haiku for fast, cheap query parsing
      this.model = new ChatAnthropic({
        anthropicApiKey: apiKey,
        modelName: 'claude-3-5-haiku-20241022',
        temperature: 0,
        maxTokens: 512,
      });
    }
  }

  /**
   * Parse a natural language query into a SearchIntent.
   * Uses Claude Haiku for speed and cost efficiency.
   * Falls back to keyword extraction if LLM is unavailable.
   */
  async parse(query: string): Promise<SearchIntent> {
    if (!this.model) {
      return this.fallbackParse(query);
    }

    const startTime = Date.now();

    try {
      const response = await this.model.invoke([
        new SystemMessage(QUERY_PARSER_PROMPT),
        new HumanMessage(query),
      ]);

      const duration = Date.now() - startTime;
      this.metrics.recordLlmRequest('query_parser', duration, true);

      const content = typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content);

      // Strip any markdown code fences if present
      const jsonStr = content.replace(/```(?:json)?\n?/g, '').trim();
      const parsed = JSON.parse(jsonStr);

      this.logger.debug('Query parsed via LLM', {
        query,
        queryType: parsed.queryType,
        filterCount: Object.keys(parsed.filters || {}).filter((k) => parsed.filters[k] != null).length,
        durationMs: duration,
      });

      return {
        queryType: parsed.queryType || 'general',
        filters: parsed.filters || {},
        naturalLanguage: query,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      this.metrics.recordLlmRequest('query_parser', duration, false);
      this.logger.error('Query parsing via LLM failed, using fallback', {
        query,
        error: error instanceof Error ? error.message : String(error),
      });

      return this.fallbackParse(query);
    }
  }

  /**
   * Fallback keyword-based parser when LLM is unavailable.
   * Extracts basic intent from common patterns.
   */
  private fallbackParse(query: string): SearchIntent {
    const lower = query.toLowerCase().trim();
    const filters: SearchIntent['filters'] = {};
    let queryType: SearchIntent['queryType'] = 'general';

    // Detect intro path queries
    if (lower.includes('introduce') || lower.includes('intro') || lower.includes('how do i reach') || lower.includes('path to')) {
      queryType = 'intro_path';
      // Extract the target name (everything after "introduce me to" / "reach" / etc.)
      const nameMatch = lower.match(/(?:introduce\s+(?:me\s+)?to|reach|path\s+to)\s+(.+)/);
      if (nameMatch) {
        filters.name = this.toTitleCase(nameMatch[1].trim());
      }
    }
    // Detect relationship queries
    else if (lower.includes('strongest') || lower.includes('closest') || lower.includes('recent') || lower.includes('haven\'t talked') || lower.includes('stale')) {
      queryType = 'relationship_query';
      if (lower.includes('strongest') || lower.includes('closest')) {
        filters.sort = 'strength';
      } else {
        filters.sort = 'recency';
      }
    }
    // Detect company search
    else if (lower.includes('who do i know at') || lower.includes('contacts at') || lower.includes('people at')) {
      queryType = 'company_search';
      const companyMatch = lower.match(/(?:who\s+do\s+i\s+know\s+at|contacts?\s+at|people\s+at)\s+(.+)/);
      if (companyMatch) {
        filters.companies = [this.toTitleCase(companyMatch[1].trim().replace(/[?.,!]$/, ''))];
      }
    }
    // Detect person search with "at" pattern (e.g., "engineers at Google")
    else if (lower.includes(' at ')) {
      queryType = 'person_search';
      const parts = lower.split(' at ');
      if (parts.length === 2) {
        filters.roles = [parts[0].trim()];
        filters.companies = [this.toTitleCase(parts[1].trim().replace(/[?.,!]$/, ''))];
      }
    }
    // Detect person search with roles
    else if (lower.includes(' in ')) {
      queryType = 'person_search';
      const parts = lower.split(' in ');
      if (parts.length === 2) {
        filters.roles = [parts[0].trim()];
        filters.locations = [this.toTitleCase(parts[1].trim().replace(/[?.,!]$/, ''))];
      }
    }

    // Detect degree
    if (lower.includes('second degree') || lower.includes('2nd degree') || lower.includes('friend of friend') || lower.includes('mutual')) {
      filters.degree = 2;
    }

    return { queryType, filters, naturalLanguage: query };
  }

  private toTitleCase(str: string): string {
    return str.replace(/\b\w/g, (c) => c.toUpperCase());
  }
}
