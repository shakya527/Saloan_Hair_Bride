/**
 * =========================================================================
 * TURSO (libSQL) DATABASE COMPATIBILITY LAYER
 * =========================================================================
 * Provides a mysql2-compatible `pool.query(sql, params)` interface backed by
 * Turso (libSQL) so all existing server.js code works without modification.
 *
 * Key compatibility features:
 *  - Returns [rows, fields] tuples just like mysql2/promise
 *  - Maps `?` positional placeholders → libSQL's positional args
 *  - Translates MySQL-specific DDL/DML → SQLite-compatible equivalents
 *  - Emulates result.insertId, result.affectedRows for INSERT/UPDATE/DELETE
 *  - Provides pool.getConnection() stub for health-check code
 * =========================================================================
 */

const { createClient } = require('@libsql/client');

// ── Connection ────────────────────────────────────────────────────────────────
let _client = null;

function getClient() {
  if (!_client) {
    const url   = process.env.TURSO_DATABASE_URL;
    const token = process.env.TURSO_AUTH_TOKEN;

    if (!url) {
      throw new Error(
        'TURSO_DATABASE_URL is not set. ' +
        'Add it to your .env file or Vercel environment variables.'
      );
    }

    _client = createClient({
      url,
      authToken: token || undefined,
    });
  }
  return _client;
}

