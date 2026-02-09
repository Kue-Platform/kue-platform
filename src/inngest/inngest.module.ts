import { Module } from '@nestjs/common';
import { InngestController } from './inngest.controller';
import { InngestService } from './inngest.service';

@Module({
  controllers: [InngestController],
  providers: [InngestService],
  exports: [InngestService],
})
export class InngestModule {}
