# Authentication and Login Flow

This document is the source of truth for authentication in this project.

## Overview

The backend supports 3 related flows:

1. Email OTP login (passwordless).
2. Google sign-in for account authentication (via Supabase OAuth).
3. Google account connection for data sync (Gmail, Contacts, Calendar scopes).

The backend uses an HTTP-only `session` cookie for app session continuity after login.

## Tenant Model

This project now uses multi-tenant auth tables:

- `tenants`
- `tenant_users`
- `source_connections`
- `sync_checkpoints`

On successful login, backend attempts to auto-provision a default workspace for the user (`tenant_<userId>`) and a `tenant_users` membership row.

## Session Model

- Cookie name: `session`
- Cookie type: JWT signed with `SESSION_SECRET`
- Cookie lifetime: 7 days
- Cookie flags:
  - `httpOnly: true`
  - `sameSite: "lax"`
  - `secure: true` in production
  - `path: "/"`

Protected endpoints accept either:

- `session` cookie, or
- `Authorization: Bearer <supabase_access_token>`

## Flow 1: Email OTP Login

### Step 1: Send OTP

`POST /auth/send-otp`

Request:

```json
{
  "email": "user@example.com"
}
```

Response `200`:

```json
{
  "statusCode": 200,
  "message": "Verification code sent to your email",
  "data": {
    "email": "user@example.com",
    "expiresIn": 3600
  }
}
```

Response `500` (example):

```json
{
  "statusCode": 500,
  "message": "Failed to send verification code"
}
```

### Step 2: Verify OTP

`POST /auth/verify-otp`

Request:

```json
{
  "email": "user@example.com",
  "code": "123456"
}
```

Response `200`:

```json
{
  "statusCode": 200,
  "message": "Signed in successfully",
  "data": {
    "user": {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "email": "user@example.com",
      "createdAt": "2026-02-11T03:00:00.000Z"
    },
    "isNewUser": false
  }
}
```

Notes:

- On success, backend sets `session` cookie.
- Backend does not return app access/refresh tokens in this endpoint response.

Response `401` (example):

```json
{
  "statusCode": 401,
  "message": "Invalid or expired verification code"
}
```

### Step 3: Read Session

`GET /auth/session`

Response `200`:

```json
{
  "statusCode": 200,
  "data": {
    "user": {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "email": "user@example.com"
    }
  }
}
```

Response `401` when missing/expired session.

### Step 4: Logout

`POST /auth/logout`

Clears `session` cookie.

## Flow 2: Google Sign-In (Supabase OAuth for Authentication)

Use this when user wants to sign in to the app with Google.

### Step 1: Get Google sign-in URL

`GET /auth/signin/google?redirectTo=<frontend-url>`

Response:

```json
{
  "url": "https://<supabase-auth-url>"
}
```

### Step 2: Frontend completes Supabase OAuth

Frontend receives Supabase `access_token` and then calls backend:

How frontend gets the `supabase_access_token`:

1. Frontend redirects user to URL returned by `GET /auth/signin/google`.
2. Supabase Auth completes Google login and redirects to your `redirectTo` page.
3. On that callback page, frontend reads the Supabase session and extracts `session.access_token`.
4. Frontend sends that token to backend `POST /auth/session`.

Example callback-page code:

```ts
const { data, error } = await supabase.auth.getSession();
if (error || !data.session?.access_token) {
  throw new Error('Missing Supabase session');
}

await fetch('/auth/session', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  credentials: 'include',
  body: JSON.stringify({ access_token: data.session.access_token }),
});
```

`POST /auth/session`

Request:

```json
{
  "access_token": "<supabase_access_token>"
}
```

Response `200`:

```json
{
  "statusCode": 200,
  "message": "Session created successfully",
  "data": {
    "user": {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "email": "user@example.com",
      "createdAt": "2026-02-11T03:00:00.000Z"
    },
    "isNewUser": false
  }
}
```

Notes:

- On success, backend sets `session` cookie.

## Flow 3: Google Connect (for Gmail/Contacts/Calendar Sync)

Use this after user is already authenticated in the app.

### Step 1: Get Google consent URL (authenticated)

`GET /auth/google`

Auth required (`session` cookie or `Authorization` header).

Backend generates OAuth URL with scopes:

- `gmail.readonly`
- `contacts.readonly`
- `calendar.readonly`
- `userinfo.email`
- `userinfo.profile`

The backend signs and embeds a short-lived OAuth `state` token for callback validation.

### Step 2: Google callback

`GET /auth/callback?code=<auth_code>&state=<signed_state>`

Behavior:

- Validates `state` signature and expiry.
- Exchanges code for Google tokens.
- Stores tokens in `connected_accounts` for the authenticated user.

Response `200`:

```json
{
  "statusCode": 200,
  "message": "Google account connected successfully",
  "data": {
    "scopes": [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/contacts.readonly"
    ],
    "expiresAt": "2026-02-12T03:41:45.000Z"
  }
}
```

Response `400` on invalid or expired `state`.

### Step 3: Check connection status

`GET /auth/status`

Auth required.

Response:

```json
{
  "google": {
    "connected": true
  }
}
```

## CORS and Frontend Requirements

- Frontend must send credentials for cookie-based auth (`credentials: "include"`).
- Backend CORS `credentials` is enabled in `src/main.ts`.
- Allowed origins are configured through `FRONTEND_URL` and explicit local/production URLs.

## Security Notes

- Google sync callback now requires signed `state` to mitigate CSRF/account-linking risks.
- Google connect endpoint (`/auth/google`) requires authentication.
- Session cookie is HTTP-only and not accessible from browser JS.
