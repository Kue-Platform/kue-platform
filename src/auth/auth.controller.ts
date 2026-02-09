import {
  Controller,
  Get,
  Query,
  Req,
  Res,
  UseGuards,
  HttpStatus,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { AuthGuard } from '../common/guards/auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { LoggerService } from '../observability/logger.service';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly logger: LoggerService,
  ) {}

  @Get('google')
  @Public()
  @ApiOperation({ summary: 'Get Google OAuth consent URL' })
  @ApiQuery({ name: 'state', required: false, description: 'Optional state parameter (user ID or redirect URL)' })
  getGoogleAuthUrl(@Query('state') state?: string) {
    const url = this.authService.getGoogleAuthUrl(state);
    return { url };
  }

  @Get('callback')
  @Public()
  @ApiOperation({ summary: 'Handle Google OAuth callback' })
  @ApiQuery({ name: 'code', required: true, description: 'Authorization code from Google' })
  @ApiQuery({ name: 'state', required: false, description: 'State parameter containing user ID' })
  async handleCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() reply: FastifyReply,
  ) {
    if (!code) {
      return reply.status(HttpStatus.BAD_REQUEST).send({
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'Missing authorization code',
      });
    }

    if (!state) {
      return reply.status(HttpStatus.BAD_REQUEST).send({
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'Missing state parameter (user ID)',
      });
    }

    try {
      // The state parameter should contain the user ID
      const userId = state;
      const tokens = await this.authService.handleGoogleCallback(code, userId);

      this.logger.info('OAuth callback successful', { userId });

      return reply.status(HttpStatus.OK).send({
        statusCode: HttpStatus.OK,
        message: 'Google account connected successfully',
        data: {
          scopes: tokens.scopes,
          expiresAt: tokens.expiresAt,
        },
      });
    } catch (error) {
      this.logger.error('OAuth callback failed', {
        error: error instanceof Error ? error.message : String(error),
      });

      return reply.status(HttpStatus.INTERNAL_SERVER_ERROR).send({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Failed to connect Google account',
      });
    }
  }

  @Get('status')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Check connected account status' })
  async getConnectionStatus(@CurrentUser() user: AuthenticatedUser) {
    const hasGoogle = await this.authService.hasGoogleConnection(user.id);

    return {
      google: {
        connected: hasGoogle,
      },
    };
  }
}
