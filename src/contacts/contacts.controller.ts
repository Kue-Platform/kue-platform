import {
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
  HttpStatus,
  BadRequestException,
  Req,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
  ApiResponse,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';
import { AuthGuard } from '../common/guards/auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { ContactsService } from './contacts.service';
import { LoggerService } from '../observability/logger.service';

@ApiTags('Contacts')
@Controller('contacts')
@UseGuards(AuthGuard)
@ApiBearerAuth()
export class ContactsController {
  constructor(
    private readonly contacts: ContactsService,
    private readonly logger: LoggerService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List contacts with pagination' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page number (default: 1)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page (default: 50, max: 200)' })
  @ApiQuery({ name: 'sortBy', required: false, type: String, description: 'Sort field: name, strength, company (default: name)' })
  @ApiQuery({ name: 'search', required: false, type: String, description: 'Search query' })
  @ApiResponse({ status: 200, description: 'Paginated contact list' })
  async listContacts(
    @CurrentUser() user: AuthenticatedUser,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('sortBy') sortBy?: string,
    @Query('search') search?: string,
  ) {
    const parsedPage = Math.max(1, parseInt(page || '1', 10));
    const parsedLimit = Math.min(200, Math.max(1, parseInt(limit || '50', 10)));

    const result = await this.contacts.getContacts(user.id, {
      page: parsedPage,
      limit: parsedLimit,
      sortBy: sortBy || 'name',
      search,
    });

    return {
      statusCode: HttpStatus.OK,
      data: result.contacts,
      pagination: result.pagination,
    };
  }

  @Post('import')
  @ApiOperation({ summary: 'Import contacts from LinkedIn CSV' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'LinkedIn Connections CSV file',
        },
      },
    },
  })
  @ApiResponse({ status: 202, description: 'Import job created' })
  @ApiResponse({ status: 400, description: 'Invalid CSV file' })
  async importLinkedInCsv(
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: FastifyRequest,
  ) {
    // Handle multipart file upload with Fastify
    const data = await (request as any).file();

    if (!data) {
      throw new BadRequestException('No file uploaded. Please upload a CSV file.');
    }

    // Validate file type
    const filename = data.filename?.toLowerCase() || '';
    if (!filename.endsWith('.csv')) {
      throw new BadRequestException('Invalid file type. Please upload a .csv file.');
    }

    // Read file buffer
    const chunks: Buffer[] = [];
    for await (const chunk of data.file) {
      chunks.push(chunk);
    }
    const csvBuffer = Buffer.concat(chunks);

    // Validate file size (max 10MB)
    if (csvBuffer.length > 10 * 1024 * 1024) {
      throw new BadRequestException('File too large. Maximum size is 10MB.');
    }

    if (csvBuffer.length === 0) {
      throw new BadRequestException('File is empty.');
    }

    this.logger.info('LinkedIn CSV upload received', {
      userId: user.id,
      filename: data.filename,
      sizeBytes: csvBuffer.length,
    });

    try {
      const result = await this.contacts.importLinkedInCsv(
        user.id,
        user.email,
        csvBuffer,
      );

      return {
        statusCode: result.status === 'completed' ? HttpStatus.OK : HttpStatus.ACCEPTED,
        message:
          result.status === 'completed'
            ? `Import complete: ${result.contactsFound} contacts imported`
            : 'Import queued for processing',
        data: result,
      };
    } catch (error) {
      this.logger.error('LinkedIn CSV import failed', {
        userId: user.id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Failed to import CSV',
      );
    }
  }
}
