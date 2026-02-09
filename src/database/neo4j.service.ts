import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import neo4j, { Driver, Session, Result } from 'neo4j-driver';
import { MetricsService } from '../observability/metrics.service';
import { LoggerService } from '../observability/logger.service';

@Injectable()
export class Neo4jService implements OnModuleInit, OnModuleDestroy {
  private driver: Driver | null = null;

  constructor(
    private configService: ConfigService,
    private metrics: MetricsService,
    private logger: LoggerService,
  ) {}

  onModuleInit(): void {
    const uri = this.configService.get<string>('NEO4J_URI');
    const username = this.configService.get<string>('NEO4J_USERNAME');
    const password = this.configService.get<string>('NEO4J_PASSWORD');

    if (uri && password) {
      this.driver = neo4j.driver(uri, neo4j.auth.basic(username!, password));
      this.logger.info('Neo4j driver initialized', { uri });
    } else {
      this.logger.warn('Neo4j credentials not configured, skipping connection');
    }
  }

  async runQuery(
    cypher: string,
    params: Record<string, unknown> = {},
    queryType = 'unknown',
  ): Promise<Result> {
    if (!this.driver) {
      throw new Error('Neo4j driver not initialized');
    }

    const session: Session = this.driver.session();
    const start = Date.now();
    try {
      const result = await session.run(cypher, params);
      const latency = Date.now() - start;
      this.metrics.recordNeo4jLatency(queryType, latency);
      this.logger.debug('neo4j_query', {
        queryType,
        latencyMs: latency,
        recordCount: result.records.length,
      });
      return result;
    } catch (error) {
      const latency = Date.now() - start;
      this.metrics.recordNeo4jLatency(`${queryType}_error`, latency);
      this.logger.error('neo4j_query_error', {
        queryType,
        latencyMs: latency,
        error: String(error),
      });
      throw error;
    } finally {
      await session.close();
    }
  }

  async verifyConnectivity(): Promise<boolean> {
    if (!this.driver) return false;
    try {
      await this.driver.verifyConnectivity();
      return true;
    } catch {
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.driver?.close();
  }
}
