import {
  Controller,
  Get,
  Query,
  UseGuards,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
  ApiResponse,
} from '@nestjs/swagger';
import { AuthGuard } from '../common/guards/auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { SearchService } from './search.service';

@ApiTags('Search')
@Controller('search')
@UseGuards(AuthGuard)
@ApiBearerAuth()
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get()
  @ApiOperation({
    summary: 'Search your professional network using natural language',
    description:
      'Parses natural language queries into structured searches against your contact graph. ' +
      'Supports person search, company search, relationship queries, and intro path finding.',
  })
  @ApiQuery({
    name: 'q',
    required: true,
    type: String,
    description: 'Natural language search query (e.g., "engineers at Google", "who can introduce me to Sarah?")',
  })
  @ApiQuery({
    name: 'format',
    required: false,
    type: Boolean,
    description: 'Include LLM-generated summary (default: true). Set false for faster responses.',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: 'Page number (default: 1)',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Results per page (default: 20, max: 50)',
  })
  @ApiResponse({ status: 200, description: 'Search results with parsed intent and summary' })
  @ApiResponse({ status: 400, description: 'Missing query parameter' })
  async search(
    @CurrentUser() user: AuthenticatedUser,
    @Query('q') q: string,
    @Query('format') format?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    if (!q || q.trim().length === 0) {
      throw new BadRequestException('Query parameter "q" is required');
    }

    if (q.trim().length > 500) {
      throw new BadRequestException('Query must be 500 characters or less');
    }

    const parsedLimit = limit ? Math.min(parseInt(limit, 10), 50) : 20;
    const parsedPage = page ? Math.max(parseInt(page, 10), 1) : 1;
    const shouldFormat = format !== 'false';

    const result = await this.searchService.search(q.trim(), user.id, {
      format: shouldFormat,
      page: parsedPage,
      limit: parsedLimit,
    });

    return {
      statusCode: HttpStatus.OK,
      data: {
        query: result.query,
        intent: result.intent,
        results: result.results,
        totalResults: result.totalResults,
        summary: result.summary,
        cached: result.cached,
        page: parsedPage,
        limit: parsedLimit,
        totalPages: Math.ceil(result.totalResults / parsedLimit),
      },
      timings: result.timings,
    };
  }

  @Get('quick')
  @ApiOperation({
    summary: 'Quick search for autocomplete/typeahead',
    description: 'Fast search without LLM formatting. Returns raw results only.',
  })
  @ApiQuery({ name: 'q', required: true, type: String, description: 'Search query' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Max results (default: 10)' })
  @ApiResponse({ status: 200, description: 'Quick search results' })
  async quickSearch(
    @CurrentUser() user: AuthenticatedUser,
    @Query('q') q: string,
    @Query('limit') limit?: string,
  ) {
    if (!q || q.trim().length === 0) {
      throw new BadRequestException('Query parameter "q" is required');
    }

    const parsedLimit = limit ? Math.min(parseInt(limit, 10), 20) : 10;

    const result = await this.searchService.quickSearch(q.trim(), user.id, parsedLimit);

    return {
      statusCode: HttpStatus.OK,
      data: result,
    };
  }

  @Get('suggestions')
  @ApiOperation({
    summary: 'Get personalized search suggestions',
    description: 'Returns suggested queries based on your network composition.',
  })
  @ApiResponse({ status: 200, description: 'Search suggestions' })
  async getSuggestions(@CurrentUser() user: AuthenticatedUser) {
    const suggestions = await this.searchService.getSuggestions(user.id);

    return {
      statusCode: HttpStatus.OK,
      data: { suggestions },
    };
  }
}
