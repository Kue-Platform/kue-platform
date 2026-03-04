# Kue Platform API Documentation

**Version**: 0.1.0
**Base URL (Development)**: `http://localhost:3000`

## Scope

This API now contains only authentication and Google account connection endpoints:

1. Email OTP login
2. Google sign-in (Supabase OAuth)
3. Google account connect for sync scopes (Gmail/Contacts/Calendar)
4. Session and logout endpoints

For the complete flow narrative, see [AUTH_LOGIN_FLOW.md](./AUTH_LOGIN_FLOW.md).

## Database Model (Current)

Auth integration uses:

- `tenants`
- `tenant_users`
- `source_connections`
- `sync_checkpoints`

## Authentication Model

Protected endpoints accept one of:

1. HTTP-only `session` cookie (recommended for browser clients)
2. `Authorization: Bearer <supabase_access_token>`

## Endpoints

### 1) Send OTP

```bash
POST /auth/send-otp
Content-Type: application/json
```

```json
{
  "email": "user@example.com"
}
```

Success (`200`):

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

### 2) Verify OTP

```bash
POST /auth/verify-otp
Content-Type: application/json
```

```json
{
  "email": "user@example.com",
  "code": "123456"
}
```

Success (`200`) sets backend `session` cookie:

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

### 3) Google Sign-In URL (Supabase OAuth)

```bash
GET /auth/signin/google?redirectTo=http://localhost:8081/
```

```json
{
  "url": "https://<supabase-auth-url>"
}
```

### 4) Exchange Supabase token for backend session

```bash
POST /auth/session
Content-Type: application/json
```

```json
{
  "access_token": "SUPABASE_ACCESS_TOKEN"
}
```

Success (`200`) sets backend `session` cookie.

### 5) Google Connect URL (for sync scopes)

```bash
GET /auth/google
Authorization: Bearer YOUR_ACCESS_TOKEN
```

or cookie-authenticated request from browser with `credentials: include`.

```json
{
  "url": "https://accounts.google.com/o/oauth2/v2/auth?..."
}
```

### 6) Google callback

```bash
GET /auth/callback?code=AUTH_CODE&state=SIGNED_STATE
```

Success (`200`):

```json
{
  "statusCode": 200,
  "message": "Google account connected successfully",
  "data": {
    "scopes": [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/contacts.readonly",
      "https://www.googleapis.com/auth/calendar.readonly"
    ],
    "expiresAt": "2026-02-12T03:41:45.000Z"
  }
}
```

### 7) Connection status

```bash
GET /auth/status
Authorization: Bearer YOUR_ACCESS_TOKEN
```

```json
{
  "google": {
    "connected": true
  }
}
```

### 8) Session user

```bash
GET /auth/session
```

### 9) Logout

```bash
POST /auth/logout
```

## Frontend Notes

- For cookie-based auth, use `credentials: 'include'`.
- For Google sign-in, frontend gets Supabase token from callback page via `supabase.auth.getSession()` and sends it to `POST /auth/session`.
