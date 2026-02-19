const express = require('express');
const path = require('path');
const fs = require('fs');
const session = require('express-session');
const multer = require('multer');
const crypto = require('crypto');
const { Pool } = require('pg');
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');
require('dotenv').config({ override: true });


const app = express();
const PORT = process.env.PORT || 3000;
const DAILY_VOTE_LIMIT = 30;
const FEED_PAGE_SIZE = 8;
const ADMIN_PAGE_SIZE = 10;
const isProduction = process.env.NODE_ENV === 'production';
const STORAGE_BUCKETS = {
  parties: process.env.SUPABASE_BUCKET_PARTY_LOGOS || 'party-logos',
  politicians: process.env.SUPABASE_BUCKET_POLITICIAN_PHOTOS || 'politician-photos',
  posts: process.env.SUPABASE_BUCKET_POST_VIDEOS || 'post-videos',
  ads: process.env.SUPABASE_BUCKET_AD_IMAGES || 'ad-images',
  submissions: process.env.SUPABASE_BUCKET_SUBMISSIONS_VIDEOS || 'submissions-videos'
};

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const pool = new Pool(
  process.env.SUPABASE_DB_URL
    ? {
        connectionString: process.env.SUPABASE_DB_URL,
        ssl: process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false }
      }
    : {
        host: process.env.DB_HOST || 'localhost',
        port: Number(process.env.DB_PORT || 5432),
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'postgres',
        ssl: process.env.DB_SSL === 'false' ? false : undefined
      }
);

function mysqlToPgPlaceholders(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

const db = {
  async query(sql, params = []) {
    const text = mysqlToPgPlaceholders(sql);
    const result = await pool.query(text, params);
    return [result.rows];
  }
};

const supabase =
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    : null;
const useSupabaseStorage = Boolean(supabase);

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.set('trust proxy', 1);
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'replace-this-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProduction,
      maxAge: 1000 * 60 * 60 * 8
    }
  })
);

app.use('/uploads', express.static(uploadsDir));
app.use('/public', express.static(path.join(__dirname, 'public')));

const upload = multer({
  storage: multer.memoryStorage()
});

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function assetUrl(value) {
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  return `/uploads/${value}`;
}

async function saveUploadedFile(file, folder) {
  if (!file) return null;
  const ext = path.extname(file.originalname || '').toLowerCase() || '.bin';
  const key = `${folder}/${Date.now()}-${crypto.randomBytes(5).toString('hex')}${ext}`;
  const bucket = STORAGE_BUCKETS[folder] || STORAGE_BUCKETS.posts;

  if (useSupabaseStorage) {
    const { error } = await supabase.storage.from(bucket).upload(key, file.buffer, {
      contentType: file.mimetype || undefined,
      upsert: false
    });
    if (error) throw error;
    const { data } = supabase.storage.from(bucket).getPublicUrl(key);
    return data.publicUrl;
  }

  const localName = `${Date.now()}-${crypto.randomBytes(5).toString('hex')}${ext}`;
  await fs.promises.writeFile(path.join(uploadsDir, localName), file.buffer);
  return localName;
}

function ensureAnonCookie(req, res) {
  let anonId = req.headers.cookie
    ?.split(';')
    .map((x) => x.trim())
    .find((x) => x.startsWith('anon_id='))
    ?.split('=')[1];

  if (!anonId) {
    anonId = crypto.randomUUID();
    res.setHeader('Set-Cookie', `anon_id=${anonId}; Path=/; Max-Age=31536000; SameSite=Lax`);
  }
  return anonId;
}

function requireAdmin(req, res, next) {
  if (!req.session.admin) {
    return res.redirect('/admin/login');
  }
  return next();
}

function toPositiveInt(value, fallback) {
  const num = Number(value);
  if (!Number.isInteger(num) || num < 1) return fallback;
  return num;
}

async function ensureSchemaCompatibility() {
  const alterations = [
    'ALTER TABLE parties ADD COLUMN logo_path VARCHAR(255) NULL',
    'ALTER TABLE politicians ADD COLUMN photo_path VARCHAR(255) NULL'
  ];

  for (const sql of alterations) {
    try {
      await db.query(sql);
    } catch (err) {
      if (err.code !== '42701') throw err; // duplicate_column
    }
  }
}

function publicShell(title, body, extraJs = '', metaTags = '') {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  ${metaTags}
  <link rel="stylesheet" href="/public/css/style.css" />
</head>
<body>
  <header class="topbar">
    <a href="/" class="brand">Neta Promise</a>
    <a href="/submit" class="submit-cta">Submit Promise</a>
  </header>
  ${body}
  <script src="/public/js/app.js"></script>
  <script>
    (function () {
      const initSelectSearch = (root) => {
        const selects = Array.from(root.querySelectorAll('select.searchable-select'));
        selects.forEach((select) => {
          if (select.dataset.searchReady === '1') return;
          select.dataset.searchReady = '1';

          const parent = select.parentElement;
          if (!parent) return;

          const wrap = document.createElement('div');
          wrap.className = 'native-select-inline-wrap';
          parent.insertBefore(wrap, select);
          wrap.appendChild(select);

          const input = document.createElement('input');
          input.type = 'text';
          input.className = 'native-select-search';
          input.placeholder = select.dataset.searchPlaceholder || 'Search...';
          wrap.appendChild(input);

          const options = Array.from(select.options);
          const resetOptions = () => options.forEach((opt) => (opt.hidden = false));

          const showInput = () => {
            input.classList.add('show');
            input.focus();
          };

          select.addEventListener('mousedown', showInput);
          select.addEventListener('focus', showInput);

          input.addEventListener('input', () => {
            const term = input.value.trim().toLowerCase();
            options.forEach((opt, idx) => {
              if (idx === 0 && opt.value === '') return;
              opt.hidden = !!term && !opt.text.toLowerCase().includes(term);
            });
          });

          select.addEventListener('change', () => {
            input.value = '';
            resetOptions();
            input.classList.remove('show');
          });

          input.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' || e.key === 'Enter') {
              input.classList.remove('show');
              select.focus();
            }
          });

          document.addEventListener('click', (e) => {
            if (!wrap.contains(e.target)) {
              input.classList.remove('show');
              input.value = '';
              resetOptions();
            }
          });
        });
      };

      initSelectSearch(document);
    })();
  </script>
  ${extraJs}
