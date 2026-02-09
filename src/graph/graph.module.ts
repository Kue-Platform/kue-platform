import { Module } from '@nestjs/common';
import { GraphService } from './graph.service';
import { TraverseService } from './traverse.service';

@Module({
  providers: [GraphService, TraverseService],
  exports: [GraphService, TraverseService],
})
export class GraphModule {}
