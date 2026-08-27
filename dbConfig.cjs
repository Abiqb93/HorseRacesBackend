/**
 * Where the database connection comes from.
 *
 * Shared by server.jsx and the France ingestion so the two cannot disagree
 * about which variables count — they did once, and the France routes failed
 * on a service the rest of the API was perfectly happy with.
 *
 * CommonJS on purpose: server.jsx requires it synchronously at boot, and the
 * ES modules under france/ can import a .cjs file, so one copy serves both.
 *
 * Names are read generously. A service may carry the connection under
 * Railway's MySQL plugin names, or as a single URL, and a variable set under
 * a name nobody looked for is indistinguishable from one that was never set.
 *
 * There are deliberately no fallback literals for the credentials: this
 * repository is public. The database *name* is not a credential, so it does
 * get a default — requiring it is what took the API down.
 */

const DEFAULT_DATABASE = "horseprofileshub";

function first(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }
  return undefined;
}

function resolveDbConfig() {
  const url = first("DATABASE_URL", "MYSQL_URL", "DB_URL", "MYSQL_PUBLIC_URL");
  if (url) {
    try {
      const u = new URL(url);
      return {
        host: decodeURIComponent(u.hostname),
        user: decodeURIComponent(u.username),
        password: decodeURIComponent(u.password),
        database: decodeURIComponent(u.pathname.replace(/^\//, "")) || DEFAULT_DATABASE,
        port: Number(u.port) || 3306,
        from: "connection URL",
      };
    } catch {
      console.error("A database URL is set but could not be parsed; falling back to individual variables.");
    }
  }

  return {
    host: first("DB_HOST", "MYSQLHOST", "MYSQL_HOST", "DB_HOSTNAME"),
    user: first("DB_USER", "MYSQLUSER", "MYSQL_USER", "DB_USERNAME"),
    password: first("DB_PASSWORD", "MYSQLPASSWORD", "MYSQL_PASSWORD", "DB_PASS"),
    database: first("DB_NAME", "MYSQLDATABASE", "MYSQL_DATABASE", "DB_DATABASE") || DEFAULT_DATABASE,
    port: Number(first("DB_PORT", "MYSQLPORT", "MYSQL_PORT")) || 3306,
    from: "individual variables",
  };
}

/** The credentials, and only the credentials, are required. */
function missingCredentials(config = resolveDbConfig()) {
  return ["host", "user", "password"].filter((key) => !config[key]);
}

module.exports = { resolveDbConfig, missingCredentials, DEFAULT_DATABASE };
