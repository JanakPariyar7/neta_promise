-- Supabase/PostgreSQL schema
-- Run this in Supabase SQL Editor (or any PostgreSQL database).

CREATE TABLE IF NOT EXISTS admins (
  id BIGSERIAL PRIMARY KEY,
  email VARCHAR(190) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS parties (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(120) NOT NULL UNIQUE,
  description TEXT,
  logo_path VARCHAR(1000),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS politicians (
  id BIGSERIAL PRIMARY KEY,
  party_id BIGINT NULL REFERENCES parties(id) ON DELETE SET NULL,
  name VARCHAR(120) NOT NULL,
  bio TEXT,
  photo_path VARCHAR(1000),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS posts (
  id BIGSERIAL PRIMARY KEY,
  politician_id BIGINT NOT NULL REFERENCES politicians(id) ON DELETE CASCADE,
  party_id BIGINT NULL REFERENCES parties(id) ON DELETE SET NULL,
  promise_text TEXT NOT NULL,
  location VARCHAR(120),
  video_path VARCHAR(1000) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS votes (
  id BIGSERIAL PRIMARY KEY,
  post_id BIGINT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  voter_id VARCHAR(64) NOT NULL,
  vote_type TEXT NOT NULL CHECK (vote_type IN ('up', 'down')),
  vote_date DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uniq_vote_per_post_per_day UNIQUE (post_id, voter_id, vote_date)
);

CREATE INDEX IF NOT EXISTS idx_votes_voter_day ON votes(voter_id, vote_date);

CREATE TABLE IF NOT EXISTS submissions (
  id BIGSERIAL PRIMARY KEY,
  submitter_name VARCHAR(120) NOT NULL,
  contact VARCHAR(200),
  politician_name VARCHAR(120) NOT NULL,
  location VARCHAR(120) NOT NULL,
  video_url VARCHAR(1000) NOT NULL,
  promise_text TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ads (
  id BIGSERIAL PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  image_path VARCHAR(1000) NOT NULL,
  contact_url VARCHAR(1000) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO admins (email, password_hash)
VALUES ('admin@example.com', 'admin123')
ON CONFLICT (email) DO NOTHING;
