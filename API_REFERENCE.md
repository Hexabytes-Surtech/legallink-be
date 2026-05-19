# LegalLink API Reference

> For Frontend Developer - Use this document to integrate with the backend

## Base URL
```
http://localhost:3000/api
```

## Authentication

All protected routes require JWT access token in the header:
```
Authorization: Bearer <access_token>
```

The access token is returned from `POST /auth/verify-otp` after OTP verification.

### How the API Identifies the User

The JWT token contains the user's identity in its payload:

```javascript
// Token payload (decoded)
{
  "sub": "user-uuid-123",   // ← This is the user's database ID
  "role": "advocate"        // ← User's role
}
```

**The backend automatically:**
1. Extracts the `sub` (user ID) from the token
2. Uses it to query the correct user's data
3. Returns data specific to that user

**You don't need to send user ID in the URL or body** - the token already contains it!

Example: `GET /api/advocate/dashboard` will return the dashboard for the advocate whose token you sent - not anyone else's.

---

## Endpoints

### 1. Auth Module (`/auth`)

#### 1.1 Register User
```
POST /auth/register
```
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| email | string | Yes | User's email address |
| role | string | Yes | Either `"citizen"` or `"advocate"` |

**Request:**
```json
{
  "email": "user@example.com",
  "role": "citizen"
}
```

**Response (202):**
```json
{
  "expiresInSeconds": 600
}
```
> OTP sent to email. User must verify within 10 minutes.

---

#### 1.2 Login
```
POST /auth/login
```
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| email | string | Yes | Verified user's email |

**Request:**
```json
{
  "email": "user@example.com"
}
```

**Response (202):**
```json
{
  "expiresInSeconds": 600
}
```
> OTP sent to email for 2FA verification.

---

#### 1.3 Verify OTP
```
POST /auth/verify-otp
```
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| email | string | Yes | User's email |
| otp | string | Yes | 6-digit OTP received via email |

**Request:**
```json
{
  "email": "user@example.com",
  "otp": "123456"
}
```

