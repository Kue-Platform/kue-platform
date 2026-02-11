import { IsEmail, IsNotEmpty, IsString, Length, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SendOtpDto {
    @ApiProperty({
        description: 'User email address',
        example: 'user@example.com',
    })
    @IsEmail()
    @IsNotEmpty()
    email: string;
}

export class VerifyOtpDto {
    @ApiProperty({
        description: 'User email address',
        example: 'user@example.com',
    })
    @IsEmail()
    @IsNotEmpty()
    email: string;

    @ApiProperty({
        description: '6-digit verification code',
        example: '123456',
        minLength: 6,
        maxLength: 6,
    })
    @IsString()
    @IsNotEmpty()
    @Length(6, 6, { message: 'Code must be exactly 6 digits' })
    code: string;
}

export class CheckEmailDto {
    @ApiProperty({
        description: 'Email address to check',
        example: 'user@example.com',
    })
    @IsEmail()
    @IsNotEmpty()
    email: string;
}

export class ExchangeSessionDto {
    @ApiProperty({
        description: 'Supabase access token',
        example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
    })
    @IsString()
    @IsNotEmpty()
    access_token: string;

    @ApiProperty({
        description: 'Supabase refresh token (optional)',
        example: '43c4w34...',
        required: false,
    })
    @IsString()
    @IsNotEmpty() // IsNotEmpty checks that if present, it's not empty string
    @IsOptional()
    refresh_token?: string;
}
