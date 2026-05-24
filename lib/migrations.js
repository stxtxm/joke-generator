const fs = require('fs');

// Exported migrations runner. Intended to be idempotent and safe to run at
// server startup. Uses synchronous better-sqlite3 DB handles.
function runMigrations(db) {
  // Ensure migrations table exists
  db.exec(`CREATE TABLE IF NOT EXISTS migrations (id TEXT PRIMARY KEY, applied_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);

  function hasMigration(id) {
    return !!db.prepare('SELECT 1 FROM migrations WHERE id = ?').get(id);
  }

  function markMigration(id) {
    db.prepare('INSERT OR REPLACE INTO migrations (id) VALUES (?)').run(id);
  }

  function ensureColumn(table, column, definition) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all();
    const exists = cols.some(c => c.name === column);
    if (!exists) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }

  const migrations = [
    {
      id: '001_create_tables',
      up: () => {
        db.exec(`
          CREATE TABLE IF NOT EXISTS jokes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            content TEXT UNIQUE,
            category TEXT,
            rating INTEGER DEFAULT 0,
            likes INTEGER DEFAULT 0,
            dislikes INTEGER DEFAULT 0,
            length INTEGER DEFAULT 0,
            has_emoji INTEGER DEFAULT 0,
            has_wordplay INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `);

        db.exec(`
          CREATE TABLE IF NOT EXISTS feedback (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            joke_id INTEGER,
            content TEXT,
            rating INTEGER,
            length INTEGER,
            has_emoji INTEGER,
            has_wordplay INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `);
      }
    },
    {
      id: '002_ensure_jokes_columns',
      up: () => {
        ensureColumn('jokes', 'category', 'TEXT');
        ensureColumn('jokes', 'rating', 'INTEGER DEFAULT 0');
        ensureColumn('jokes', 'likes', 'INTEGER DEFAULT 0');
        ensureColumn('jokes', 'dislikes', 'INTEGER DEFAULT 0');
        ensureColumn('jokes', 'length', 'INTEGER DEFAULT 0');
        ensureColumn('jokes', 'has_emoji', 'INTEGER DEFAULT 0');
        ensureColumn('jokes', 'has_wordplay', 'INTEGER DEFAULT 0');
        ensureColumn('jokes', 'created_at', "DATETIME DEFAULT CURRENT_TIMESTAMP");
      }
    },
    {
      id: '003_ensure_feedback_columns',
      up: () => {
        ensureColumn('feedback', 'joke_id', 'INTEGER');
        ensureColumn('feedback', 'content', 'TEXT');
        ensureColumn('feedback', 'rating', 'INTEGER');
        ensureColumn('feedback', 'length', 'INTEGER');
        ensureColumn('feedback', 'has_emoji', 'INTEGER');
        ensureColumn('feedback', 'has_wordplay', 'INTEGER');
        ensureColumn('feedback', 'created_at', "DATETIME DEFAULT CURRENT_TIMESTAMP");
      }
    },
    {
      id: '004_curated_examples',
      up: () => {
        db.exec(`
          CREATE TABLE IF NOT EXISTS curated_examples (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            content TEXT UNIQUE,
            approved INTEGER DEFAULT 0,
            notes TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `);

        // Prepopulate with a few examples if table is empty
        const cnt = db.prepare('SELECT COUNT(1) as c FROM curated_examples').get().c;
        if (!cnt) {
          const examples = [
            "Pourquoi les plongeurs plongent-ils toujours en arrière ? Parce que sinon ils tombent dans le bateau.",
            "J'ai acheté un GPS pour mon frigo: maintenant il sait où je vais, et moi aussi.",
            "Mon réveil et moi, on a un accord: il sonne, je le nie."
          ];
          const ins = db.prepare('INSERT OR IGNORE INTO curated_examples (content, approved) VALUES (?, 1)');
          for (const e of examples) ins.run(e);
        }
      }
    },
    {
      id: '005_prompt_styles_and_tracking',
      up: () => {
        ensureColumn('jokes', 'prompt_style', 'TEXT DEFAULT NULL');
        ensureColumn('jokes', 'temperature', 'REAL DEFAULT NULL');
        ensureColumn('feedback', 'prompt_style', 'TEXT DEFAULT NULL');
        db.exec(`
          CREATE TABLE IF NOT EXISTS prompt_styles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            style TEXT UNIQUE,
            uses INTEGER DEFAULT 0,
            likes INTEGER DEFAULT 0,
            dislikes INTEGER DEFAULT 0,
            total_rating INTEGER DEFAULT 0,
            last_used DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `);
        db.exec(`
          CREATE TABLE IF NOT EXISTS style_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            style TEXT,
            joke_id INTEGER,
            rating INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `);
      }
    },
    {
      id: '006_prompt_version_tracking',
      up: () => {
        ensureColumn('jokes', 'prompt_version', 'INTEGER DEFAULT 1');
      }
    },
    {
      id: '007_drop_curated_examples',
      up: () => {
        db.exec(`DROP TABLE IF EXISTS curated_examples`);
      }
    },
    {
      id: '008_prompt_rules',
      up: () => {
        db.exec(`
          CREATE TABLE IF NOT EXISTS prompt_rules (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            pattern TEXT UNIQUE,
            likes INTEGER DEFAULT 0,
            dislikes INTEGER DEFAULT 0,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `);
        db.exec(`
          CREATE TABLE IF NOT EXISTS prompt_evolution (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            version INTEGER DEFAULT 1,
            instruction TEXT NOT NULL,
            source TEXT DEFAULT 'auto',
            is_active INTEGER DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `);
      }
    }
  ];

  for (const m of migrations) {
    if (!hasMigration(m.id)) {
      m.up();
      markMigration(m.id);
    }
  }
}

module.exports = { runMigrations };