</body>
</html>`;
}

function absUrl(req, maybePath) {
  if (!maybePath) return '';
  if (/^https?:\/\//i.test(maybePath)) return maybePath;
  return `${req.protocol}://${req.get('host')}${maybePath.startsWith('/') ? maybePath : `/${maybePath}`}`;
}

function buildSocialMeta({ title, description, url, image, video, type = 'website' }) {
  const safeTitle = escapeHtml(title || 'Neta Promise');
  const safeDescription = escapeHtml(description || 'Track political promises with public accountability.');
  const safeUrl = escapeHtml(url || '');
  const safeImage = escapeHtml(image || '');
  const safeVideo = escapeHtml(video || '');

  return `
  <meta property="og:site_name" content="Neta Promise" />
  <meta property="og:type" content="${escapeHtml(type)}" />
  <meta property="og:title" content="${safeTitle}" />
  <meta property="og:description" content="${safeDescription}" />
  <meta property="og:url" content="${safeUrl}" />
  ${safeImage ? `<meta property="og:image" content="${safeImage}" />` : ''}
  ${safeVideo ? `<meta property="og:video" content="${safeVideo}" />` : ''}
  <meta name="twitter:card" content="${safeImage ? 'summary_large_image' : 'summary'}" />
  <meta name="twitter:title" content="${safeTitle}" />
  <meta name="twitter:description" content="${safeDescription}" />
  ${safeImage ? `<meta name="twitter:image" content="${safeImage}" />` : ''}
  `;
}

function adminShell(title, body) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="/public/css/admin.css" />
</head>
<body>
  <main class="admin-wrap">
    ${body}
  </main>
  <script>
    (function () {
      const sidebarLinks = Array.from(document.querySelectorAll('.admin-sidebar [data-target]'));
      const sections = Array.from(document.querySelectorAll('.admin-section'));
      if (!sidebarLinks.length || !sections.length) return;

      const setActive = (target) => {
        sections.forEach((section) => {
          const isMatch = section.getAttribute('data-section') === target;
          section.classList.toggle('active', isMatch);
        });
        sidebarLinks.forEach((link) => {
          const isMatch = link.getAttribute('data-target') === target;
          link.classList.toggle('active', isMatch);
        });
      };

      const hashTarget = (window.location.hash || '').replace('#', '');
      const defaultTarget = sidebarLinks[0].getAttribute('data-target');
      const initialTarget = sidebarLinks.some((link) => link.getAttribute('data-target') === hashTarget)
        ? hashTarget
        : defaultTarget;
      setActive(initialTarget);

      sidebarLinks.forEach((link) => {
        link.addEventListener('click', (event) => {
          event.preventDefault();
          const target = link.getAttribute('data-target');
          if (!target) return;
          window.history.replaceState({}, '', '#' + target);
          setActive(target);
        });
      });

      const initSelectSearch = (root) => {
        const selects = Array.from(root.querySelectorAll('select.searchable-select'));
        selects.forEach((select) => {
          if (select.dataset.searchReady === '1') return;
          select.dataset.searchReady = '1';

          const parent = select.parentElement;
          if (!parent) return;

          const wrap = document.createElement('div');
          wrap.className = 'native-select-inline-wrap';
          parent.insertBefore(wrap, select);
          wrap.appendChild(select);

          const input = document.createElement('input');
          input.type = 'text';
          input.className = 'native-select-search';
          input.placeholder = select.dataset.searchPlaceholder || 'Search...';
          wrap.appendChild(input);

          const options = Array.from(select.options);
          const resetOptions = () => options.forEach((opt) => (opt.hidden = false));

          const showInput = () => {
            input.classList.add('show');
            input.focus();
          };

          select.addEventListener('mousedown', showInput);
          select.addEventListener('focus', showInput);

          input.addEventListener('input', () => {
            const term = input.value.trim().toLowerCase();
            options.forEach((opt, idx) => {
              if (idx === 0 && opt.value === '') return;
              opt.hidden = !!term && !opt.text.toLowerCase().includes(term);
            });
          });

          select.addEventListener('change', () => {
            input.value = '';
            resetOptions();
            input.classList.remove('show');
          });

          input.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' || e.key === 'Enter') {
              input.classList.remove('show');
              select.focus();
            }
          });

          document.addEventListener('click', (e) => {
            if (!wrap.contains(e.target)) {
              input.classList.remove('show');
              input.value = '';
              resetOptions();
            }
          });
        });
      };

      initSelectSearch(document);
    })();
  </script>