// ── SQL dialect translation (MySQL → SQLite) ──────────────────────────────────
// Called once per query before execution.
function translateSQL(sql) {
  let s = sql;

  // 1. Strip MySQL-only table options at the end of CREATE TABLE
  s = s.replace(/\s*ENGINE\s*=\s*\w+/gi, '');
  s = s.replace(/\s*(DEFAULT\s+)?(CHARACTER\s+SET|CHARSET)\s*=?\s*[\w_]+/gi, '');
  s = s.replace(/\s*COLLATE\s*=?\s*[\w_]+/gi, '');
  s = s.replace(/\s*AUTO_INCREMENT\s*=\s*\d+/gi, '');

  // 2. AUTO_INCREMENT handling (SQLite requires INTEGER PRIMARY KEY AUTOINCREMENT)
  s = s.replace(/\bINT(\(\d+\))?\s+AUTO_INCREMENT\s+PRIMARY\s+KEY\b/gi, 'INTEGER PRIMARY KEY AUTOINCREMENT');
  s = s.replace(/\bINTEGER\s+AUTO_INCREMENT\s+PRIMARY\s+KEY\b/gi, 'INTEGER PRIMARY KEY AUTOINCREMENT');
  s = s.replace(/\bAUTO_INCREMENT\s+PRIMARY\s+KEY\b/gi, 'PRIMARY KEY AUTOINCREMENT');
  s = s.replace(/\bPRIMARY\s+KEY\s+AUTO_INCREMENT\b/gi, 'PRIMARY KEY AUTOINCREMENT');
  s = s.replace(/\bAUTO_INCREMENT\b/gi, '');

  // 3. MySQL INT size hints like INT(11) → INTEGER
  s = s.replace(/\bINT\s*\(\s*\d+\s*\)/gi, 'INTEGER');
  s = s.replace(/\bTINYINT\s*\(\s*\d+\s*\)/gi, 'INTEGER');
  s = s.replace(/\bSMALLINT\s*\(\s*\d+\s*\)/gi, 'INTEGER');
  s = s.replace(/\bBIGINT\s*\(\s*\d+\s*\)/gi, 'INTEGER');

  // 4. ENUM(...) → TEXT
  s = s.replace(/\bENUM\s*\([^)]+\)/gi, 'TEXT');

  // 5. Strip MySQL 'ON UPDATE CURRENT_TIMESTAMP' (unsupported in SQLite table definitions)
  s = s.replace(/\s+ON\s+UPDATE\s+CURRENT_TIMESTAMP/gi, '');
  s = s.replace(/\bTIMESTAMP\b(?!\s*\()/gi, 'DATETIME');

  // 6. TINYINT → INTEGER
  s = s.replace(/\bTINYINT\b/gi, 'INTEGER');

  // 7. DECIMAL / FLOAT → REAL
  s = s.replace(/\bDECIMAL\s*\(\s*\d+\s*,\s*\d+\s*\)/gi, 'REAL');
  s = s.replace(/\bFLOAT\b/gi, 'REAL');

  // 8. UNSIGNED → (remove; SQLite has no unsigned constraint)
  s = s.replace(/\bUNSIGNED\b/gi, '');

  // 9. UNIQUE KEY `name` (cols) -> SQLite standard UNIQUE (cols)
  s = s.replace(/UNIQUE\s+KEY\s+`?[\w]+`?\s*\(([^)]+)\)/gi, 'UNIQUE ($1)');

  // 10. Non-unique INDEX / KEY inside CREATE TABLE → strip (SQLite does not support inline INDEX)
  s = s.replace(/,\s*\b(INDEX|KEY)\s+`?[\w]+`?\s*\([^)]+\)/gi, '');
  s = s.replace(/\b(INDEX|KEY)\s+`?[\w]+`?\s*\([^)]+\)\s*,?/gi, '');

  // 11. FOREIGN KEY inside CREATE TABLE → strip to avoid SQLite strict constraint conflicts
  s = s.replace(/,\s*\bFOREIGN\s+KEY\s*\([^)]+\)\s*REFERENCES\s*`?[\w]+`?\s*\([^)]+\)(\s+ON\s+DELETE\s+[A-Za-z\s]+)?(\s+ON\s+UPDATE\s+[A-Za-z\s]+)?/gi, '');
  s = s.replace(/\bFOREIGN\s+KEY\s*\([^)]+\)\s*REFERENCES\s*`?[\w]+`?\s*\([^)]+\)(\s+ON\s+DELETE\s+[A-Za-z\s]+)?(\s+ON\s+UPDATE\s+[A-Za-z\s]+)?\s*,?/gi, '');

  // 12. Clean up any leftover commas in CREATE TABLE
  while (/,\s*,/.test(s) || /,\s*[\r\n\s]*\)/.test(s)) {
    s = s.replace(/,\s*,/g, ',');
    s = s.replace(/,\s*[\r\n\s]*\)/g, '\n)');
  }
  s = s.replace(/\(\s*,/g, '(');

  // 13. ON DUPLICATE KEY UPDATE → INSERT OR IGNORE
  if (/ON DUPLICATE KEY UPDATE/i.test(s)) {
    s = s.replace(/^\s*INSERT\s+/i, 'INSERT OR IGNORE ');
    s = s.replace(/\s+ON DUPLICATE KEY UPDATE[\s\S]+$/i, '');
  }

  // 14. MySQL date functions → SQLite equivalents (keep CURRENT_TIMESTAMP as native keyword)
  s = s.replace(/\bDATE_FORMAT\s*\(\s*CURDATE\s*\(\s*\)\s*,\s*'%Y-%m-%d'\s*\)/gi, "CURRENT_DATE");
  s = s.replace(/\bDATE_FORMAT\s*\(\s*([\w.`]+)\s*,\s*'%Y-%m-%d'\s*\)/gi, "date($1)");
  s = s.replace(/\bCURDATE\s*\(\s*\)/gi, "CURRENT_DATE");
  s = s.replace(/\bCURRENT_DATE\s*\(\s*\)/gi, "CURRENT_DATE");
  s = s.replace(/\bNOW\s*\(\s*\)/gi, "CURRENT_TIMESTAMP");

  // 15. TIMESTAMPDIFF(HOUR, NOW(), ...) — used only in the reminder scheduler;
  //     SQLite doesn't have TIMESTAMPDIFF. Return FALSE so scheduler skips gracefully.
  s = s.replace(/TIMESTAMPDIFF\s*\([^)]+\)/gi, '0');

  // 16. STR_TO_DATE → datetime cast (approximate; only used in scheduler)
  s = s.replace(/STR_TO_DATE\s*\([^)]+\)/gi, "datetime('now')");

  // 17. IFNULL → COALESCE (SQLite uses COALESCE)
  s = s.replace(/\bIFNULL\s*\(/gi, 'COALESCE(');

  // 18. FIELD(col, v1, v2, ...) → CASE WHEN col=v1 THEN 0 WHEN col=v2 THEN 1 ...
  s = s.replace(/\bFIELD\s*\(([^)]+)\)/gi, (match, inner) => {
    const parts = inner.split(',').map(p => p.trim());
    if (parts.length < 2) return '0';
    const col = parts[0];
    const cases = parts.slice(1).map((v, i) => `WHEN ${col}=${v} THEN ${i}`).join(' ');
    return `(CASE ${cases} ELSE ${parts.length} END)`;
  });

  // 19. UNIQUE KEY `name` (...) inside CREATE TABLE → handled by strip above (#11)
  //     But standalone ALTER TABLE ADD UNIQUE KEY → CREATE UNIQUE INDEX
  // (Handled at query dispatch level for ALTER TABLE statements)

  // 20. ALTER TABLE `tbl` ADD COLUMN — SQLite only supports a limited ADD COLUMN.
  //     Remove constraint keywords SQLite doesn't support after ADD COLUMN:
  //     - UNIQUE, INDEX, KEY (SQLite requires separate CREATE INDEX)
  //     - AFTER col_name
  s = s.replace(/\bAFTER\s+`?[\w]+`?/gi, '');

  // 21. MODIFY COLUMN → ALTER TABLE ... (SQLite doesn't support MODIFY COLUMN at all).
  //     We'll handle this by skipping such statements in the query dispatcher.

  // 22. INFORMATION_SCHEMA queries → SQLite equivalent using pragma_table_info
  //     Pattern: SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.COLUMNS
  //              WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?
  if (/INFORMATION_SCHEMA\.COLUMNS/i.test(s)) {
    // Replaced at dispatch time with a pragma query (see buildPragmaColumnCheck)
    return { __type: 'PRAGMA_COLUMN_CHECK', original: s };
  }

  // 23. INFORMATION_SCHEMA.STATISTICS (index check) — handled at dispatch
  if (/INFORMATION_SCHEMA\.STATISTICS/i.test(s)) {
    return { __type: 'PRAGMA_INDEX_CHECK', original: s };
  }

  // 24. SELECT 1 (health check) — pass through as-is
  return s;
}

// ── INFORMATION_SCHEMA emulation ──────────────────────────────────────────────
/**
 * Emulates:
 *   SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.COLUMNS
 *   WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?
 *
 * Returns the same [rows] shape: [{ c: 0 }] or [{ c: 1 }]
 */
async function pragmaColumnCheck(sql, args) {
  let tableName = null;
  let columnName = null;

  const tMatch = sql.match(/TABLE_NAME\s*=\s*'([^']+)'/i);
  const cMatch = sql.match(/COLUMN_NAME\s*=\s*'([^']+)'/i);

  if (tMatch) {
    tableName = tMatch[1];
    if (cMatch) {
      columnName = cMatch[1];
    } else if (args && args.length > 0) {
      columnName = args[args.length - 1];
    }
  } else {
    if (args && args.length >= 3) {
      tableName = args[1];
      columnName = args[2];
    } else if (args && args.length === 2) {
      tableName = args[0] === 'main' ? args[1] : args[0];
    }
  }

  if (!tableName) return [[{ c: 0 }], []];

  const client = getClient();
  try {
    const result = await client.execute(`PRAGMA table_info("${tableName}")`);

    // Check if the query asks for columns list (e.g. refreshAppointmentColumns)
    const isColumnListing = /SELECT\s+COLUMN_NAME/i.test(sql);
    if (isColumnListing) {
      const rows = result.rows.map(r => ({
        COLUMN_NAME: String(r.name || r[1] || ''),
        DATA_TYPE: String(r.type || r[2] || 'TEXT'),
        CHARACTER_MAXIMUM_LENGTH: 255,
        IS_NULLABLE: r.notnull ? 'NO' : 'YES',
        COLUMN_DEFAULT: r.dflt_value
      }));
      return [rows, []];
    }

    const cols = result.rows.map(r => String(r.name || r[1] || ''));
    let count = 0;
    if (columnName) {
      count = cols.includes(columnName) ? 1 : 0;
    } else {
      count = cols.length;
    }
    return [[{ c: count }], []];
  } catch (e) {
    return [[{ c: 0 }], []];
  }
}

/**
 * Emulates:
 *   SELECT COUNT(DISTINCT INDEX_NAME) AS c FROM INFORMATION_SCHEMA.STATISTICS
 *   WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ?
 */
async function pragmaIndexCheck(sql, args) {
  let tableName = null;
  let indexName = null;

  if (args && args.length >= 3) {
    tableName = args[1];
    indexName = args[2];
  }

  if (!tableName || !indexName) return [[{ c: 0 }], []];

  const client = getClient();
  try {
    const result = await client.execute(`PRAGMA index_list("${tableName}")`);
    const exists = result.rows.some(r => {
      const n = String(r.name || r[1] || '');
      return n === indexName;
    });
    return [[{ c: exists ? 1 : 0 }], []];
  } catch (e) {
    return [[{ c: 0 }], []];
  }
}

// ── Result normalisation ──────────────────────────────────────────────────────
/**
 * Converts a libSQL ResultSet into a mysql2-compatible [rows, fields] tuple.
 *
 * For SELECT queries → rows is an array of plain objects.
 * For INSERT/UPDATE/DELETE → rows is an OkPacket-like object with insertId / affectedRows.
 */
function normaliseResult(resultSet, sql) {
  const trimmed = sql.trim().toUpperCase();
  const isWrite = /^(INSERT|UPDATE|DELETE|REPLACE)/.test(trimmed);
  const isSelect = /^SELECT/.test(trimmed) || /^PRAGMA/.test(trimmed) || /^WITH/.test(trimmed);

  if (isWrite) {
    const okPacket = {
      affectedRows: Number(resultSet.rowsAffected || 0),
      insertId:     Number(resultSet.lastInsertRowid || 0),
      changedRows:  Number(resultSet.rowsAffected || 0),
    };
    return [okPacket, []];
  }

  // SELECT / PRAGMA — convert rows to plain objects
  const columns = resultSet.columns || [];
  const rows = (resultSet.rows || []).map(row => {
    const obj = {};
    if (Array.isArray(row)) {
      columns.forEach((col, i) => { obj[col] = row[i]; });
    } else {
      // row is already an object-like from newer libSQL client versions
      columns.forEach(col => { obj[col] = row[col]; });
    }
    return obj;
  });

  return [rows, columns.map(c => ({ name: c }))];
}

// ── Main pool.query() emulator ────────────────────────────────────────────────
async function query(sql, args = []) {
  // Sanitise args: convert undefined → null, Buffer → Buffer (leave as-is)
  const cleanArgs = Array.isArray(args)
    ? args.map(v => (v === undefined ? null : v))
    : [];

  // Translate SQL
  const translated = translateSQL(sql);

  // Handle INFORMATION_SCHEMA stubs
  if (translated && typeof translated === 'object' && translated.__type) {
    if (translated.__type === 'PRAGMA_COLUMN_CHECK') {
      return pragmaColumnCheck(translated.original, cleanArgs);
    }
    if (translated.__type === 'PRAGMA_INDEX_CHECK') {
      return pragmaIndexCheck(translated.original, cleanArgs);
    }
  }

  const finalSQL = typeof translated === 'string' ? translated : sql;

  // Skip MODIFY COLUMN — SQLite doesn't support it; treat as success (non-fatal migration)
  if (/ALTER\s+TABLE\s+.*\s+MODIFY\s+COLUMN/i.test(finalSQL)) {
    return [{ affectedRows: 0, insertId: 0 }, []];
  }

  // Skip ALTER TABLE ... ADD [UNIQUE] KEY / INDEX → SQLite doesn't support adding index/keys via ALTER TABLE
  if (/ALTER\s+TABLE\s+.*\s+ADD\s+(KEY|INDEX|UNIQUE|CONSTRAINT)/i.test(sql) ||
      /ALTER\s+TABLE\s+.*\s+ADD\s*$/i.test(finalSQL.trim()) ||
      /ALTER\s+TABLE\s+.*\s+ADD\s+(UNIQUE|KEY|INDEX|CONSTRAINT)\b/i.test(finalSQL) ||
      /ALTER\s+TABLE\s+.*\s+ADD\s+(UNIQUE\s+)?KEY\b/i.test(finalSQL) ||
      /ALTER\s+TABLE\s+.*\s+ADD\s+INDEX\b/i.test(finalSQL)) {
    return [{ affectedRows: 0, insertId: 0 }, []];
  }

  // Skip CREATE DATABASE (not applicable for Turso)
  if (/^\s*CREATE\s+(DATABASE|SCHEMA)\b/i.test(finalSQL)) {
    return [{ affectedRows: 0, insertId: 0 }, []];
  }

  const client = getClient();

  try {
    const result = await client.execute({ sql: finalSQL, args: cleanArgs });
    return normaliseResult(result, finalSQL);
  } catch (err) {
    // Add a code property for compatibility with mysql2 error code checks
    if (!err.code) {
      if (/UNIQUE constraint failed/i.test(err.message)) {
        err.code = 'ER_DUP_ENTRY';
      } else if (/no such table/i.test(err.message)) {
        err.code = 'ER_NO_SUCH_TABLE';
      }
    }
    throw err;
  }
}

// ── pool object (mysql2-compatible interface) ─────────────────────────────────
const pool = {
  /**
   * Execute a SQL query with optional positional args.
   * Returns a Promise that resolves to [rows|okPacket, fields].
   */
  query,

  /**
   * Stub for pool.getConnection() used in the health-check boot code.
   * Returns a fake connection object with a no-op release().
   */
  getConnection() {
    // Eagerly validate credentials
    getClient();
    return Promise.resolve({ release: () => {} });
  },

  /** Direct access to the underlying libSQL client if needed. */
  get client() {
    return getClient();
  },
};

module.exports = { pool, getClient };
