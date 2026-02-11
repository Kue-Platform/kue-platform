import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Req,
  Res,
  UseGuards,
  HttpStatus,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import '@fastify/cookie';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery, ApiBody } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { SendOtpDto, VerifyOtpDto, CheckEmailDto, ExchangeSessionDto } from './dto/auth.dto';
import { AuthGuard } from '../common/guards/auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { LoggerService } from '../observability/logger.service';
import { SessionService } from './session.service';
import { ConfigService } from '@nestjs/config';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly sessionService: SessionService,
    private readonly config: ConfigService,
    private readonly logger: LoggerService,
  ) { }

  @Post('send-otp')
  @Public()
  @ApiOperation({ summary: 'Send OTP verification code to email (works for new and existing users)' })
  @ApiBody({ type: SendOtpDto })
  async sendOtp(@Body() dto: SendOtpDto) {
    try {
      const result = await this.authService.sendOtp(dto.email);
      return {
        statusCode: HttpStatus.OK,
        message: result.message,
        data: {
          email: dto.email,
          expiresIn: 3600, // 1 hour in seconds
        },
      };
    } catch (error) {
      this.logger.error('Failed to send OTP', {
        email: dto.email,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Failed to send verification code',
      };
    }
  }

  @Post('verify-otp')
  @Public()
  @ApiOperation({ summary: 'Verify OTP code and authenticate user' })
  @ApiBody({ type: VerifyOtpDto })
  async verifyOtp(
    @Body() dto: VerifyOtpDto,
    @Res({ passthrough: false }) reply: FastifyReply,
  ) {
    try {
      const result = await this.authService.verifyOtp(dto.email, dto.code);

      // Create app session token (consistent with Google OAuth flow)
      const sessionToken = this.sessionService.createSessionToken({
        id: result.user.id,
        email: result.user.email,
        name: undefined, // OTP doesn't provide name
        avatar_url: undefined,
      });

      // Set HTTP-only cookie
      reply.setCookie('session', sessionToken, {
        httpOnly: true,
        secure: this.config.get<string>('NODE_ENV') === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60, // 7 days
        path: '/',
      });

      this.logger.info('OTP verification successful', {
        userId: result.user.id,
        isNewUser: result.isNewUser,
      });

      return reply.send({
        statusCode: HttpStatus.OK,
        message: result.isNewUser ? 'Account created successfully' : 'Signed in successfully',
        data: {
          user: result.user,
          isNewUser: result.isNewUser,
        },
      });
    } catch (error) {
      this.logger.error('OTP verification failed', {
        email: dto.email,
        error: error instanceof Error ? error.message : String(error),
      });
      return reply.status(HttpStatus.UNAUTHORIZED).send({
        statusCode: HttpStatus.UNAUTHORIZED,
        message: error instanceof Error ? error.message : 'Invalid or expired verification code',
      });
    }
  }

  @Post('check-email')
  @Public()
  @ApiOperation({ summary: 'Check if email already exists (optional endpoint for UI)' })
  @ApiBody({ type: CheckEmailDto })
  async checkEmail(@Body() dto: CheckEmailDto) {
    const exists = await this.authService.checkEmailExists(dto.email);
    return {
      statusCode: HttpStatus.OK,
      data: {
        exists,
        message: exists ? 'Email is registered' : 'Email is available',
      },
    };
  }


  @Get('session')
  @Public()
  @ApiOperation({ summary: 'Get current session user' })
  async getSession(@Req() request: FastifyRequest) {
    const sessionToken = request.cookies?.session;

    if (!sessionToken) {
      return {
        statusCode: HttpStatus.UNAUTHORIZED,
        message: 'No session found',
        data: { user: null },
      };
    }

    const user = this.sessionService.verifySessionToken(sessionToken);

    if (!user) {
      return {
        statusCode: HttpStatus.UNAUTHORIZED,
        message: 'Invalid or expired session',
        data: { user: null },
      };
    }

    return {
      statusCode: HttpStatus.OK,
      data: { user },
    };
  }

  @Post('logout')
  @Public()
  @ApiOperation({ summary: 'Logout and clear session' })
  async logout(@Res({ passthrough: false }) reply: FastifyReply) {
    reply.clearCookie('session', { path: '/' });

    return reply.send({
      statusCode: HttpStatus.OK,
      message: 'Logged out successfully',
    });
  }

  // ==================== Supabase OAuth (Authentication) ====================

  @Post('session')
  @Public()
  @ApiOperation({ summary: 'Exchange Supabase access token for backend session' })
  @ApiBody({ type: ExchangeSessionDto })
  async exchangeSession(
    @Body() dto: ExchangeSessionDto,
    @Res({ passthrough: false }) reply: FastifyReply,
  ) {
    try {
      const result = await this.authService.exchangeSession(dto.access_token);

      // Create app session token
      const sessionToken = this.sessionService.createSessionToken({
        id: result.user.id,
        email: result.user.email,
        name: undefined,
        avatar_url: undefined,
      });

      // Set HTTP-only cookie
      reply.setCookie('session', sessionToken, {
        httpOnly: true,
        secure: this.config.get<string>('NODE_ENV') === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60, // 7 days
        path: '/',
      });

      return reply.send({
        statusCode: HttpStatus.OK,
        message: 'Session created successfully',
        data: {
          user: result.user,
          isNewUser: result.isNewUser,
        },
      });
    } catch (error) {
      this.logger.error('Session exchange failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return reply.status(HttpStatus.UNAUTHORIZED).send({
        statusCode: HttpStatus.UNAUTHORIZED,
        message: error instanceof Error ? error.message : 'Invalid session exchange',
      });
    }
  }

  @Get('signin/google')
  @Public()
  @ApiOperation({ summary: 'Get Supabase Google OAuth sign-in URL' })
  @ApiQuery({
    name: 'redirectTo',
    required: false,
    description: 'URL to redirect to after login (defaults to http://localhost:8081/)'
  })
  async getGoogleSignInUrl(@Query('redirectTo') redirectTo?: string) {
    const url = await this.authService.getGoogleSignInUrl(redirectTo);
    return { url };
  }

  // ==================== Google OAuth (Data Sync) ====================

  @Get('google')
  @Public()
  @ApiOperation({ summary: 'Get Google OAuth consent URL for data sync (Gmail/Calendar/Contacts)' })
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