</body>
</html>`;
}

app.get('/', async (req, res) => {
  ensureAnonCookie(req, res);
  const [politicians] = await db.query('SELECT id, name FROM politicians ORDER BY name ASC');
  const [parties] = await db.query('SELECT id, name FROM parties ORDER BY name ASC');
  const sharedPostId = toPositiveInt(req.query.post, 0);

  const options = politicians
    .map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`)
    .join('');
  const partyOptions = parties.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');

  const body = `
  <section class="hero">
    <h1>Track Political Promises Publicly</h1>
    <p>Watch promise videos, react with upvote or downvote, and share verified claims with your network.</p>
    <div class="emotion-legend">
      <span class="chip chip-neutral">Trending</span>
      <span class="chip chip-hope">Optimistic</span>
      <span class="chip chip-concern">Pessimistic</span>
      <span class="chip chip-fresh">New</span>
    </div>
  </section>

  <section class="feed-controls">
    <label>Politician
    <select id="filter-politician" class="searchable-select" data-search-placeholder="Search politician">
      <option value="">All Politicians</option>
      ${options}
    </select>
    </label>
    <label>Party
    <select id="filter-party" class="searchable-select" data-search-placeholder="Search party">
      <option value="">All Parties</option>
      ${partyOptions}
    </select>
    </label>
    <label>Location
    <input id="filter-location" type="text" placeholder="Search by location" />
    </label>
    <label>Search
    <input id="filter-search" type="text" placeholder="Search promise text, politician, party" />
    </label>
    <label>Mood / Sort
    <select id="filter-sort">
      <option value="trending">Trending</option>
      <option value="new">New</option>
      <option value="optimistic">Most Upvoted</option>
      <option value="pessimistic">Most Downvoted</option>
    </select>
    </label>
    <button id="apply-filters">Apply</button>
    <button id="clear-filters" class="clear-link-btn" type="button">Clear Filters</button>
  </section>

  <section id="feed" class="feed"></section>
  <p id="feed-state" class="state-text">Loading posts...</p>
  <div class="feed-pagination">
    <button id="load-more" class="secondary-btn">Load more</button>
  </div>
  <div id="toast" class="toast" aria-live="polite"></div>
  `;

  let meta = buildSocialMeta({
    title: 'Neta Promise',
    description: 'Track political promises with public voting and transparency.',
    url: absUrl(req, req.originalUrl || '/'),
    type: 'website'
  });

  if (sharedPostId) {
    const [[post]] = await db.query(
      `SELECT p.id, p.promise_text, p.location, p.video_path, pol.name AS politician_name, pol.photo_path,
              pa.name AS party_name, pa.logo_path
       FROM posts p
       JOIN politicians pol ON pol.id = p.politician_id
       LEFT JOIN parties pa ON pa.id = p.party_id
       WHERE p.id = ?
       LIMIT 1`,
      [sharedPostId]
    );

    if (post) {
      const previewImage = post.photo_path || post.logo_path ? absUrl(req, assetUrl(post.photo_path || post.logo_path)) : '';
      const previewVideo = post.video_path ? absUrl(req, assetUrl(post.video_path)) : '';
      const title = `${post.politician_name}${post.party_name ? ` (${post.party_name})` : ''} - Promise`;
      const description = `${post.promise_text}`.slice(0, 220);
      meta = buildSocialMeta({
        title,
        description,
        url: absUrl(req, `/?post=${post.id}`),
        image: previewImage,
        video: previewVideo,
        type: 'video.other'
      });
    }
  }

  res.send(publicShell('Neta Promise Feed', body, '', meta));
});

app.get('/submit', (_req, res) => {
  const body = `
  <section class="card">
    <h1>Submit a Promise</h1>
    <p>Share a promise video link with admins for review.</p>
    <form method="post" action="/api/submissions" class="form-grid">
      <label>Your Name
        <input name="submitter_name" type="text" maxlength="120" required />
      </label>
      <label>Contact (optional)
        <input name="contact" type="text" maxlength="200" />
      </label>
      <label>Politician Name
        <input name="politician_name" type="text" maxlength="120" required />
      </label>
      <label>Location
        <input name="location" type="text" maxlength="120" required />
      </label>
      <label>Video URL
        <input name="video_url" type="url" maxlength="500" required />
      </label>
      <label>Promise Summary
        <textarea name="promise_text" rows="4" maxlength="2000" required></textarea>
      </label>
      <button type="submit">Send to Admin</button>
    </form>
  </section>`;

  res.send(publicShell('Submit Promise', body));
});

app.get('/politicians/:id', async (req, res) => {
  const politicianId = Number(req.params.id);
  if (!politicianId) return res.status(400).send('Invalid id');

  const [[politician]] = await db.query(
    `SELECT p.id, p.name, p.bio, p.photo_path, pa.id AS party_id, pa.name AS party_name, pa.logo_path AS party_logo
     FROM politicians p
     LEFT JOIN parties pa ON pa.id = p.party_id
     WHERE p.id = ?`,
    [politicianId]
  );

  if (!politician) return res.status(404).send('Politician not found');

  const [posts] = await db.query(
    `SELECT p.id, p.promise_text, p.video_path, p.location, p.created_at,
      COALESCE(SUM(CASE WHEN v.vote_type = 'up' THEN 1 ELSE 0 END), 0) AS upvotes,
      COALESCE(SUM(CASE WHEN v.vote_type = 'down' THEN 1 ELSE 0 END), 0) AS downvotes
     FROM posts p
     LEFT JOIN votes v ON v.post_id = p.id
     WHERE p.politician_id = ?
     GROUP BY p.id
     ORDER BY p.created_at DESC`,
    [politicianId]
  );

  const postHtml = posts
    .map(
      (post) => `
      <article class="post-card">
        <video controls playsinline src="${escapeHtml(assetUrl(post.video_path))}"></video>
        <p>${escapeHtml(post.promise_text)}</p>
        <p class="meta">${escapeHtml(post.location || 'N/A')} | 👍 ${post.upvotes} | 👎 ${post.downvotes}</p>
      </article>`
    )
    .join('');

  const body = `
  <section class="card">
    ${politician.photo_path ? `<img class="profile-photo" src="${escapeHtml(assetUrl(politician.photo_path))}" alt="${escapeHtml(politician.name)}" />` : ''}
    <h1>${escapeHtml(politician.name)}</h1>
    <p>${politician.party_id ? `<a href="/parties/${politician.party_id}">${escapeHtml(politician.party_name)}</a>` : 'Independent'}</p>
    <p>${escapeHtml(politician.bio || '')}</p>
  </section>
  <section class="feed">
    ${postHtml || '<p>No promises posted yet.</p>'}
  </section>`;

  res.send(publicShell(`${politician.name} Profile`, body));
});

