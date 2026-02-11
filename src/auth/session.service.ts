import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';
import type { SignOptions } from 'jsonwebtoken';
import { LoggerService } from '../observability/logger.service';

export interface SessionPayload {
    sub: string; // Supabase user ID
    email: string;
    name?: string;
    avatar_url?: string;
    iat?: number;
    exp?: number;
}

export interface SessionUser {
    id: string;
    email: string;
    name?: string;
    avatar_url?: string;
}

@Injectable()
export class SessionService {
    private readonly secret: string;
    private readonly expiresIn: string = '7d';

    constructor(
        private readonly config: ConfigService,
        private readonly logger: LoggerService,
    ) {
        const secretValue = this.config.get<string>('SESSION_SECRET');
        if (!secretValue) {
            throw new Error('SESSION_SECRET is not configured');
        }
        this.secret = secretValue;
    }

    /**
     * Create a new session token (JWT)
     */
    createSessionToken(user: SessionUser): string {
        const payload: SessionPayload = {
            sub: user.id,
            email: user.email,
            name: user.name,
            avatar_url: user.avatar_url,
        };

        const token = jwt.sign(payload, this.secret, {
            expiresIn: this.expiresIn,
        } as SignOptions);

        this.logger.info('Session token created', { userId: user.id });
        return token;
    }

    /**
     * Verify and decode a session token
     */
    verifySessionToken(token: string): SessionUser | null {
        try {
            const payload = jwt.verify(token, this.secret) as SessionPayload;

            return {
                id: payload.sub,
                email: payload.email,
                name: payload.name,
                avatar_url: payload.avatar_url,
            };
        } catch (error) {
            if (error instanceof jwt.TokenExpiredError) {
                this.logger.warn('Session token expired');
            } else if (error instanceof jwt.JsonWebTokenError) {
                this.logger.warn('Invalid session token');
            } else {
                this.logger.error('Session verification failed', {
                    error: error instanceof Error ? error.message : String(error),
                });
            }
            return null;
        }
    }

    /**
     * Decode token without verification (for debugging)
     */
    decodeToken(token: string): SessionPayload | null {
        try {
            return jwt.decode(token) as SessionPayload;
        } catch {
            return null;
        }
    }
}
