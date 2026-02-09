import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatAnthropic } from '@langchain/anthropic';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { LoggerService } from '../observability/logger.service';
import { MetricsService } from '../observability/metrics.service';
import { SearchIntent } from '../common/types';

const SYSTEM_PROMPT = `You are a professional network intelligence assistant for Kue.
Your role is to parse natural language queries about professional contacts into structured search intents.

Given a user query, extract:
- queryType: "person_search", "company_search", "relationship_query", "intro_path", or "general"
- filters: relevant filters like name, company, title, location, tags
- naturalLanguage: the original query text

Respond in valid JSON only, no markdown.`;

@Injectable()
export class LlmService implements OnModuleInit {
  private model: ChatAnthropic | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly logger: LoggerService,
    private readonly metrics: MetricsService,
  ) {}

  onModuleInit() {
    const apiKey = this.config.get<string>('ANTHROPIC_API_KEY');
    if (!apiKey) {
      this.logger.warn('ANTHROPIC_API_KEY not set — LLM features disabled');
      return;
    }

    this.model = new ChatAnthropic({
      anthropicApiKey: apiKey,
      modelName: 'claude-sonnet-4-20250514',
      temperature: 0,
      maxTokens: 1024,
    });

    // LangSmith tracing is auto-enabled via env vars:
    // LANGCHAIN_TRACING_V2=true
    // LANGCHAIN_API_KEY=<key>
    // LANGCHAIN_PROJECT=kue-platform
    this.logger.info('LLM service initialized with Claude claude-sonnet-4-20250514');
  }

  async parseSearchQuery(query: string): Promise<SearchIntent> {
    if (!this.model) {
      // Fallback: return a basic keyword search intent
      return {
        queryType: 'general',
        filters: {},
        naturalLanguage: query,
      };
    }

    const startTime = Date.now();

    try {
      const response = await this.model.invoke([
        new SystemMessage(SYSTEM_PROMPT),
        new HumanMessage(query),
      ]);

      const duration = Date.now() - startTime;
      this.metrics.recordLlmRequest('parseSearchQuery', duration, true);
      this.logger.info('LLM search query parsed', { query, duration });

      const content =
        typeof response.content === 'string'
          ? response.content
          : JSON.stringify(response.content);

      const parsed = JSON.parse(content);

      return {
        queryType: parsed.queryType || 'general',
        filters: parsed.filters || {},
        naturalLanguage: query,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      this.metrics.recordLlmRequest('parseSearchQuery', duration, false);
      this.logger.error('LLM search query parsing failed', {
        query,
        error: error instanceof Error ? error.message : String(error),
      });

      // Fallback to basic intent
      return {
        queryType: 'general',
        filters: {},
        naturalLanguage: query,
      };
    }
  }

  async formatSearchResults(
    query: string,
    results: Record<string, unknown>[],
  ): Promise<string> {
    if (!this.model || results.length === 0) {
      return `Found ${results.length} results for "${query}".`;
    }

    const startTime = Date.now();

    try {
      const response = await this.model.invoke([
        new SystemMessage(
          'You are a professional network assistant. Summarize the search results in a clear, actionable way. Be concise.',
        ),
        new HumanMessage(
          `Query: "${query}"\n\nResults:\n${JSON.stringify(results, null, 2)}`,
        ),
      ]);

      const duration = Date.now() - startTime;
      this.metrics.recordLlmRequest('formatSearchResults', duration, true);

      return typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content);
    } catch (error) {
      const duration = Date.now() - startTime;
      this.metrics.recordLlmRequest('formatSearchResults', duration, false);
      this.logger.error('LLM result formatting failed', {
        error: error instanceof Error ? error.message : String(error),
      });

      return `Found ${results.length} results for "${query}".`;
    }
  }

  isAvailable(): boolean {
    return this.model !== null;
  }
}