app.get('/parties/:id', async (req, res) => {
  const partyId = Number(req.params.id);
  if (!partyId) return res.status(400).send('Invalid id');

  const [[party]] = await db.query('SELECT id, name, description, logo_path FROM parties WHERE id = ?', [partyId]);
  if (!party) return res.status(404).send('Party not found');

  const [members] = await db.query('SELECT id, name, photo_path FROM politicians WHERE party_id = ? ORDER BY name ASC', [partyId]);

  const memberHtml = members
    .map(
      (m) => `<a class="member-item" href="/politicians/${m.id}">
        ${m.photo_path ? `<img src="${escapeHtml(assetUrl(m.photo_path))}" alt="${escapeHtml(m.name)}" />` : '<span class="member-avatar-fallback">N</span>'}
        <span class="member-name">${escapeHtml(m.name)}</span>
      </a>`
    )
    .join('');

  const body = `
  <section class="card">
    ${party.logo_path ? `<img class="profile-photo" src="${escapeHtml(assetUrl(party.logo_path))}" alt="${escapeHtml(party.name)}" />` : ''}
    <h1>${escapeHtml(party.name)}</h1>
    <p>${escapeHtml(party.description || '')}</p>
    <h2>Politicians (${members.length})</h2>
    <div class="member-list">${memberHtml || '<p>No politicians found.</p>'}</div>
  </section>`;

  res.send(publicShell(`${party.name} Party`, body));
});

app.get('/api/posts', async (req, res) => {
  const { politician, party, location, q, sort = 'trending' } = req.query;
  const page = toPositiveInt(req.query.page, 1);
  const limit = Math.min(toPositiveInt(req.query.limit, FEED_PAGE_SIZE), 20);
  const offset = (page - 1) * limit;

  const filters = [];
  const params = [];

  if (politician) {
    filters.push('p.politician_id = ?');
    params.push(Number(politician));
  }
  if (party) {
    filters.push('p.party_id = ?');
    params.push(Number(party));
  }

  if (location) {
    filters.push('p.location LIKE ?');
    params.push(`%${location}%`);
  }
  if (q) {
    filters.push('(p.promise_text LIKE ? OR pol.name LIKE ? OR COALESCE(pa.name, \'\') LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }

  let orderBy = 'score DESC, p.created_at DESC';
  if (sort === 'new') orderBy = 'p.created_at DESC';
  if (sort === 'optimistic') orderBy = 'upvotes DESC, p.created_at DESC';
  if (sort === 'pessimistic') orderBy = 'downvotes DESC, p.created_at DESC';

  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

  const [countRows] = await db.query(
    `SELECT COUNT(DISTINCT p.id) AS total
     FROM posts p
     JOIN politicians pol ON pol.id = p.politician_id
     LEFT JOIN parties pa ON pa.id = p.party_id
     ${where}`,
    params
  );
  const total = countRows[0]?.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  const [rows] = await db.query(
    `SELECT p.id, p.promise_text, p.location, p.video_path, p.created_at,
      pol.id AS politician_id, pol.name AS politician_name, pol.photo_path AS politician_photo,
      pa.id AS party_id, pa.name AS party_name, pa.logo_path AS party_logo,
      COALESCE(SUM(CASE WHEN v.vote_type = 'up' THEN 1 ELSE 0 END), 0) AS upvotes,
      COALESCE(SUM(CASE WHEN v.vote_type = 'down' THEN 1 ELSE 0 END), 0) AS downvotes,
      (
        COALESCE(SUM(CASE WHEN v.vote_type = 'up' THEN 1 ELSE 0 END), 0)
        - COALESCE(SUM(CASE WHEN v.vote_type = 'down' THEN 1 ELSE 0 END), 0)
      ) AS score
     FROM posts p
     JOIN politicians pol ON pol.id = p.politician_id
     LEFT JOIN parties pa ON pa.id = p.party_id
     LEFT JOIN votes v ON v.post_id = p.id
     ${where}
     GROUP BY p.id, pol.id, pa.id
     ORDER BY ${orderBy}
     LIMIT ?
     OFFSET ?`,
    [...params, limit, offset]
  );

  const [ads] = await db.query('SELECT id, title, image_path, contact_url FROM ads ORDER BY created_at DESC LIMIT 20');

  res.json({ posts: rows, ads, page, totalPages, total, hasMore: page < totalPages });
});

app.post('/api/votes', async (req, res) => {
  const anonId = ensureAnonCookie(req, res);
  const postId = Number(req.body.postId);
  const voteType = req.body.voteType;

  if (!postId || !['up', 'down'].includes(voteType)) {
    return res.status(400).json({ message: 'Invalid vote payload' });
  }

  const [dailyCountRows] = await db.query(
    'SELECT COUNT(*) AS count FROM votes WHERE voter_id = ? AND vote_date = CURRENT_DATE',
    [anonId]
  );
  const dailyCount = dailyCountRows[0]?.count || 0;

  if (dailyCount >= DAILY_VOTE_LIMIT) {
    return res.status(429).json({ message: 'Daily vote limit reached (30)' });
  }

  const [existingRows] = await db.query(
    'SELECT id FROM votes WHERE voter_id = ? AND post_id = ? AND vote_date = CURRENT_DATE LIMIT 1',
    [anonId, postId]
  );

  if (existingRows.length) {
    return res.status(409).json({ message: 'Already voted for this post today' });
  }

  await db.query('INSERT INTO votes (post_id, voter_id, vote_type, vote_date) VALUES (?, ?, ?, CURRENT_DATE)', [
    postId,
    anonId,
    voteType
  ]);

  return res.json({ message: 'Vote accepted' });
});

app.post('/api/submissions', async (req, res) => {
  const { submitter_name, contact, politician_name, location, video_url, promise_text } = req.body;

  if (!submitter_name || !politician_name || !location || !video_url || !promise_text) {
    return res.status(400).send('Missing fields');
  }

  await db.query(
    `INSERT INTO submissions
      (submitter_name, contact, politician_name, location, video_url, promise_text)
      VALUES (?, ?, ?, ?, ?, ?)`,
    [submitter_name, contact || null, politician_name, location, video_url, promise_text]
  );

  return res.redirect('/?submitted=1');
});

app.get('/health', async (_req, res) => {
  try {
    await db.query('SELECT 1 AS ok');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || 'db error' });
  }
});

