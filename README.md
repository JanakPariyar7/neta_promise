# Neta Promise

Neta Promise is a Node.js + Supabase-compatible web app to track political promises, collect public voting feedback, and manage content from an admin panel.

## Features

- Public social-style feed of promise posts (video-first, 9:16 friendly)
- Party logo and politician photo support
- Filters: politician, location, trending, new, optimistic, pessimistic
- Feed pagination with `Load more`
- Upvote/downvote system with anti-abuse rules:
  - Max 30 votes per user per day
  - Same user cannot vote the same post more than once per day
- Public politician profile page with promise history and vote counts
- Public party profile page with associated politicians
- Public crowdsourcing form to submit promise video links
- Share action on each post (Web Share API + clipboard fallback)
- Basic ad cards inserted between feed posts
- Admin panel (`/admin/login`) with CRUD for:
  - Parties
  - Politicians
  - Posts (with video upload to `uploads/`)
  - Ads (with image upload to `uploads/`)
- Sidebar-based admin control sections
- Pagination in admin listing sections
- Admin table for crowdsourced submissions

## Tech Stack

- Backend: Node.js, Express
- Database: PostgreSQL (Supabase)
- Frontend: Server-rendered HTML, CSS, vanilla JS
- Auth: Session-based admin auth
- Uploads: Supabase Storage (with local `uploads/` fallback if not configured)

## Project Structure

- `index.js` - Express app, routes, admin panel, APIs
- `sql/schema.sql` - PostgreSQL/Supabase schema + default admin seed
- `public/css/style.css` - Public UI styles
- `public/css/admin.css` - Admin UI styles
- `public/js/app.js` - Feed fetching, voting, sharing
- `uploads/` - Uploaded video/image assets

## Prerequisites

- Node.js 18+
- Supabase project (Postgres + Storage) or PostgreSQL 14+

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create tables in Supabase/Postgres:

```bash
psql "$SUPABASE_DB_URL" -f sql/schema.sql
```

Also create these public storage buckets in Supabase:
- `party-logos`
- `politician-photos`
- `post-videos`
- `ad-images`
- `submissions-videos`

3. Configure environment variables (optional; defaults shown):

```bash
SUPABASE_DB_URL=postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
SUPABASE_BUCKET_PARTY_LOGOS=party-logos
SUPABASE_BUCKET_POLITICIAN_PHOTOS=politician-photos
SUPABASE_BUCKET_POST_VIDEOS=post-videos
SUPABASE_BUCKET_AD_IMAGES=ad-images
SUPABASE_BUCKET_SUBMISSIONS_VIDEOS=submissions-videos

DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=
DB_NAME=postgres
DB_SSL=false
SESSION_SECRET=replace-this-in-production
PORT=3000
```

4. Start app:

```bash
npm run dev
```

or

```bash
npm start
```

## Deploy On Render

1. Push this repo to GitHub/GitLab.
2. In Render, create a new **Web Service** from the repo (or use Blueprint file `infra/render.yaml`).
3. Ensure these env vars are set in Render:
   - `SUPABASE_DB_URL` (Postgres connection string, not `https://...`)
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `SESSION_SECRET`
   - Bucket vars:
     - `SUPABASE_BUCKET_PARTY_LOGOS=party-logos`
     - `SUPABASE_BUCKET_POLITICIAN_PHOTOS=politician-photos`
     - `SUPABASE_BUCKET_POST_VIDEOS=post-videos`
     - `SUPABASE_BUCKET_AD_IMAGES=ad-images`
     - `SUPABASE_BUCKET_SUBMISSIONS_VIDEOS=submissions-videos`
4. Build command: `npm install`
5. Start command: `npm start`
6. Health check path: `/health`

Note: Render assigns `PORT` automatically in production.

## Default Admin Login

- Email: `admin@example.com`
- Password: `admin123`

Change this immediately in production.

## Main Routes

- `/` - Public feed
- `/submit` - Public promise submission form
- `/politicians/:id` - Politician profile
- `/parties/:id` - Party profile
- `/admin/login` - Admin login
- `/admin` - Admin panel

## API Routes

- `GET /api/posts`
  - Query params: `politician`, `location`, `sort` (`trending|new|optimistic|pessimistic`)
- `POST /api/votes`
  - Body: `{ postId, voteType }`, where `voteType` is `up` or `down`
- `POST /api/submissions`
  - Form payload from public submission page

## Notes

- If `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set, uploaded post videos and images are stored in Supabase Storage and DB rows store public URLs.
- If Supabase storage env vars are missing, uploads fall back to local `uploads/`.
- On startup, the app auto-adds `parties.logo_path` and `politicians.photo_path` columns if missing.
- This is a baseline implementation. For production, add stricter validation, CSRF protection, rate limiting, moderation workflows, and proper media processing/storage.
