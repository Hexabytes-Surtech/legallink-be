Here’s your 13 endpoints broken into **logical implementation groups**, following the advocate’s natural journey: **Authentication → Registration & Onboarding → Dashboard & Consultations → Admin Verification**.

I’ve also mapped each group to the user story so you can build and test in sequence, just like “email OTP auth → profile”.

---

## Group 1: Advocate Authentication (Email OTP)
These endpoints are **not** part of your Person 1 contract directly; they are built by Person 2 in the `identity` module.  
*However*, since you specifically asked to structure the work as “email OTP auth then profile”, I’ll explain how you integrate them.

**Your role**: You’ll **consume** Person 2’s auth endpoints. The flow is:

1. **POST /api/auth/request-otp** (Person 2)  
   – Sends an OTP to the advocate’s email (via Resend).  
2. **POST /api/auth/verify-otp** (Person 2)  
   – Verifies the OTP, creates/finds a `user` record, returns a **generic JWT** with `userId` and `role: 'citizen'` (or no role yet).  
3. After that, the advocate calls **your first owned endpoint**.

> If Person 2 hasn’t built these yet, you can **mock them locally** for testing until they’re ready.

---

## Group 2: Advocate Registration & Role Assignment
**Your first endpoint** is called *after* OTP verification. It links the generic user to an advocate record and returns a JWT with `role: 'advocate'`.

### **1. POST /api/advocate/register**
- **What it does**:  
  - Extracts `userId` from the incoming generic JWT (provided by Person 2).  
  - Creates a row in the `advocates` table (with `verificationStatus = 'pending'`).  
  - Issues a new JWT with `role: 'advocate'` and returns it.  
- **Important**: Must be idempotent – if the user already has an advocate record, just return the existing one.

> This is the “sign-up” completion. After this, the app switches to advocate UI.

---

## Group 3: Profile & Onboarding Setup
Now the advocate fills in their professional details and uploads documents.

### **2. PUT /api/advocate/profile**
- Updates the 6‑field profile object (`name`, `address`, `phone`, `email`, `practiceAreas`, `courts`).  
- Stored as a JSONB column (or flat columns) in `advocates`.  
- Validates according to BCI Rule 36 (2008).

### **3. POST /api/advocate/documents**
- Multipart file upload (Multer + Cloudinary).  
- Stores uploaded Certificate of Practice (CoP) or other documents in `advocate_verification_documents` table.  
- Returns `documentId`, `fileName`, `cloudinaryUrl`, etc.

### **4. PUT /api/advocate/availability**
- Toggles the advocate’s availability (`{ available: true/false }`) and optional schedule (for later phases).  
- Useful later when matching advocates to citizens.

### **5. POST /api/advocate/submit-verification**
- Changes the advocate’s `verificationStatus` to `pending` (triggering admin review).  
- No request body; just call it when ready.

**Testing flow**: After these, an admin can see them in the pending queue.

---

## Group 4: Dashboard & Consultation Management
These empower the advocate to view their activity, handle incoming consultation requests, and read messages.

### **6. GET /api/advocate/dashboard**
- Returns summary:  
  - Total consultations (requested/accepted/completed),  
  - Profile completeness score,  
  - Unread message count (from consultations where messages are awaiting view).  
- Use data from `consultations` and `messages` tables (coordinate with Person 2).

### **7. GET /api/advocate/consultations**
- Lists all consultations where the advocate is involved.  
- Filter by status: `requested` and `accepted`.  
- Each entry shows minimal matter info (citizen anonymised ID, matter type).

### **8. GET /api/advocate/consultations/:id**
- Full consultation details, including:  
  - Matter’s full query and AI response **(only after the consultation is accepted)**.  
  - Citizen’s details (if allowed).  
- Use this for the advocate to review a matter before accepting.

### **9. PUT /api/advocate/consultations/:id** (accept/decline)
- Accept or decline: `{ action: "accept" | "decline", declineReason?: string }`.  
- Updates consultation status.  
- This action enables the WebSocket chat (Person 2’s server checks status).

### **10. GET /api/advocate/messages?consultationId=...**
- Returns all messages for a consultation (both citizen and advocate).  
- Crucial for loading chat history when entering the chat screen.

---

## Group 5: Shared Consultation Accept (for WebSocket compatibility)
The API contracts define a **global** endpoint (not under `/api/advocate`) that allows an advocate to accept/decline a consultation. This is what Person 2’s chat server and Person 3’s frontend will use.

### **11. PUT /api/consultations/:consultationId**
- Identical accept/decline logic as in #9, but mounted at `/api/consultations` for the citizen side to poll.  
- Protected by advocate JWT, validates that the advocate is the assigned one.

You can easily reuse the same service method; just expose it under two routes for architectural clarity.

---

## Group 6: Admin Verification (Back‑office)
Admins need to review pending advocates and approve or reject them.

### **12. GET /api/admin/advocates/pending**
- Protected by admin JWT (check `role === 'admin'`).  
- Lists all advocates with `verificationStatus = 'pending'`, along with their uploaded documents.

### **13. PUT /api/admin/advocates/:advocateId/verify**
- Accepts `{ action: "approve" | "reject", reason?: string }`.  
- Updates the verification status to `verified` or `rejected`.  
- Optionally send an email notification via **Resend** (you can use your existing setup).  
- Optionally log an audit entry in Person 2’s `trust` module.

---

## Recommended Implementation Order
Build and test in this sequence to minimise dependencies:

1. **Group 2** (Register) – you need the JWT and advocate record creation first.  
2. **Group 3** (Profile, Documents, Availability, Submit) – complete the onboarding flow.  
3. **Group 6** (Admin) – so you can approve your own test advocate and proceed.  
4. **Group 4** (Dashboard & Consultations) – core advocate functionality.  
5. **Group 5** (Shared accept endpoint) – final integration with the chat/web system.

If Person 2’s OTP endpoints aren’t ready, **mock the JWT generation** in your tests: simulate a valid `userId` and sign a token with the same secret Person 2 will use. That way you can develop Groups 2–6 independently.

---

## Quick summary table

| Group                     | Endpoints                                                                                                           |
|---------------------------|---------------------------------------------------------------------------------------------------------------------|
| 1. Auth (Person 2)        | `POST /api/auth/request-otp`, `POST /api/auth/verify-otp` (integrate only)                                          |
| 2. Registration           | `POST /api/advocate/register`                                                                                       |
| 3. Onboarding             | `PUT /api/advocate/profile`, `POST /api/advocate/documents`, `PUT /api/advocate/availability`, `POST /api/advocate/submit-verification` |
| 4. Dashboard & Consultations | `GET /api/advocate/dashboard`, `GET /api/advocate/consultations`, `GET /api/advocate/consultations/:id`, `PUT /api/advocate/consultations/:id`, `GET /api/advocate/messages` |
| 5. Shared consultation    | `PUT /api/consultations/:id`                                                                                        |
| 6. Admin verification     | `GET /api/admin/advocates/pending`, `PUT /api/admin/advocates/:id/verify`                                           |

This grouping lets you build incrementally, test each user story (OTP → register → profile → doc upload → verification → dashboard → consultations), and integrate smoothly with Person 2’s work.