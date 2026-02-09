import { Module } from '@nestjs/common';
import { EnrichmentController } from './enrichment.controller';
import { EnrichmentService } from './enrichment.service';
import { PipelineModule } from '../pipeline/pipeline.module';

@Module({
  imports: [PipelineModule],
  controllers: [EnrichmentController],
  providers: [EnrichmentService],
  exports: [EnrichmentService],
})
export class EnrichmentModule {}
