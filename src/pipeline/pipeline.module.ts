import { Module } from '@nestjs/common';
import { DedupService } from './dedup.service';
import { ScoringService } from './scoring.service';

@Module({
  providers: [DedupService, ScoringService],
  exports: [DedupService, ScoringService],
})
export class PipelineModule {}