app.get('/admin/login', (req, res) => {
  if (req.session.admin) return res.redirect('/admin');

  const html = `
  <section class="admin-card">
    <h1>Admin Login</h1>
    <form method="post" action="/admin/login" class="admin-form">
      <label>Email <input type="email" name="email" required /></label>
      <label>Password <input type="password" name="password" required /></label>
      <button type="submit">Login</button>
    </form>
  </section>`;

  return res.send(adminShell('Admin Login', html));
});

app.post('/admin/login', async (req, res) => {
  const { email, password } = req.body;

  const [[admin]] = await db.query('SELECT id, email, password_hash FROM admins WHERE email = ? LIMIT 1', [email]);
  if (!admin) return res.status(401).send('Invalid credentials');

  let isValid = false;
  if (admin.password_hash.startsWith('$2')) {
    isValid = await bcrypt.compare(password, admin.password_hash);
  } else {
    isValid = password === admin.password_hash;
  }
  if (!isValid) return res.status(401).send('Invalid credentials');

  req.session.admin = { id: admin.id, email: admin.email };
  return res.redirect('/admin');
});

app.post('/admin/logout', requireAdmin, (req, res) => {
  req.session.destroy(() => res.redirect('/admin/login'));
});

app.get('/admin', requireAdmin, async (req, res) => {
  const pages = {
    party: toPositiveInt(req.query.party_page, 1),
    politician: toPositiveInt(req.query.politician_page, 1),
    post: toPositiveInt(req.query.post_page, 1),
    ad: toPositiveInt(req.query.ad_page, 1),
    submission: toPositiveInt(req.query.submission_page, 1)
  };

  const offsets = {
    party: (pages.party - 1) * ADMIN_PAGE_SIZE,
    politician: (pages.politician - 1) * ADMIN_PAGE_SIZE,
    post: (pages.post - 1) * ADMIN_PAGE_SIZE,
    ad: (pages.ad - 1) * ADMIN_PAGE_SIZE,
    submission: (pages.submission - 1) * ADMIN_PAGE_SIZE
  };

  const [[partyCountRow]] = await db.query('SELECT COUNT(*) AS total FROM parties');
  const [[politicianCountRow]] = await db.query('SELECT COUNT(*) AS total FROM politicians');
  const [[postCountRow]] = await db.query('SELECT COUNT(*) AS total FROM posts');
  const [[adCountRow]] = await db.query('SELECT COUNT(*) AS total FROM ads');
  const [[submissionCountRow]] = await db.query('SELECT COUNT(*) AS total FROM submissions');

  const [partyRows] = await db.query(
    'SELECT id, name, description, logo_path FROM parties ORDER BY id DESC LIMIT ? OFFSET ?',
    [ADMIN_PAGE_SIZE, offsets.party]
  );
  const [politicianRows] = await db.query(
    `SELECT pol.id, pol.name, pol.bio, pol.photo_path, pa.name AS party_name
     FROM politicians pol
     LEFT JOIN parties pa ON pa.id = pol.party_id
     ORDER BY pol.id DESC
     LIMIT ? OFFSET ?`,
    [ADMIN_PAGE_SIZE, offsets.politician]
  );
  const [postRows] = await db.query(
    `SELECT p.id, p.promise_text, p.location, p.video_path, pol.name AS politician_name
     FROM posts p
     JOIN politicians pol ON pol.id = p.politician_id
     ORDER BY p.id DESC
     LIMIT ? OFFSET ?`,
    [ADMIN_PAGE_SIZE, offsets.post]
  );
  const [adRows] = await db.query('SELECT id, title, image_path, contact_url FROM ads ORDER BY id DESC LIMIT ? OFFSET ?', [
    ADMIN_PAGE_SIZE,
    offsets.ad
  ]);
  const [submissionRows] = await db.query(
    'SELECT id, submitter_name, politician_name, location, video_url, promise_text, created_at FROM submissions ORDER BY id DESC LIMIT ? OFFSET ?',
    [ADMIN_PAGE_SIZE, offsets.submission]
  );

  const [allParties] = await db.query('SELECT id, name FROM parties ORDER BY name ASC');
  const [allPoliticians] = await db.query('SELECT id, name FROM politicians ORDER BY name ASC');

  const editPartyId = toPositiveInt(req.query.edit_party_id, 0);
  const editPoliticianId = toPositiveInt(req.query.edit_politician_id, 0);
  const editPostId = toPositiveInt(req.query.edit_post_id, 0);
  const editAdId = toPositiveInt(req.query.edit_ad_id, 0);

  let editParty = null;
  let editPolitician = null;
  let editPost = null;
  let editAd = null;

  if (editPartyId) {
    const [[row]] = await db.query('SELECT id, name, description, logo_path FROM parties WHERE id = ?', [editPartyId]);
    editParty = row || null;
  }
  if (editPoliticianId) {
    const [[row]] = await db.query('SELECT id, name, party_id, bio, photo_path FROM politicians WHERE id = ?', [editPoliticianId]);
    editPolitician = row || null;
  }
  if (editPostId) {
    const [[row]] = await db.query(
      'SELECT id, politician_id, party_id, promise_text, location, video_path FROM posts WHERE id = ?',
      [editPostId]
    );
    editPost = row || null;
  }
  if (editAdId) {
    const [[row]] = await db.query('SELECT id, title, image_path, contact_url FROM ads WHERE id = ?', [editAdId]);
    editAd = row || null;
  }

  const makePartyOptions = (selectedId) =>
    allParties
      .map(
        (p) =>
          `<option value="${p.id}" ${Number(selectedId) === p.id ? 'selected' : ''}>${escapeHtml(p.name)}</option>`
      )
      .join('');

  const makePoliticianOptions = (selectedId) =>
    allPoliticians
      .map(
        (p) =>
          `<option value="${p.id}" ${Number(selectedId) === p.id ? 'selected' : ''}>${escapeHtml(p.name)}</option>`
      )
      .join('');

  const partyOptions = makePartyOptions(editPolitician?.party_id);
  const politicianOptions = makePoliticianOptions(editPost?.politician_id);

  const totals = {
    party: Math.max(1, Math.ceil((partyCountRow.total || 0) / ADMIN_PAGE_SIZE)),
    politician: Math.max(1, Math.ceil((politicianCountRow.total || 0) / ADMIN_PAGE_SIZE)),
    post: Math.max(1, Math.ceil((postCountRow.total || 0) / ADMIN_PAGE_SIZE)),
    ad: Math.max(1, Math.ceil((adCountRow.total || 0) / ADMIN_PAGE_SIZE)),
    submission: Math.max(1, Math.ceil((submissionCountRow.total || 0) / ADMIN_PAGE_SIZE))
  };

  const adminLink = (key, value, hash) => {
    const params = new URLSearchParams(req.query);
    params.set(key, String(value));
    return `/admin?${params.toString()}#${hash}`;
  };

  const pager = (sectionKey, queryKey, hash) => {
    if (totals[sectionKey] <= 1) return '';
    const prev = pages[sectionKey] > 1 ? `<a href="${adminLink(queryKey, pages[sectionKey] - 1, hash)}">Prev</a>` : '';
    const next =
      pages[sectionKey] < totals[sectionKey] ? `<a href="${adminLink(queryKey, pages[sectionKey] + 1, hash)}">Next</a>` : '';
    return `<div class="pager">${prev}<span>Page ${pages[sectionKey]} / ${totals[sectionKey]}</span>${next}</div>`;
  };

  const html = `
  <header class="admin-header">
    <h1>Admin Panel</h1>
    <form method="post" action="/admin/logout"><button>Logout</button></form>
  </header>
  <section class="admin-layout">
    <aside class="admin-sidebar">
      <a href="#parties" data-target="parties">Parties</a>
      <a href="#politicians" data-target="politicians">Politicians</a>
      <a href="#posts" data-target="posts">Posts</a>
      <a href="#ads" data-target="ads">Ads</a>
      <a href="#submissions" data-target="submissions">Submissions</a>
    </aside>

    <div class="admin-content">
      <article id="parties" data-section="parties" class="admin-card admin-section">
        <h2>${editParty ? 'Edit Party' : 'Parties'}</h2>
        <form method="post" action="${editParty ? `/admin/parties/${editParty.id}/update` : '/admin/parties'}" enctype="multipart/form-data" class="admin-form">
          <label>Name <input name="name" required maxlength="120" value="${escapeHtml(editParty?.name || '')}" /></label>
          <label>Description <textarea name="description" rows="3">${escapeHtml(editParty?.description || '')}</textarea></label>
          <label>Logo <input type="file" name="logo" accept="image/*" /></label>
          ${editParty?.logo_path ? `<img class="tiny-img" src="${escapeHtml(assetUrl(editParty.logo_path))}" alt="${escapeHtml(editParty.name)}" />` : ''}
          <div class="row-actions">
            <button type="submit">${editParty ? 'Update Party' : 'Save Party'}</button>
            ${editParty ? `<a class="link-btn" href="/admin#parties">Cancel Edit</a>` : ''}
          </div>
        </form>
        <ul>${partyRows
          .map(
            (row) => `<li>
              <div class="row-info">${row.logo_path ? `<img class="tiny-img" src="${escapeHtml(assetUrl(row.logo_path))}" alt="${escapeHtml(row.name)}"/>` : ''}<strong>${escapeHtml(row.name)}</strong></div>
              <div class="row-actions">
                <a class="link-btn" href="${adminLink('edit_party_id', row.id, 'parties')}">Edit</a>
                <form method="post" action="/admin/parties/${row.id}/delete"><button>Delete</button></form>
              </div>
            </li>`
          )
          .join('')}</ul>
        ${pager('party', 'party_page', 'parties')}
      </article>

      <article id="politicians" data-section="politicians" class="admin-card admin-section">
        <h2>${editPolitician ? 'Edit Politician' : 'Politicians'}</h2>
        <form method="post" action="${editPolitician ? `/admin/politicians/${editPolitician.id}/update` : '/admin/politicians'}" enctype="multipart/form-data" class="admin-form">
          <label>Name <input name="name" required maxlength="120" value="${escapeHtml(editPolitician?.name || '')}" /></label>
          <label>Party <select name="party_id" class="searchable-select" data-search-placeholder="Search party"><option value="">Independent</option>${partyOptions}</select></label>
          <label>Brief Intro <textarea name="bio" rows="3">${escapeHtml(editPolitician?.bio || '')}</textarea></label>
          <label>Photo <input type="file" name="photo" accept="image/*" /></label>
          ${editPolitician?.photo_path ? `<img class="tiny-img" src="${escapeHtml(assetUrl(editPolitician.photo_path))}" alt="${escapeHtml(editPolitician.name)}" />` : ''}
          <div class="row-actions">
            <button type="submit">${editPolitician ? 'Update Politician' : 'Save Politician'}</button>
            ${editPolitician ? `<a class="link-btn" href="/admin#politicians">Cancel Edit</a>` : ''}
          </div>
        </form>
        <ul>${politicianRows
          .map(
            (row) => `<li>
              <div class="row-info">${row.photo_path ? `<img class="tiny-img" src="${escapeHtml(assetUrl(row.photo_path))}" alt="${escapeHtml(row.name)}"/>` : ''}<strong>${escapeHtml(row.name)}</strong> <span>(${escapeHtml(row.party_name || 'Independent')})</span></div>
              <div class="row-actions">
                <a class="link-btn" href="${adminLink('edit_politician_id', row.id, 'politicians')}">Edit</a>
                <form method="post" action="/admin/politicians/${row.id}/delete"><button>Delete</button></form>
              </div>
            </li>`
          )
          .join('')}</ul>
        ${pager('politician', 'politician_page', 'politicians')}
      </article>

      <article id="posts" data-section="posts" class="admin-card admin-section">
        <h2>${editPost ? 'Edit Post' : 'Posts'}</h2>
        <form method="post" action="${editPost ? `/admin/posts/${editPost.id}/update` : '/admin/posts'}" enctype="multipart/form-data" class="admin-form">
          <label>Politician <select name="politician_id" class="searchable-select" data-search-placeholder="Search politician" required>${politicianOptions}</select></label>
          <label>Party (optional) <select name="party_id" class="searchable-select" data-search-placeholder="Search party"><option value="">Auto / None</option>${makePartyOptions(editPost?.party_id)}</select></label>
          <label>Location <input name="location" required maxlength="120" value="${escapeHtml(editPost?.location || '')}" /></label>
          <label>Promise Text <textarea name="promise_text" rows="3" required>${escapeHtml(editPost?.promise_text || '')}</textarea></label>
          <label>Video File (9:16) <input type="file" name="video" accept="video/*" ${editPost ? '' : 'required'} /></label>
          ${editPost?.video_path ? `<video controls class="admin-preview-video" src="${escapeHtml(assetUrl(editPost.video_path))}"></video>` : ''}
          <div class="row-actions">
            <button type="submit">${editPost ? 'Update Post' : 'Publish Post'}</button>
            ${editPost ? `<a class="link-btn" href="/admin#posts">Cancel Edit</a>` : ''}
          </div>
        </form>
        <ul>${postRows
          .map(
            (row) => `<li>
              <div class="row-info"><strong>#${row.id}</strong> ${escapeHtml(row.politician_name)} <span>${escapeHtml(row.location)}</span></div>
              <div class="row-actions">
                <a class="link-btn" href="${adminLink('edit_post_id', row.id, 'posts')}">Edit</a>
                <form method="post" action="/admin/posts/${row.id}/delete"><button>Delete</button></form>
              </div>
            </li>`
          )
          .join('')}</ul>
        ${pager('post', 'post_page', 'posts')}
      </article>

      <article id="ads" data-section="ads" class="admin-card admin-section">
        <h2>${editAd ? 'Edit Ad' : 'Ads'}</h2>
        <form method="post" action="${editAd ? `/admin/ads/${editAd.id}/update` : '/admin/ads'}" enctype="multipart/form-data" class="admin-form">
          <label>Title <input name="title" required maxlength="200" value="${escapeHtml(editAd?.title || '')}" /></label>
          <label>Contact URL <input name="contact_url" type="url" required maxlength="500" value="${escapeHtml(editAd?.contact_url || '')}" /></label>
          <label>Image <input type="file" name="image" accept="image/*" ${editAd ? '' : 'required'} /></label>
          ${editAd?.image_path ? `<img class="admin-preview-banner" src="${escapeHtml(assetUrl(editAd.image_path))}" alt="${escapeHtml(editAd.title)}"/>` : ''}
          <div class="row-actions">
            <button type="submit">${editAd ? 'Update Ad' : 'Save Ad'}</button>
            ${editAd ? `<a class="link-btn" href="/admin#ads">Cancel Edit</a>` : ''}
          </div>
        </form>
        <ul>${adRows
          .map(
            (row) => `<li>
              <div class="row-info"><img class="tiny-img" src="${escapeHtml(assetUrl(row.image_path))}" alt="${escapeHtml(row.title)}"/><strong>${escapeHtml(row.title)}</strong></div>
              <div class="row-actions">
                <a class="link-btn" href="${adminLink('edit_ad_id', row.id, 'ads')}">Edit</a>
                <form method="post" action="/admin/ads/${row.id}/delete"><button>Delete</button></form>
              </div>
            </li>`
          )
          .join('')}</ul>
        ${pager('ad', 'ad_page', 'ads')}
      </article>

      <article id="submissions" data-section="submissions" class="admin-card admin-section">
        <h2>Crowdsourced Submissions</h2>
        <table>
          <thead><tr><th>ID</th><th>By</th><th>Politician</th><th>Location</th><th>Video</th><th>Summary</th><th>Date</th></tr></thead>
          <tbody>
            ${submissionRows
              .map(
                (s) => `<tr>
                  <td>${s.id}</td>
                  <td>${escapeHtml(s.submitter_name)}</td>
                  <td>${escapeHtml(s.politician_name)}</td>
                  <td>${escapeHtml(s.location)}</td>
                  <td><a href="${escapeHtml(s.video_url)}" target="_blank" rel="noreferrer">link</a></td>
                  <td>${escapeHtml(s.promise_text)}</td>
                  <td>${new Date(s.created_at).toLocaleDateString()}</td>
                </tr>`
              )
              .join('')}
          </tbody>
        </table>
        ${pager('submission', 'submission_page', 'submissions')}
      </article>
    </div>
  </section>`;

  return res.send(adminShell('Admin Panel', html));
});

