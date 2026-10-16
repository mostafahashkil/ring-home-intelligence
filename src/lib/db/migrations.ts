/**
 * Ordered, append-only schema migrations. Never edit a shipped migration — add a new one.
 * JSON columns hold validated structures (see domain/types.ts).
 */
export const MIGRATIONS: { id: number; name: string; sql: string }[] = [
  {
    id: 1,
    name: "initial_schema",
    sql: `
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('owner','member')),
        created_at INTEGER NOT NULL
      );

      CREATE TABLE sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX sessions_user ON sessions(user_id);

      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE app_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE cameras (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        provider_device_id TEXT NOT NULL,
        name TEXT NOT NULL,
        zone TEXT,
        status TEXT NOT NULL DEFAULT 'unknown',
        supports_clips INTEGER NOT NULL DEFAULT 0,
        component_ids TEXT NOT NULL DEFAULT '[]',
        demo INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL,
        UNIQUE (provider, provider_device_id)
      );

      CREATE TABLE profiles (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        relationship TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        consent_status TEXT NOT NULL DEFAULT 'pending',
        notify_mode TEXT NOT NULL DEFAULT 'each_arrival',
        camera_ids TEXT,
        active_window TEXT,
        review_threshold REAL,
        demo INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE events (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        provider_event_id TEXT,
        timestamp INTEGER NOT NULL,
        end_timestamp INTEGER,
        camera_id TEXT REFERENCES cameras(id) ON DELETE SET NULL,
        zone_id TEXT,
        event_type TEXT NOT NULL,
        provider_type TEXT,
        summary TEXT NOT NULL,
        observations TEXT NOT NULL DEFAULT '[]',
        inference TEXT,
        confidence REAL,
        severity TEXT NOT NULL DEFAULT 'low',
        association TEXT,
        household_profile_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
        evidence_reference TEXT,
        signals TEXT NOT NULL DEFAULT '[]',
        rule_id TEXT,
        decision TEXT,
        feedback TEXT NOT NULL DEFAULT '[]',
        derived_from TEXT NOT NULL DEFAULT '[]',
        demo INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        UNIQUE (provider, provider_event_id)
      );
      CREATE INDEX events_ts ON events(timestamp DESC);
      CREATE INDEX events_camera_ts ON events(camera_id, timestamp DESC);

      CREATE TABLE rules (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        priority INTEGER NOT NULL DEFAULT 50,
        categories TEXT NOT NULL DEFAULT '[]',
        camera_ids TEXT NOT NULL DEFAULT '[]',
        profile_ids TEXT NOT NULL DEFAULT '[]',
        min_confidence REAL,
        min_severity TEXT,
        time_window TEXT,
        action TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE notifications (
        id TEXT PRIMARY KEY,
        event_id TEXT REFERENCES events(id) ON DELETE CASCADE,
        rule_id TEXT,
        channel TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        explanation TEXT NOT NULL,
        severity TEXT NOT NULL,
        dedup_key TEXT,
        camera_id TEXT,
        created_at INTEGER NOT NULL,
        read_at INTEGER,
        demo INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX notifications_ts ON notifications(created_at DESC);

      CREATE TABLE audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        actor TEXT NOT NULL,
        action TEXT NOT NULL,
        target TEXT,
        details TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX audit_ts ON audit_log(ts DESC);

      CREATE TABLE ring_credentials (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        account_id TEXT,
        access_token_enc TEXT,
        refresh_token_enc TEXT,
        access_expires_at INTEGER,
        status TEXT NOT NULL DEFAULT 'connected',
        source TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE oauth_states (
        state_hash TEXT PRIMARY KEY,
        code_verifier_enc TEXT NOT NULL,
        user_id TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE webhook_receipts (
        request_id TEXT PRIMARY KEY,
        received_at INTEGER NOT NULL
      );

      CREATE TABLE login_attempts (
        key TEXT PRIMARY KEY,
        count INTEGER NOT NULL,
        window_start INTEGER NOT NULL
      );
    `,
  },
];
