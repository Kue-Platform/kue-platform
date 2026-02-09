import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatAnthropic } from '@langchain/anthropic';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { LoggerService } from '../../observability/logger.service';
import { MetricsService } from '../../observability/metrics.service';

const FORMATTER_PROMPT = `You are a professional network assistant for Kue. Your job is to summarize search results into a clear, concise, and actionable response.

Guidelines:
- Be brief and direct — 2-4 sentences maximum
- Highlight the most relevant results first
- Mention relationship strength when available (interpret as a 0-100 scale)
- Suggest actionable next steps (e.g., "consider reaching out" or "you could ask X for an intro")
- If results are empty, suggest broadening the search
- Use plain, professional language — no emojis or excessive enthusiasm
- Reference specific names, titles, and companies from the results
- For intro path results, describe the chain clearly (You → Person A → Person B → Target)

Respond with a natural language summary only. No JSON, no markdown formatting.`;

@Injectable()
export class ResultFormatterChain {
  private model: ChatAnthropic | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly logger: LoggerService,
    private readonly metrics: MetricsService,
  ) {
    const apiKey = this.config.get<string>('ANTHROPIC_API_KEY');
    if (apiKey) {
      // Use Sonnet for higher-quality formatting
      this.model = new ChatAnthropic({
        anthropicApiKey: apiKey,
        modelName: 'claude-sonnet-4-20250514',
        temperature: 0.3,
        maxTokens: 512,
      });
    }
  }

  /**
   * Format search results into a human-readable summary.
   * Uses Claude Sonnet for high-quality natural language.
   * Falls back to a structured text summary if LLM is unavailable.
   */
  async format(
    query: string,
    results: Record<string, unknown>[],
    queryType: string,
  ): Promise<string> {
    if (results.length === 0) {
      return `No results found for "${query}". Try broadening your search or using different keywords.`;
    }

    if (!this.model) {
      return this.fallbackFormat(query, results, queryType);
    }

    const startTime = Date.now();

    try {
      // Limit results sent to LLM to avoid token bloat
      const truncatedResults = results.slice(0, 10);

      const response = await this.model.invoke([
        new SystemMessage(FORMATTER_PROMPT),
        new HumanMessage(
          `User query: "${query}"\nQuery type: ${queryType}\nTotal results: ${results.length}\n\nTop results:\n${JSON.stringify(truncatedResults, null, 2)}`,
        ),
      ]);

      const duration = Date.now() - startTime;
      this.metrics.recordLlmRequest('result_formatter', duration, true);

      this.logger.debug('Results formatted via LLM', {
        query,
        resultCount: results.length,
        durationMs: duration,
      });

      return typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content);
    } catch (error) {
      const duration = Date.now() - startTime;
      this.metrics.recordLlmRequest('result_formatter', duration, false);
      this.logger.error('Result formatting via LLM failed, using fallback', {
        query,
        error: error instanceof Error ? error.message : String(error),
      });

      return this.fallbackFormat(query, results, queryType);
    }
  }

  /**
   * Fallback structured text formatter when LLM is unavailable.
   */
  private fallbackFormat(
    query: string,
    results: Record<string, unknown>[],
    queryType: string,
  ): string {
    const count = results.length;

    if (queryType === 'intro_path') {
      return this.formatIntroPath(results);
    }

    if (queryType === 'company_search') {
      return this.formatCompanyResults(query, results);
    }

    // Person/relationship/general results
    const topResults = results.slice(0, 5);
    const lines: string[] = [`Found ${count} result${count !== 1 ? 's' : ''} for "${query}".`];

    if (topResults.length > 0) {
      lines.push('Top matches:');
      for (const r of topResults) {
        const result = r as Record<string, unknown>;
        const name = result.name || result.email || 'Unknown';
        const title = result.title ? ` — ${result.title}` : '';
        const company = result.company ? ` at ${result.company}` : '';
        const strength = typeof result.strength === 'number'
          ? ` (strength: ${Math.round(result.strength)})`
          : '';
        lines.push(`  - ${name}${title}${company}${strength}`);
      }
    }

    return lines.join('\n');
  }

  private formatIntroPath(results: Record<string, unknown>[]): string {
    if (results.length === 0) return 'No introduction path found.';

    const result = results[0];
    const nodes = result.nodes as Record<string, unknown>[] | undefined;
    const pathLength = result.pathLength as number | undefined;

    if (!nodes || nodes.length < 2) {
      return 'No clear introduction path found to this person.';
    }

    const pathParts = nodes.map((n) => {
      const name = n.name || n.email || 'Unknown';
      const title = n.title ? ` (${n.title})` : '';
      return `${name}${title}`;
    });

    return `Introduction path (${pathLength || nodes.length - 1} degree${(pathLength || 0) > 1 ? 's' : ''}): ${pathParts.join(' → ')}`;
  }

  private formatCompanyResults(
    query: string,
    results: Record<string, unknown>[],
  ): string {
    const lines: string[] = [`Found ${results.length} compan${results.length !== 1 ? 'ies' : 'y'} matching "${query}".`];

    for (const r of results.slice(0, 5)) {
      const result = r as Record<string, unknown>;
      const name = result.name || 'Unknown';
      const contacts = result.contacts as Record<string, unknown>[] | undefined;
      const contactCount = contacts?.length || 0;
      lines.push(`  - ${name}: ${contactCount} contact${contactCount !== 1 ? 's' : ''}`);
    }

    return lines.join('\n');
  }
}