app.post('/admin/parties', requireAdmin, upload.single('logo'), async (req, res) => {
  const { name, description } = req.body;
  if (!name) return res.status(400).send('name required');
  const logoPath = await saveUploadedFile(req.file, 'parties');
  await db.query('INSERT INTO parties (name, description, logo_path) VALUES (?, ?, ?)', [
    name,
    description || null,
    logoPath
  ]);
  return res.redirect('/admin');
});

app.post('/admin/politicians', requireAdmin, upload.single('photo'), async (req, res) => {
  const { name, party_id, bio } = req.body;
  if (!name) return res.status(400).send('name required');
  const photoPath = await saveUploadedFile(req.file, 'politicians');
  await db.query('INSERT INTO politicians (name, party_id, bio, photo_path) VALUES (?, ?, ?, ?)', [
    name,
    party_id ? Number(party_id) : null,
    bio || null,
    photoPath
  ]);
  return res.redirect('/admin');
});

app.post('/admin/posts', requireAdmin, upload.single('video'), async (req, res) => {
  const { promise_text, location, politician_id, party_id } = req.body;
  if (!promise_text || !location || !politician_id || !req.file) {
    return res.status(400).send('missing fields');
  }

  let partyId = party_id ? Number(party_id) : null;
  if (!partyId) {
    const [[p]] = await db.query('SELECT party_id FROM politicians WHERE id = ? LIMIT 1', [Number(politician_id)]);
    partyId = p?.party_id || null;
  }

  const videoPath = await saveUploadedFile(req.file, 'posts');
  await db.query(
    'INSERT INTO posts (politician_id, party_id, promise_text, location, video_path) VALUES (?, ?, ?, ?, ?)',
    [Number(politician_id), partyId, promise_text, location, videoPath]
  );

  return res.redirect('/admin');
});

