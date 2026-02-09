import { Module } from '@nestjs/common';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';
import { CypherBuilderService } from './cypher-builder.service';
import { QueryParserChain } from '../ai/chains/query-parser.chain';
import { ResultFormatterChain } from '../ai/chains/result-formatter.chain';

@Module({
  controllers: [SearchController],
  providers: [
    SearchService,
    CypherBuilderService,
    QueryParserChain,
    ResultFormatterChain,
  ],
  exports: [SearchService],
})
export class SearchModule {}
