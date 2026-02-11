# Kue Platform API Documentation

**Version**: 0.1.0  
**Base URL (Production)**: `https://kue-platform.vercel.app`  
**Base URL (Development)**: `http://localhost:3000`

---

## Table of Contents

1. [Overview](#overview)
2. [Authentication](#authentication)
3. [API Endpoints](#api-endpoints)
   - [Health](#health)
   - [Auth](#auth)
   - [Sync](#sync)
   - [Contacts](#contacts)
   - [Search](#search)
   - [Network](#network)
   - [Enrichment](#enrichment)
4. [Error Handling](#error-handling)
5. [Rate Limiting](#rate-limiting)
6. [Integration Guide](#integration-guide)

---

## Overview

Kue Platform is a **Professional Network Intelligence API** that provides:

- 🔐 **OAuth 2.0 Authentication** via Google
- 📧 **Contact Synchronization** from Gmail, Google Contacts, and Calendar
- 🔍 **Natural Language Search** powered by AI
- 🕸️ **Graph Database** for relationship intelligence
- 🤖 **AI-Powered Enrichment** for contact data
- 🔗 **Introduction Path Finding** through your network

---

## Authentication

Kue Platform supports **two authentication methods**:

1. **OTP (Passwordless) Authentication** - For user sign-in and sign-up (recommended)
2. **API Key (Bearer Token)** - For accessing protected endpoints after authentication

### OTP Authentication Flow (Sign In / Sign Up)

The platform uses a unified OTP flow that works for both new and existing users.

#### Step 1: Send OTP Code

```bash
POST /auth/send-otp
Content-Type: application/json
```

**Request Body:**
```json
{
  "email": "user@example.com"
}
```

**Response (200 OK):**
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

**Frontend Integration:**
```javascript
const sendOtp = async (email) => {
  const response = await fetch('https://kue-platform.vercel.app/auth/send-otp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email }),
  });
  
  return await response.json();
};
```

#### Step 2: Verify OTP Code

```bash
POST /auth/verify-otp
Content-Type: application/json
```

**Request Body:**
```json
{
  "email": "user@example.com",
  "code": "123456"
}
```

**Response (200 OK):**
```json
{
  "statusCode": 200,
  "message": "Signed in successfully",
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "v1.MjB8MTY...",
    "user": {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "email": "user@example.com",
      "createdAt": "2026-02-11T03:00:00.000Z"
    },
    "isNewUser": false
  }
}
```

**Frontend Integration:**
```javascript
const verifyOtp = async (email, code) => {
  const response = await fetch('https://kue-platform.vercel.app/auth/verify-otp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, code }),
  });
  
  const result = await response.json();
  
  if (result.statusCode === 200) {
    // Store tokens
    localStorage.setItem('accessToken', result.data.accessToken);
    localStorage.setItem('refreshToken', result.data.refreshToken);
    
    // Redirect to dashboard
    window.location.href = '/dashboard';
  }
  
  return result;
};
```

**Error Response (401 Unauthorized):**
```json
{
  "statusCode": 401,
  "message": "Invalid or expired verification code"
}
```

#### Step 3: Check Email (Optional)

For UI purposes, you can check if an email is already registered:

```bash
POST /auth/check-email
Content-Type: application/json
```

**Request Body:**
```json
{
  "email": "user@example.com"
}
```

**Response:**
```json
{
  "statusCode": 200,
  "data": {
    "exists": true,
    "message": "Email is registered"
  }
}
```

### Authentication Header

After successful OTP verification, use the access token for all protected endpoints:

```http
Authorization: Bearer YOUR_ACCESS_TOKEN
```

### Google OAuth Flow

To connect a user's Google account for data synchronization:

#### Step 1: Get OAuth Consent URL

```bash
GET /auth/google?state=USER_ID
```

**Query Parameters:**
- `state` (optional): User ID or redirect URL to maintain state

**Response:**
```json
{
  "url": "https://accounts.google.com/o/oauth2/v2/auth?client_id=..."
}
```

**Frontend Integration:**
```javascript
// Get the OAuth URL
const response = await fetch('https://kue-platform.vercel.app/auth/google?state=user123');
const { url } = await response.json();

// Redirect user to Google OAuth
window.location.href = url;
```

#### Step 2: Handle OAuth Callback

After user authorizes, Google redirects to `/auth/callback` with a code.

```bash
GET /auth/callback?code=AUTH_CODE&state=USER_ID
```

**Query Parameters:**
- `code` (required): Authorization code from Google
- `state` (required): User ID

**Response:**
```json
{
  "statusCode": 200,
  "message": "Google account connected successfully",
  "data": {
    "scopes": ["https://www.googleapis.com/auth/gmail.readonly", "..."],
    "expiresAt": "2026-02-12T03:41:45.000Z"
  }
}
```

#### Step 3: Check Connection Status

```bash
GET /auth/status
Authorization: Bearer YOUR_API_KEY
```

**Response:**
```json
{
  "google": {
    "connected": true
  }
}
```

---

## API Endpoints

### Health

#### Check System Health

```bash
GET /health
```

**Public endpoint** (no authentication required)

**Response:**
```json
{
  "status": "ok",
  "info": {
    "neo4j": { "status": "up" },
    "supabase": { "status": "up" },
    "redis": { "status": "up" }
  },
  "error": {},
  "details": {
    "neo4j": { "status": "up" },
    "supabase": { "status": "up" },
    "redis": { "status": "up" }
  }
}
```

#### Liveness Probe

```bash
GET /health/liveness
```

**Public endpoint**

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2026-02-11T03:41:45.123Z",
  "uptime": 892134.567
}
```

---

### Auth

#### Send OTP Code

```bash
POST /auth/send-otp
Content-Type: application/json
```

**Request Body:**
```json
{
  "email": "user@example.com"
}
```

**Response:**
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

**Use Case:** Send a 6-digit verification code for passwordless authentication (works for both new and existing users).

---

#### Verify OTP Code

```bash
POST /auth/verify-otp
Content-Type: application/json
```

**Request Body:**
```json
{
  "email": "user@example.com",
  "code": "123456"
}
```

**Response (Success):**
```json
{
  "statusCode": 200,
  "message": "Signed in successfully",
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "v1.MjB8MTY...",
    "user": {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "email": "user@example.com",
      "createdAt": "2026-02-11T03:00:00.000Z"
    },
    "isNewUser": false
  }
}
```

**Error Response (401):**
```json
{
  "statusCode": 401,
  "message": "Invalid or expired verification code"
}
```

**Use Case:** Verify the OTP code and authenticate the user. Returns access and refresh tokens for subsequent API calls.

---

#### Check Email Existence

```bash
POST /auth/check-email
Content-Type: application/json
```

**Request Body:**
```json
{
  "email": "user@example.com"
}
```

**Response:**
```json
{
  "statusCode": 200,
  "data": {
    "exists": true,
    "message": "Email is registered"
  }
}
```

**Use Case:** Optional endpoint to check if an email is already registered (useful for showing different UI text).

---

#### Get Google OAuth URL

```bash
GET /auth/google?state=USER_ID
```

See [Authentication](#authentication) section for details.

#### OAuth Callback Handler

```bash
GET /auth/callback?code=AUTH_CODE&state=USER_ID
```

See [Authentication](#authentication) section for details.

#### Get Connection Status

```bash
GET /auth/status
Authorization: Bearer YOUR_API_KEY
```

**Response:**
```json
{
  "google": {
    "connected": true
  }
}
```

---

### Sync

All sync endpoints require authentication.

#### Trigger Gmail Sync

```bash
POST /sync/gmail?incremental=false
Authorization: Bearer YOUR_API_KEY
```

**Query Parameters:**
- `incremental` (optional, boolean): Use incremental sync. Default: `false`

**Response (202 Accepted):**
```json
{
  "statusCode": 202,
  "message": "Gmail sync queued",
  "data": {
    "jobId": "550e8400-e29b-41d4-a716-446655440000",
    "isIncremental": false
  }
}
```

**Frontend Integration:**
```javascript
const syncGmail = async (apiKey, incremental = false) => {
  const response = await fetch(
    `https://kue-platform.vercel.app/sync/gmail?incremental=${incremental}`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`
      }
    }
  );
  
  const result = await response.json();
  console.log('Job ID:', result.data.jobId);
  return result.data.jobId;
};
```

#### Trigger Google Contacts Sync

```bash
POST /sync/contacts?incremental=false
Authorization: Bearer YOUR_API_KEY
```

**Query Parameters:**
- `incremental` (optional, boolean): Use incremental sync. Default: `false`

**Response (202 Accepted):**
```json
{
  "statusCode": 202,
  "message": "Google Contacts sync queued",
  "data": {
    "jobId": "550e8400-e29b-41d4-a716-446655440001",
    "isIncremental": false
  }
}
```

#### Trigger Google Calendar Sync

```bash
POST /sync/calendar?incremental=false
Authorization: Bearer YOUR_API_KEY
```

**Query Parameters:**
- `incremental` (optional, boolean): Use incremental sync. Default: `false`

**Response (202 Accepted):**
```json
{
  "statusCode": 202,
  "message": "Calendar sync queued",
  "data": {
    "jobId": "550e8400-e29b-41d4-a716-446655440002",
    "isIncremental": false
  }
}
```

#### Get Sync Job History

```bash
GET /sync/jobs?limit=20
Authorization: Bearer YOUR_API_KEY
```

**Query Parameters:**
- `limit` (optional, number): Max results. Default: `20`

**Response:**
```json
{
  "statusCode": 200,
  "data": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "user_id": "user123",
      "sync_type": "gmail_contacts",
      "status": "completed",
      "created_at": "2026-02-11T03:00:00.000Z",
      "completed_at": "2026-02-11T03:05:30.000Z",
      "error": null,
      "metadata": {
        "contactsProcessed": 156,
        "newContacts": 12,
        "updatedContacts": 8
      }
    }
  ]
}
```

#### Get Sync Job Status

```bash
GET /sync/jobs/status?jobId=JOB_ID
Authorization: Bearer YOUR_API_KEY
```

**Query Parameters:**
- `jobId` (required, string): Sync job ID

**Response:**
```json
{
  "statusCode": 200,
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "user_id": "user123",
    "sync_type": "gmail_contacts",
    "status": "in_progress",
    "created_at": "2026-02-11T03:00:00.000Z",
    "completed_at": null,
    "error": null,
    "metadata": {
      "currentProgress": "65%"
    }
  }
}
```

**Job Statuses:**
- `queued`: Job is waiting to be processed
- `in_progress`: Job is currently running
- `completed`: Job finished successfully
- `failed`: Job encountered an error

---

### Contacts

#### List Contacts

```bash
GET /contacts?page=1&limit=50&sortBy=name&search=john
Authorization: Bearer YOUR_API_KEY
```

**Query Parameters:**
- `page` (optional, number): Page number. Default: `1`
- `limit` (optional, number): Items per page (max: 200). Default: `50`
- `sortBy` (optional, string): Sort field (`name`, `strength`, `company`). Default: `name`
- `search` (optional, string): Search query

**Response:**
```json
{
  "statusCode": 200,
  "data": [
    {
      "id": "person_abc123",
      "name": "John Doe",
      "email": "john.doe@example.com",
      "company": "Google",
      "title": "Software Engineer",
      "relationshipStrength": 85,
      "lastInteraction": "2026-01-15T10:30:00.000Z",
      "enriched": true,
      "profileUrl": "https://linkedin.com/in/johndoe"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 50,
    "total": 245,
    "totalPages": 5
  }
}
```

**Frontend Integration:**
```javascript
const fetchContacts = async (apiKey, page = 1, search = '') => {
  const params = new URLSearchParams({
    page: page.toString(),
    limit: '50',
    sortBy: 'name'
  });
  
  if (search) {
    params.append('search', search);
  }
  
  const response = await fetch(
    `https://kue-platform.vercel.app/contacts?${params}`,
    {
      headers: {
        'Authorization': `Bearer ${apiKey}`
      }
    }
  );
  
  return await response.json();
};
```

#### Import LinkedIn CSV

```bash
POST /contacts/import
Authorization: Bearer YOUR_API_KEY
Content-Type: multipart/form-data
```

**Request Body:**
- `file`: LinkedIn Connections CSV file (max 10MB)

**Response (202 Accepted):**
```json
{
  "statusCode": 202,
  "message": "Import queued for processing",
  "data": {
    "status": "queued",
    "contactsFound": 0,
    "jobId": "import_550e8400"
  }
}
```

**Frontend Integration:**
```javascript
const importLinkedInCSV = async (apiKey, file) => {
  const formData = new FormData();
  formData.append('file', file);
  
  const response = await fetch(
    'https://kue-platform.vercel.app/contacts/import',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`
      },
      body: formData
    }
  );
  
  return await response.json();
};
```

---

### Search

#### Natural Language Search

```bash
GET /search?q=engineers%20at%20Google&format=true&page=1&limit=20
Authorization: Bearer YOUR_API_KEY
```

**Query Parameters:**
- `q` (required, string): Natural language search query (max 500 chars)
- `format` (optional, boolean): Include LLM-generated summary. Default: `true`
- `page` (optional, number): Page number. Default: `1`
- `limit` (optional, number): Results per page (max: 50). Default: `20`

**Example Queries:**
- `"engineers at Google"`
- `"who can introduce me to Sarah?"`
- `"people working in AI"`
- `"contacts at startups in San Francisco"`

**Response:**
```json
{
  "statusCode": 200,
  "data": {
    "query": "engineers at Google",
    "intent": {
      "type": "person_search",
      "filters": {
        "company": "Google",
        "title": "engineer"
      }
    },
    "results": [
      {
        "id": "person_xyz789",
        "name": "Jane Smith",
        "email": "jane@google.com",
        "company": "Google",
        "title": "Senior Software Engineer",
        "relationshipStrength": 92,
        "relevanceScore": 0.95
      }
    ],
    "totalResults": 12,
    "summary": "You have 12 connections who are engineers at Google. Your strongest connection is Jane Smith (relationship strength: 92).",
    "cached": false,
    "page": 1,
    "limit": 20,
    "totalPages": 1
  },
  "timings": {
    "total": 1234,
    "llm": 890,
    "database": 344
  }
}
```

**Frontend Integration:**
```javascript
const searchNetwork = async (apiKey, query, { page = 1, format = true } = {}) => {
  const params = new URLSearchParams({
    q: query,
    format: format.toString(),
    page: page.toString(),
    limit: '20'
  });
  
  const response = await fetch(
    `https://kue-platform.vercel.app/search?${params}`,
    {
      headers: {
        'Authorization': `Bearer ${apiKey}`
      }
    }
  );
  
  return await response.json();
};
```

#### Quick Search (Autocomplete)

```bash
GET /search/quick?q=john&limit=10
Authorization: Bearer YOUR_API_KEY
```

**Query Parameters:**
- `q` (required, string): Search query
- `limit` (optional, number): Max results (max: 20). Default: `10`

**Response:**
```json
{
  "statusCode": 200,
  "data": [
    {
      "id": "person_abc123",
      "name": "John Doe",
      "email": "john@example.com",
      "company": "Google",
      "title": "Software Engineer"
    }
  ]
}
```

**Use case:** Typeahead/autocomplete in search bars

#### Get Search Suggestions

```bash
GET /search/suggestions
Authorization: Bearer YOUR_API_KEY
```

**Response:**
```json
{
  "statusCode": 200,
  "data": {
    "suggestions": [
      "engineers at Google",
      "people working in AI",
      "contacts at Microsoft",
      "product managers in San Francisco"
    ]
  }
}
```

**Use case:** Show suggested searches based on the user's network composition

---

### Network

#### Get Network Overview

```bash
GET /network
Authorization: Bearer YOUR_API_KEY
```

**Response:**
```json
{
  "statusCode": 200,
  "data": {
    "totalContacts": 456,
    "companiesRepresented": 89,
    "averageRelationshipStrength": 67.5,
    "topCompanies": [
      { "name": "Google", "count": 23 },
      { "name": "Microsoft", "count": 18 },
      { "name": "Meta", "count": 15 }
    ],
    "topTitles": [
      { "title": "Software Engineer", "count": 45 },
      { "title": "Product Manager", "count": 28 }
    ],
    "recentInteractions": 145,
    "networkGrowth": {
      "last30Days": 12,
      "last90Days": 34
    }
  }
}
```

#### Get Second-Degree Connections

```bash
GET /network/second-degree?limit=20&minStrength=50
Authorization: Bearer YOUR_API_KEY
```

**Query Parameters:**
- `limit` (optional, number): Max results. Default: `20`
- `minStrength` (optional, number): Minimum relationship strength (0-100). Default: `0`

**Response:**
```json
{
  "statusCode": 200,
  "data": [
    {
      "person": {
        "id": "person_def456",
        "name": "Alice Johnson",
        "company": "Apple",
        "title": "Engineering Manager"
      },
      "mutualConnections": [
        {
          "id": "person_abc123",
          "name": "John Doe",
          "relationshipStrength": 85
        }
      ],
      "pathStrength": 72
    }
  ],
  "count": 15
}
```

#### Find Introduction Path

```bash
GET /network/intro-path?targetId=person_def456
Authorization: Bearer YOUR_API_KEY
```

**Query Parameters:**
- `targetId` (required, string): Target person ID

**Response:**
```json
{
  "statusCode": 200,
  "data": {
    "path": [
      {
        "id": "user123",
        "name": "You",
        "relationshipStrength": 100
      },
      {
        "id": "person_abc123",
        "name": "John Doe",
        "company": "Google",
        "relationshipStrength": 85
      },
      {
        "id": "person_def456",
        "name": "Alice Johnson",
        "company": "Apple",
        "relationshipStrength": 78
      }
    ],
    "pathLength": 2,
    "overallStrength": 81.5
  }
}
```

**Error Response (404):**
```json
{
  "statusCode": 404,
  "message": "No introduction path found to the target person"
}
```

---

### Enrichment

#### Trigger Single Contact Enrichment

```bash
POST /enrichment
Authorization: Bearer YOUR_API_KEY
Content-Type: application/json
```

**Request Body:**
```json
{
  "personId": "person_abc123"
}
```

**Response:**
```json
{
  "statusCode": 200,
  "message": "Enrichment queued",
  "data": {
    "personId": "person_abc123",
    "status": "queued",
    "jobId": "enrich_550e8400"
  }
}
```

#### Trigger Batch Enrichment

```bash
POST /enrichment/batch
Authorization: Bearer YOUR_API_KEY
Content-Type: application/json
```

**Request Body:**
```json
{
  "limit": 50,
  "forceRefresh": false
}
```

**Parameters:**
- `limit` (optional, number): Max contacts to enrich. Default: `50`
- `forceRefresh` (optional, boolean): Re-enrich already enriched contacts. Default: `false`

**Response:**
```json
{
  "statusCode": 200,
  "message": "25 contacts queued for enrichment",
  "data": {
    "queued": 25,
    "skipped": 5,
    "total": 30
  }
}
```

#### Get Enrichment Status

```bash
GET /enrichment/status
Authorization: Bearer YOUR_API_KEY
```

**Response:**
```json
{
  "statusCode": 200,
  "data": {
    "totalContacts": 456,
    "enrichedContacts": 342,
    "pendingEnrichment": 114,
    "enrichmentProgress": 75,
    "lastEnrichedAt": "2026-02-11T02:30:00.000Z"
  }
}
```

---

## Error Handling

All API endpoints follow a consistent error response format:

### Error Response Format

```json
{
  "statusCode": 400,
  "message": "Error description here",
  "error": "Bad Request"
}
```

### Common HTTP Status Codes

| Code | Meaning | Description |
|------|---------|-------------|
| `200` | OK | Request successful |
| `202` | Accepted | Async job queued |
| `400` | Bad Request | Invalid request parameters |
| `401` | Unauthorized | Missing or invalid API key |
| `403` | Forbidden | Insufficient permissions |
| `404` | Not Found | Resource not found |
| `500` | Internal Server Error | Server error |

### Example Error Responses

**Missing Authentication:**
```json
{
  "statusCode": 401,
  "message": "Unauthorized"
}
```

**Invalid Parameters:**
```json
{
  "statusCode": 400,
  "message": "Query parameter \"q\" is required",
  "error": "Bad Request"
}
```

**Resource Not Found:**
```json
{
  "statusCode": 404,
  "message": "Sync job not found",
  "error": "Not Found"
}
```

---

## Rate Limiting

Currently, Kue Platform does not implement strict rate limiting. However, consider implementing the following best practices in your frontend:

1. **Debounce search queries** (wait for user to stop typing)
2. **Cache results** when appropriate
3. **Implement pagination** for large datasets
4. **Use quick search** for autocomplete instead of full search

Recommended request patterns:
- **Search**: Max 10 requests/minute
- **Sync operations**: Max 5 requests/minute
- **Contact listing**: Max 30 requests/minute

---

## Integration Guide

### Complete Frontend Integration Example

Here's a complete example of integrating Kue Platform into your frontend application:

```javascript
class KuePlatformClient {
  constructor(apiKey, baseUrl = 'https://kue-platform.vercel.app') {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  async request(endpoint, options = {}) {
    const url = `${this.baseUrl}${endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers
    };

    if (!options.public) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const response = await fetch(url, {
      ...options,
      headers
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Request failed');
    }

    return await response.json();
  }

  // Auth
  async getGoogleAuthUrl(userId) {
    return this.request(`/auth/google?state=${userId}`, { public: true });
  }

  async getConnectionStatus() {
    return this.request('/auth/status');
  }

  // Sync
  async syncGmail(incremental = false) {
    return this.request(`/sync/gmail?incremental=${incremental}`, {
      method: 'POST'
    });
  }

  async syncContacts(incremental = false) {
    return this.request(`/sync/contacts?incremental=${incremental}`, {
      method: 'POST'
    });
  }

  async getSyncJobs(limit = 20) {
    return this.request(`/sync/jobs?limit=${limit}`);
  }

  async getSyncJobStatus(jobId) {
    return this.request(`/sync/jobs/status?jobId=${jobId}`);
  }

  // Contacts
  async getContacts({ page = 1, limit = 50, sortBy = 'name', search = '' } = {}) {
    const params = new URLSearchParams({
      page: page.toString(),
      limit: limit.toString(),
      sortBy
    });
    if (search) params.append('search', search);

    return this.request(`/contacts?${params}`);
  }

  async importLinkedInCSV(file) {
    const formData = new FormData();
    formData.append('file', file);

    return this.request('/contacts/import', {
      method: 'POST',
      body: formData,
      headers: {} // Let browser set Content-Type with boundary
    });
  }

  // Search
  async search(query, { page = 1, limit = 20, format = true } = {}) {
    const params = new URLSearchParams({
      q: query,
      page: page.toString(),
      limit: limit.toString(),
      format: format.toString()
    });

    return this.request(`/search?${params}`);
  }

  async quickSearch(query, limit = 10) {
    return this.request(`/search/quick?q=${encodeURIComponent(query)}&limit=${limit}`);
  }

  async getSearchSuggestions() {
    return this.request('/search/suggestions');
  }

  // Network
  async getNetworkOverview() {
    return this.request('/network');
  }

  async getSecondDegreeConnections({ limit = 20, minStrength = 0 } = {}) {
    return this.request(`/network/second-degree?limit=${limit}&minStrength=${minStrength}`);
  }

  async findIntroPath(targetId) {
    return this.request(`/network/intro-path?targetId=${targetId}`);
  }

  // Enrichment
  async enrichContact(personId) {
    return this.request('/enrichment', {
      method: 'POST',
      body: JSON.stringify({ personId })
    });
  }

  async enrichBatch({ limit = 50, forceRefresh = false } = {}) {
    return this.request('/enrichment/batch', {
      method: 'POST',
      body: JSON.stringify({ limit, forceRefresh })
    });
  }

  async getEnrichmentStatus() {
    return this.request('/enrichment/status');
  }

  // Health
  async checkHealth() {
    return this.request('/health', { public: true });
  }
}

// Usage example
const client = new KuePlatformClient('your-api-key-here');

// Search your network
const results = await client.search('engineers at Google');
console.log(results.data.summary);

// Trigger a sync
const syncJob = await client.syncGmail();
console.log('Sync job started:', syncJob.data.jobId);

// Monitor sync progress
const jobStatus = await client.getSyncJobStatus(syncJob.data.jobId);
console.log('Job status:', jobStatus.data.status);

// Get contacts
const contacts = await client.getContacts({ page: 1, limit: 50, search: 'john' });
console.log('Found contacts:', contacts.data.length);
```

### React Integration Example

```jsx
import { useState, useEffect } from 'react';

function ContactsPage() {
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  
  const client = new KuePlatformClient(process.env.REACT_APP_KUE_API_KEY);

  useEffect(() => {
    async function loadContacts() {
      setLoading(true);
      try {
        const result = await client.getContacts({ page, limit: 50 });
        setContacts(result.data);
      } catch (error) {
        console.error('Failed to load contacts:', error);
      } finally {
        setLoading(false);
      }
    }

    loadContacts();
  }, [page]);

  return (
    <div>
      <h1>My Contacts</h1>
      {loading ? (
        <p>Loading...</p>
      ) : (
        <ul>
          {contacts.map(contact => (
            <li key={contact.id}>
              {contact.name} - {contact.company} ({contact.title})
            </li>
          ))}
        </ul>
      )}
      <button onClick={() => setPage(p => p - 1)} disabled={page === 1}>
        Previous
      </button>
      <button onClick={() => setPage(p => p + 1)}>
        Next
      </button>
    </div>
  );
}
```

### Search with Debouncing Example

```jsx
import { useState, useEffect } from 'react';
import { debounce } from 'lodash';

function SearchBar() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  
  const client = new KuePlatformClient(process.env.REACT_APP_KUE_API_KEY);

  const performSearch = debounce(async (searchQuery) => {
    if (!searchQuery.trim()) {
      setResults([]);
      return;
    }

    setLoading(true);
    try {
      const result = await client.quickSearch(searchQuery, 10);
      setResults(result.data);
    } catch (error) {
      console.error('Search failed:', error);
    } finally {
      setLoading(false);
    }
  }, 300);

  useEffect(() => {
    performSearch(query);
  }, [query]);

  return (
    <div>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search your network..."
      />
      {loading && <p>Searching...</p>}
      <ul>
        {results.map(person => (
          <li key={person.id}>
            {person.name} - {person.company}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

---

## Environment Variables

For frontend integration, you'll need:

```bash
# Production
REACT_APP_KUE_API_URL=https://kue-platform.vercel.app
REACT_APP_KUE_API_KEY=your-api-key-here

# Development
REACT_APP_KUE_API_URL=http://localhost:3000
REACT_APP_KUE_API_KEY=your-api-key-here
```

---

## Support

For issues, questions, or feature requests, please contact the Kue Platform team.

**Version**: 0.1.0  
**Last Updated**: February 11, 2026  
**Powered by**: NestJS, Neo4j, Supabase, Redis, Claude AI