**Response (200):**
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "userId": "uuid-of-user",
    "email": "user@example.com",
    "role": "citizen",
    "preferred_language": "en",
    "email_verified": true
  }
}
```

**Important:**
- Save `accessToken` in memory/state (NOT localStorage for security)
- `refreshToken` is automatically set as httpOnly cookie (handled by browser)
- Use `accessToken` in header: `Authorization: Bearer <token>`

---

#### 1.4 Refresh Token
```
POST /auth/refresh-token
```
No body required. The refresh token is sent automatically via cookies.

**Headers:**
```
Cookie: refreshToken=<refresh_token>
```

**Response (200):**
```json
{
  "accessToken": "new_jwt_token..."
}
```

---

#### 1.5 Logout
```
POST /auth/logout
```
**Headers:**
```
Authorization: Bearer <access_token>
```

**Response (200):**
```json
{
  "message": "Logged out successfully"
}
```

---

### 2. User Module (`/user`)

All endpoints require: `Authorization: Bearer <access_token>`

> **Note:** The API returns data for the user whose token is sent. No user ID needed in request - the JWT handles it!

#### 2.1 Get Current User Profile
```
GET /user/me
```

**Response (200):**
```json
{
  "id": "uuid",
  "email": "user@example.com",
  "role": "citizen",
  "email_verified": true,
  "phone": "+919876543210",
  "preferred_language": "en",
  "avatar_url": "https://cloudinary.com/avatar.jpg",
  "created_at": "2024-01-01T00:00:00Z",
  "updated_at": "2024-01-01T00:00:00Z"
}
```

---

#### 2.2 Update User Profile
```
PUT /user/profile
```

**Request:**
```json
{
  "phone": "+919876543210",
  "preferred_language": "bn"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| phone | string | No | Phone number with country code |
| preferred_language | string | No | Either `"en"` or `"bn"` |

**Response (200):** Returns updated user profile

---

#### 2.3 Upload Avatar
```
POST /user/avatar
```
**Content-Type:** `multipart/form-data`

| Field | Type | Required |
|-------|------|----------|
| avatar | file | Yes |

**Response (200):**
```json
{
  "avatar_url": "https://cloudinary.com/avatar.jpg"
}
```

---

### 3. Advocate Module (`/advocate`)

All endpoints require: `Authorization: Bearer <access_token>` and role must be `"advocate"`

> **Note:** The API returns data for the advocate whose token is sent. No advocate ID needed in request - the JWT handles it!

#### 3.1 Get Advocate Profile
```
GET /advocate/me
```

**Response (200):**
```json
{
  "advocate_id": "uuid",
  "name": "John Doe",
  "address": "123 Main St, Kolkata",
  "phone": "+919876543210",
  "advocate_email": "contact@john.law",
  "bar_enrolment_number": "WB/1234/2020",
  "state_bar": "West Bengal",
  "practice_areas": ["family", "criminal"],
  "courts": ["Calcutta HC", "District Court"],
  "languages": ["en", "bn"],
  "districts": ["kolkata", "howrah"],
  "verification_status": "pending",
  "auth_email": "john@example.com",
  "preferred_language": "en",
  "avatar_url": null,
  "created_at": "2024-01-01T00:00:00Z",
  "updated_at": "2024-01-01T00:00:00Z"
}
```

---

#### 3.2 Update Advocate Profile
```
PUT /advocate/profile
```

**Request (all fields optional - partial update):**
```json
{
  "name": "John Doe",
  "barEnrolmentNumber": "WB/1234/2020",
  "stateBar": "West Bengal",
  "address": "123 Main St, Kolkata 700016",
  "email": "contact@john.law",
  "phone": "+919876543210",
  "practiceAreas": ["family", "criminal", "consumer"],
  "courts": ["Calcutta HC", "Howrah District Court"],
  "languages": ["en", "bn"],
  "districts": ["kolkata", "howrah"]
}
```

| Field | Type | Description |
|-------|------|-------------|
| name | string | Full name (as per CoP) |
| barEnrolmentNumber | string | BCI enrollment number |
| stateBar | string | State bar council name |
| address | string | Professional address |
| email | string | Contact email (CoP) |
| phone | string | Contact phone |
| practiceAreas | string[] | Array of practice areas |
| courts | string[] | Courts where you practice |
| languages | string[] | Languages known |
| districts | string[] | Districts served |

**Response (200):** Returns merged advocate + user profile

---

#### 3.3 Get Documents
```
GET /advocate/documents
```

**Response (200):**
```json
[
  {
    "id": "doc-uuid",
    "file_path": "https://cloudinary.com/doc.pdf",
    "file_type": "application/pdf",
    "uploaded_at": "2024-01-01T00:00:00Z"
  }
]
```

---

#### 3.4 Upload Document
```
POST /advocate/documents
```
**Content-Type:** `multipart/form-data`

| Field | Type | Required |
|-------|------|----------|
| document | file | Yes |

**Response (201):**
```json
{
  "documentId": "doc-uuid",
  "file_path": "https://cloudinary.com/doc.pdf",
  "file_type": "application/pdf",
  "uploaded_at": "2024-01-01T00:00:00Z"
}
```

---

#### 3.5 Get Dashboard
```
GET /advocate/dashboard
```

**Response (200):**
```json
{
  "advocateId": "advocate-uuid",
  "verificationStatus": "pending",
  "profileCompleteness": 75,
  "consultationStats": {
    "pending_count": "2",
    "accepted_count": "5",
    "declined_count": "1",
    "closed_count": "3",
    "total_count": "11"
  }
}
```

---

#### 3.6 Get All Consultations
```
GET /advocate/consultations
```

**Response (200):**
```json
[
  {
    "id": "consultation-uuid",
    "status": "requested",
    "requested_at": "2024-01-01T00:00:00Z",
    "accepted_at": null,
    "query_text": "Legal question from citizen",
    "query_language": "en",
    "classification": "family",
    "citizen_user_id": "citizen-uuid"
  }
]
```

---

#### 3.7 Get Single Consultation
```
GET /advocate/consultations/:id
```

**Response (200):**
```json
{
  "id": "consultation-uuid",
  "status": "requested",
  "requested_at": "2024-01-01T00:00:00Z",
  "accepted_at": null,
  "matter_id": "matter-uuid",
  "query_text": "Legal question",
  "query_language": "en",
  "classification": "family",
  "citations": "...",
  "ai_response_english": "...",
  "ai_response_bengali": "...",
  "citizen_user_id": "citizen-uuid"
}
```

---

#### 3.8 Accept/Decline Consultation
```
PUT /advocate/consultations/:id
```

**Request:**
```json
{
  "action": "accept"
}
```
OR
```json
{
  "action": "decline",
  "declineReason": "Schedule conflict"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| action | string | Yes | Either `"accept"` or `"decline"` |
| declineReason | string | No | Reason for declining (required if action is "decline") |

**Response (200):**
```json
{
  "consultationId": "consultation-uuid",
  "status": "accepted"
}
```
OR
```json
{
  "consultationId": "consultation-uuid",
  "status": "declined",
  "declineReason": "Schedule conflict"
}
```

---

#### 3.9 Submit for Verification
```
POST /advocate/submit-verification
```

**Response (200):**
```json
{
  "advocateId": "advocate-uuid",
  "verificationStatus": "pending",
  "message": "Profile submitted for admin review"
}
```

**Error (400):** "Complete your profile before submitting for verification" or "Already verified"

---

### 4. Admin Module (`/admin`)

All endpoints require: `Authorization: Bearer <access_token>` and role must be `"admin"`

> **Note:** Admin sees all pending advocates (no filtering needed)

#### 4.1 Get Pending Advocates
```
GET /admin/advocates/pending
```

**Response (200):**
```json
[
  {
    "id": "advocate-uuid",
    "bar_enrolment_number": "WB/1234/2020",
    "state_bar": "West Bengal",
    "name": "John Doe",
    "address": "123 Main St",
    "phone": "+919876543210",
    "email": "contact@john.law",
    "practice_areas": ["family"],
    "courts": ["Calcutta HC"],
    "languages": ["en"],
    "districts": ["kolkata"],
    "verification_status": "pending",
    "created_at": "2024-01-01T00:00:00Z",
    "user_email": "john@example.com",
    "documents": [
      {
        "id": "doc-uuid",
        "fileUrl": "https://cloudinary.com/doc.pdf",
        "fileType": "application/pdf",
        "uploadedAt": "2024-01-01T00:00:00Z"
      }
    ]
  }
]
```

---

#### 4.2 Verify Advocate
```
PUT /admin/advocates/:id/verify
```

**Request:**
```json
{
  "action": "approve"
}
```
OR
```json
{
  "action": "reject",
  "reason": "Invalid documents"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| action | string | Yes | Either `"approve"` or `"reject"` |
| reason | string | No | Rejection reason (required if action is "reject") |

**Response (200):**
```json
{
  "advocateId": "advocate-uuid",
  "verificationStatus": "verified"
}
```
OR
```json
{
  "advocateId": "advocate-uuid",
  "verificationStatus": "rejected",
  "reason": "Invalid documents"
}
```

---

## Enums

### Roles
```typescript
'citizen' | 'advocate' | 'admin'
```

### Verification Status
```typescript
'pending' | 'verified' | 'rejected'
```

### Consultation Status
```typescript
'requested' | 'accepted' | 'declined' | 'closed'
```

### Practice Areas
```typescript
'motor_vehicle' | 'consumer' | 'family' | 'criminal' | 'property' | 'corporate' | 'civil' | 'land_disputes' | 'labour' | 'tax'
```

### Districts
```typescript
'kolkata' | 'howrah' | 'north_24_parganas' | 'south_24_parganas' | 'hooghly' | 'burdwan' | 'murshidabad' | 'nadia' | 'medinipur' | 'bankura'
```

---

## Error Responses

All endpoints may return these error responses:

| Status | Description |
|--------|-------------|
| 400 | Bad Request - Invalid input |
| 401 | Unauthorized - Invalid/expired token |
| 403 | Forbidden - Insufficient permissions |
| 404 | Not Found - Resource doesn't exist |
| 409 | Conflict - Already exists |
| 500 | Internal Server Error |

---

## Notes for Frontend

1. **Store accessToken in memory** (React state, Vuex, etc.), NOT localStorage
2. **Include Bearer token in every protected request:**
   ```javascript
   axios.get('/api/advocate/me', {
     headers: { Authorization: `Bearer ${accessToken}` }
   })
   ```
3. **Refresh token is automatic** - browser handles cookies, just call `/auth/refresh-token` when token expires
4. **File uploads** - use `FormData` for avatar and document uploads
5. **OTP flow:**
   - User enters email → `POST /auth/register` or `POST /auth/login`
   - OTP sent to email
   - User enters OTP → `POST /auth/verify-otp` → get accessToken
   - Save token and proceed

---

## Testing Checklist

- [ ] Register citizen → verify OTP → get token
- [ ] Register advocate → verify OTP → get token
- [ ] Update user profile (preferred_language)
- [ ] Upload avatar
- [ ] Update advocate profile (practice areas, courts, etc.)
- [ ] Upload CoP document
- [ ] Submit verification
- [ ] Get dashboard
- [ ] Get consultations list
- [ ] Accept/decline consultation
- [ ] Refresh token
- [ ] Logout

---

*Generated on: May 2026*
*Backend Version: 1.0*