import { Module } from '@nestjs/common';
import { ContactsController } from './contacts.controller';
import { ContactsService } from './contacts.service';
import { GraphModule } from '../graph/graph.module';
import { LinkedinModule } from '../linkedin/linkedin.module';
import { PipelineModule } from '../pipeline/pipeline.module';
import { InngestModule } from '../inngest/inngest.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [GraphModule, LinkedinModule, PipelineModule, InngestModule, AuthModule],
  controllers: [ContactsController],
  providers: [ContactsService],
  exports: [ContactsService],
})
export class ContactsModule { }
