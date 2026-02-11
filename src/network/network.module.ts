import { Module } from '@nestjs/common';
import { NetworkController } from './network.controller';
import { NetworkService } from './network.service';
import { GraphModule } from '../graph/graph.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [GraphModule, AuthModule],
  controllers: [NetworkController],
  providers: [NetworkService],
  exports: [NetworkService],
})
export class NetworkModule { }