app.post('/admin/ads', requireAdmin, upload.single('image'), async (req, res) => {
  const { title, contact_url } = req.body;
  if (!title || !contact_url || !req.file) {
    return res.status(400).send('missing fields');
  }
  const imagePath = await saveUploadedFile(req.file, 'ads');

  await db.query('INSERT INTO ads (title, image_path, contact_url) VALUES (?, ?, ?)', [
    title,
    imagePath,
    contact_url
  ]);
  return res.redirect('/admin');
});

app.post('/admin/parties/:id/update', requireAdmin, upload.single('logo'), async (req, res) => {
  const id = Number(req.params.id);
  const { name, description } = req.body;
  if (!id || !name) return res.status(400).send('invalid payload');

  const [[existing]] = await db.query('SELECT logo_path FROM parties WHERE id = ?', [id]);
  if (!existing) return res.status(404).send('party not found');

  const uploadedLogo = await saveUploadedFile(req.file, 'parties');
  const logoPath = uploadedLogo || existing.logo_path || null;
  await db.query('UPDATE parties SET name = ?, description = ?, logo_path = ? WHERE id = ?', [
    name,
    description || null,
    logoPath,
    id
  ]);
  return res.redirect('/admin#parties');
});

app.post('/admin/politicians/:id/update', requireAdmin, upload.single('photo'), async (req, res) => {
  const id = Number(req.params.id);
  const { name, party_id, bio } = req.body;
  if (!id || !name) return res.status(400).send('invalid payload');

  const [[existing]] = await db.query('SELECT photo_path FROM politicians WHERE id = ?', [id]);
  if (!existing) return res.status(404).send('politician not found');

  const uploadedPhoto = await saveUploadedFile(req.file, 'politicians');
  const photoPath = uploadedPhoto || existing.photo_path || null;
  await db.query('UPDATE politicians SET name = ?, party_id = ?, bio = ?, photo_path = ? WHERE id = ?', [
    name,
    party_id ? Number(party_id) : null,
    bio || null,
    photoPath,
    id
  ]);
  return res.redirect('/admin#politicians');
});

