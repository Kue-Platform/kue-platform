import { Global, Module } from '@nestjs/common';
import { Neo4jService } from './neo4j.service';
import { SupabaseService } from './supabase.service';
import { RedisService } from './redis.service';

@Global()
@Module({
  providers: [Neo4jService, SupabaseService, RedisService],
  exports: [Neo4jService, SupabaseService, RedisService],
})
export class DatabaseModule {}
