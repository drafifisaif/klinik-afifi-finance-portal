# Deployment Readiness

## Supabase Client Setup

The app uses `@supabase/ssr` for both browser and server clients:

- Browser client: `lib/supabase-client.ts`
- Server client: `lib/supabase-server.ts`
- Session refresh and route protection: `middleware.ts`

The deployed Supabase schema is treated as the source of truth. The app reads and writes to the existing tables directly.

## Authentication Flow

1. Unauthenticated users visiting portal routes are redirected to `/login`.
2. The original route is preserved in the `redirect` query string.
3. `app/actions.ts` signs in with Supabase Auth email/password.
4. Successful login redirects back to the requested portal route, or `/dashboard`.
5. Authenticated users visiting `/login` are redirected to `/dashboard`.

## Required Environment Variables

Use these in `.env.local` and in Vercel Project Settings:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

Optional server-only variable:

```bash
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

Do not expose `SUPABASE_SERVICE_ROLE_KEY` in browser code. The MVP app does not require it for normal runtime.

## Supabase Auth Settings

In Supabase Auth URL Configuration:

- Site URL local: `http://localhost:3000`
- Site URL production: your Vercel domain
- Redirect URLs:
  - `http://localhost:3000/**`
  - `http://localhost:3000/auth/callback`
  - `https://your-vercel-domain.vercel.app/**`
  - `https://your-vercel-domain.vercel.app/auth/callback`
  - your custom production domain if used

## Vercel Deployment

1. Push the project to GitHub.
2. Import the repository into Vercel.
3. Set the required environment variables for Production, Preview, and Development.
4. Deploy with the default Next.js framework settings.

Recommended build settings:

```text
Framework Preset: Next.js
Install Command: npm install
Build Command: npm run build
Output Directory: .next
```

## First Production User

Create the first user in Supabase Auth, then set their profile role:

```sql
update public.profiles
set role = 'owner', full_name = 'Klinik Afifi Owner'
where id = 'AUTH_USER_UUID_HERE';
```
