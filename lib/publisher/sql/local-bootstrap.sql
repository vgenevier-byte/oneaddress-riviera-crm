-- Source Publisher schema. Bootstrap of an EMPTY LOCAL store only. Never run on historical Production.
CREATE TABLE IF NOT EXISTS publisher_music (
          id BIGSERIAL PRIMARY KEY,
          title TEXT NOT NULL,
          artist TEXT NOT NULL,
          availability_status TEXT NOT NULL DEFAULT 'unknown'
            CHECK (availability_status IN ('available', 'unavailable', 'unknown')),
          last_used_at TIMESTAMPTZ,
          times_used INTEGER NOT NULL DEFAULT 0,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

CREATE UNIQUE INDEX IF NOT EXISTS publisher_music_title_artist_unique
        ON publisher_music (LOWER(title), LOWER(artist));

CREATE TABLE IF NOT EXISTS publisher_posts (
          id UUID PRIMARY KEY,
          post_date DATE NOT NULL,
          creation_mode TEXT NOT NULL DEFAULT 'daily',
          creative_universe TEXT,
          creative_moment TEXT,
          creative_style TEXT,
          generation_request_id UUID,
          theme TEXT,
          moment TEXT,
          scene_summary TEXT,
          visual_signature TEXT,
          caption TEXT,
          hashtags TEXT[] NOT NULL DEFAULT '{}',
          primary_music_id BIGINT REFERENCES publisher_music(id),
          alternative_music_ids BIGINT[] NOT NULL DEFAULT '{}',
          music_used_id BIGINT REFERENCES publisher_music(id),
          location TEXT,
          format TEXT NOT NULL DEFAULT 'Feed 4:5',
          image_url TEXT,
          image_pathname TEXT,
          image_prompt TEXT,
          image_content_type TEXT,
          image_width INTEGER,
          image_height INTEGER,
          image_bytes INTEGER,
          image_etag TEXT,
          status TEXT NOT NULL DEFAULT 'draft'
            CHECK (status IN ('draft', 'published')),
          generation_status TEXT NOT NULL DEFAULT 'generating'
            CHECK (generation_status IN ('generating', 'ready', 'error')),
          generation_run_id UUID,
          generation_started_at TIMESTAMPTZ,
          generation_progress JSONB NOT NULL DEFAULT '{}',
          error_message TEXT,
          published_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

ALTER TABLE publisher_posts
          ADD COLUMN IF NOT EXISTS creation_mode TEXT NOT NULL DEFAULT 'daily',
          ADD COLUMN IF NOT EXISTS creative_universe TEXT,
          ADD COLUMN IF NOT EXISTS creative_moment TEXT,
          ADD COLUMN IF NOT EXISTS creative_style TEXT,
          ADD COLUMN IF NOT EXISTS generation_request_id UUID,
          ADD COLUMN IF NOT EXISTS generation_progress JSONB NOT NULL DEFAULT '{}';

CREATE UNIQUE INDEX IF NOT EXISTS publisher_posts_daily_date_unique
        ON publisher_posts (post_date)
        WHERE creation_mode = 'daily';

CREATE UNIQUE INDEX IF NOT EXISTS publisher_posts_generation_request_unique
        ON publisher_posts (generation_request_id)
        WHERE generation_request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS publisher_posts_recent_idx
        ON publisher_posts (post_date DESC);