app.post('/admin/posts/:id/update', requireAdmin, upload.single('video'), async (req, res) => {
  const id = Number(req.params.id);
  const { promise_text, location, politician_id, party_id } = req.body;
  if (!id || !promise_text || !location || !politician_id) return res.status(400).send('invalid payload');

  const [[existing]] = await db.query('SELECT video_path FROM posts WHERE id = ?', [id]);
  if (!existing) return res.status(404).send('post not found');

  let partyId = party_id ? Number(party_id) : null;
  if (!partyId) {
    const [[p]] = await db.query('SELECT party_id FROM politicians WHERE id = ? LIMIT 1', [Number(politician_id)]);
    partyId = p?.party_id || null;
  }

  const uploadedVideo = await saveUploadedFile(req.file, 'posts');
  const videoPath = uploadedVideo || existing.video_path;
  await db.query(
    'UPDATE posts SET politician_id = ?, party_id = ?, promise_text = ?, location = ?, video_path = ? WHERE id = ?',
    [Number(politician_id), partyId, promise_text, location, videoPath, id]
  );

  return res.redirect('/admin#posts');
});

app.post('/admin/ads/:id/update', requireAdmin, upload.single('image'), async (req, res) => {
  const id = Number(req.params.id);
  const { title, contact_url } = req.body;
  if (!id || !title || !contact_url) return res.status(400).send('invalid payload');

  const [[existing]] = await db.query('SELECT image_path FROM ads WHERE id = ?', [id]);
  if (!existing) return res.status(404).send('ad not found');

  const uploadedImage = await saveUploadedFile(req.file, 'ads');
  const imagePath = uploadedImage || existing.image_path;
  await db.query('UPDATE ads SET title = ?, contact_url = ?, image_path = ? WHERE id = ?', [
    title,
    contact_url,
    imagePath,
    id
  ]);
  return res.redirect('/admin#ads');
});

app.post('/admin/parties/:id/delete', requireAdmin, async (req, res) => {
  await db.query('DELETE FROM parties WHERE id = ?', [Number(req.params.id)]);
  return res.redirect('/admin');
});

app.post('/admin/politicians/:id/delete', requireAdmin, async (req, res) => {
  await db.query('DELETE FROM politicians WHERE id = ?', [Number(req.params.id)]);
  return res.redirect('/admin');
});

app.post('/admin/posts/:id/delete', requireAdmin, async (req, res) => {
  await db.query('DELETE FROM posts WHERE id = ?', [Number(req.params.id)]);
  return res.redirect('/admin');
});

app.post('/admin/ads/:id/delete', requireAdmin, async (req, res) => {
  await db.query('DELETE FROM ads WHERE id = ?', [Number(req.params.id)]);
  return res.redirect('/admin');
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).send('Internal server error');
});

async function startServer() {
  await ensureSchemaCompatibility();
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
