import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  HealthCheckResult,
  HealthIndicatorResult,
} from '@nestjs/terminus';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Neo4jService } from '../database/neo4j.service';
import { SupabaseService } from '../database/supabase.service';
import { RedisService } from '../database/redis.service';
import { Public } from '../common/decorators/public.decorator';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly neo4j: Neo4jService,
    private readonly supabase: SupabaseService,
    private readonly redis: RedisService,
  ) {}

  @Get()
  @Public()
  @HealthCheck()
  @ApiOperation({ summary: 'Health check for all services' })
  async check(): Promise<HealthCheckResult> {
    return this.health.check([
      async (): Promise<HealthIndicatorResult> => {
        try {
          await this.neo4j.verifyConnectivity();
          return { neo4j: { status: 'up' } };
        } catch {
          return { neo4j: { status: 'down' } };
        }
      },
      async (): Promise<HealthIndicatorResult> => {
        try {
          await this.supabase.verifyConnectivity();
          return { supabase: { status: 'up' } };
        } catch {
          return { supabase: { status: 'down' } };
        }
      },
      async (): Promise<HealthIndicatorResult> => {
        try {
          await this.redis.verifyConnectivity();
          return { redis: { status: 'up' } };
        } catch {
          return { redis: { status: 'down' } };
        }
      },
    ]);
  }

  @Get('liveness')
  @Public()
  @ApiOperation({ summary: 'Basic liveness probe' })
  liveness() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    };
  }
}
