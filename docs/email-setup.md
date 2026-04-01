# Email Connection Setup Guide

This guide covers connecting Gmail and Outlook to the Broker Compliance Agent, so it can read and process insurer emails directly.

## Connection Methods

There are two ways to connect email:

| Method | Setup | Best For |
|--------|-------|----------|
| **OAuth (Gmail/Outlook)** | Create app in Google/Microsoft console | Production, most secure |
| **IMAP Direct** | Username + app password | Custom mail servers, quick testing |

---

## Option A: Gmail OAuth

### 1. Create Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or select existing)
3. Navigate to **APIs & Services → Library**
4. Search for "Gmail API" and **Enable** it

### 2. Configure OAuth Consent Screen

1. Go to **APIs & Services → OAuth consent screen**
2. Choose **External** (or Internal if using Google Workspace)
3. Fill in:
   - App name: `Broker Compliance Agent`
   - User support email: your email
   - Scopes: add `https://www.googleapis.com/auth/gmail.readonly`
4. Add test users (your Gmail address) while in testing mode

### 3. Create OAuth Credentials

1. Go to **APIs & Services → Credentials**
2. Click **Create Credentials → OAuth client ID**
3. Application type: **Web application**
4. Name: `Broker Compliance`
5. **Authorized redirect URIs**, add:
   ```
   http://localhost:3000/api/agent/oauth/gmail/callback
   ```
   For production, replace with your domain:
   ```
   https://yourdomain.com/api/agent/oauth/gmail/callback
   ```
6. Click **Create** — save the **Client ID** and **Client Secret**

### 4. Add Environment Variables

Add to your `.env`:

```bash
APP_URL="http://localhost:3000"  # or https://yourdomain.com in production

GMAIL_OAUTH_CLIENT_ID="your-client-id.apps.googleusercontent.com"
GMAIL_OAUTH_CLIENT_SECRET="GOCSPX-your-client-secret"

# Generate with: openssl rand -hex 32
EMAIL_TOKEN_ENCRYPTION_KEY="your-64-char-hex-key"
```

### 5. Connect in the App

1. Start the app: `npm run dev`
2. Log in as a `firm_admin` or `compliance_officer`
3. Go to **Agent → Config**
4. Click **Connect Gmail**
5. Sign in with your Google account and authorize
6. You'll be redirected back — status should show "Connected via Gmail"

---

## Option B: Outlook OAuth

### 1. Register Azure AD Application

1. Go to [Azure Portal](https://portal.azure.com/) → **Azure Active Directory**
2. Navigate to **App registrations → New registration**
3. Fill in:
   - Name: `Broker Compliance Agent`
   - Supported account types: **Accounts in any organizational directory and personal Microsoft accounts**
   - Redirect URI: **Web** → `http://localhost:3000/api/agent/oauth/outlook/callback`
4. Click **Register**

### 2. Configure API Permissions

1. Go to **API permissions → Add a permission**
2. Select **Microsoft Graph**
3. Choose **Delegated permissions**
4. Add:
   - `Mail.Read` — Read user mail
   - `offline_access` — Maintain access (refresh tokens)
5. Click **Grant admin consent** (if you're an admin)

### 3. Create Client Secret

1. Go to **Certificates & secrets → New client secret**
2. Description: `Broker Compliance`
3. Expiry: choose appropriately (24 months recommended)
4. Click **Add** — save the **Value** immediately (it disappears)

### 4. Add Environment Variables

Add to your `.env`:

```bash
APP_URL="http://localhost:3000"

OUTLOOK_OAUTH_CLIENT_ID="your-azure-app-id"
OUTLOOK_OAUTH_CLIENT_SECRET="your-client-secret-value"

EMAIL_TOKEN_ENCRYPTION_KEY="your-64-char-hex-key"
```

### 5. Connect in the App

Same as Gmail — go to **Agent → Config → Connect Outlook**.

---

## Option C: IMAP Direct Connection

For providers that don't support OAuth (custom mail servers, older providers).

### Gmail IMAP

1. Go to [Google Account → Security](https://myaccount.google.com/security)
2. Enable **2-Step Verification** (required)
3. Go to **App passwords** (search in settings)
4. Generate a password for "Mail" → "Other (Broker Agent)"
5. Use your Gmail address + the 16-character app password in the IMAP form

### Outlook IMAP

1. Go to **Settings → Mail → Sync email**
2. IMAP server: `outlook.office365.com`, port `993`
3. Use your email + password (or app password if 2FA enabled)

### Custom Mail Server

In the IMAP form, select **Custom Server** and enter:
- Host: `imap.your-provider.com`
- Port: `993` (standard IMAP over SSL)
- Username: your email
- Password: your password

---

## Required Environment Variables Summary

| Variable | Required | Description |
|----------|----------|-------------|
| `APP_URL` | Yes | Base URL of the app (used for OAuth redirects) |
| `GMAIL_OAUTH_CLIENT_ID` | For Gmail OAuth | Google Cloud Console client ID |
| `GMAIL_OAUTH_CLIENT_SECRET` | For Gmail OAuth | Google Cloud Console client secret |
| `OUTLOOK_OAUTH_CLIENT_ID` | For Outlook OAuth | Azure AD app ID |
| `OUTLOOK_OAUTH_CLIENT_SECRET` | For Outlook OAuth | Azure AD client secret |
| `EMAIL_TOKEN_ENCRYPTION_KEY` | Yes (OAuth) | 32-byte hex key for encrypting stored tokens |

---

## How It Works

1. **OAuth flow**: User clicks "Connect Gmail/Outlook" → redirected to provider → authorizes → tokens stored encrypted in DB
2. **Polling**: Worker polls connected mailboxes every 60 seconds
3. **Token refresh**: Expired access tokens are automatically refreshed using stored refresh tokens
4. **IMAP**: Credentials encrypted and stored; worker connects via IMAP IDLE/polling

## Troubleshooting

| Issue | Fix |
|-------|-----|
| "Gmail OAuth not configured" | `GMAIL_OAUTH_CLIENT_ID` not set in `.env` |
| "redirect_uri_mismatch" | Callback URL in Google/Azure console doesn't match `APP_URL` |
| "invalid_state" | CSRF check failed — try again, cookies may have expired (10 min window) |
| "token_exchange_failed" | Client secret wrong or expired |
| Connection shows "error" status | Check logs; may need to reconnect (tokens revoked) |
| IMAP "Invalid credentials" | For Gmail, must use App Password, not regular password |
