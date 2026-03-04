# Kue Platform (Auth-Only)

Kue Platform is now scoped to authentication and Google account connection only.

## Included Features

1. Email OTP login (`/auth/send-otp`, `/auth/verify-otp`)
2. Google sign-in for app auth via Supabase OAuth (`/auth/signin/google`, `/auth/session`)
3. Google account connection for sync permissions (`/auth/google`, `/auth/callback`)
4. Session management (`/auth/session`, `/auth/logout`, `/auth/status`)

## Docs

- API reference: [API_DOCUMENTATION.md](./API_DOCUMENTATION.md)
- Full flow details: [AUTH_LOGIN_FLOW.md](./AUTH_LOGIN_FLOW.md)

## Setup

```bash
cp .env.example .env
npm install
npm run start:dev
```

## Required Environment Variables

- `SESSION_SECRET`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI` (must match Google OAuth redirect URI)
- `FRONTEND_URL`

## Run

```bash
npm run build
npm run start:prod
```
