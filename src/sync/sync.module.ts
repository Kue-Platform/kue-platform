import { Module } from '@nestjs/common';
import { SyncController } from './sync.controller';
import { SyncService } from './sync.service';
import { AuthModule } from '../auth/auth.module';
import { GoogleModule } from '../google/google.module';
import { GraphModule } from '../graph/graph.module';
import { InngestModule } from '../inngest/inngest.module';

@Module({
  imports: [AuthModule, GoogleModule, GraphModule, InngestModule],
  controllers: [SyncController],
  providers: [SyncService],
  exports: [SyncService],
})
export class SyncModule {}
