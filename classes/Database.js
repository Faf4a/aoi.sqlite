const Database = require("better-sqlite3");
const AoiError = require("aoi.js/src/classes/AoiError");
const Interpreter = require("aoi.js/src/core/interpreter.js");
const { performance } = require("perf_hooks");
const EventEmitter = require("events");

class SQLDatabase extends EventEmitter {
  constructor(client, options) {
    super();
    this.client = client;
    this.options = options;
    this.debug = this.options.debug ?? false;

    this.connect();

    this.client.db.get = this.get.bind(this);
    this.client.db.set = this.set.bind(this);
    this.client.db.drop = this.drop.bind(this);
    this.client.db.findOne = this.findOne.bind(this);
    this.client.db.deleteMany = this.deleteMany.bind(this);
    this.client.db.delete = this.delete.bind(this);
    this.client.db.findMany = this.findMany.bind(this);
    this.client.db.all = this.all.bind(this);
    this.client.db.db.avgPing = this.ping.bind(this);
  }

  connect() {
    try {
      if (!this.options.location) throw new TypeError("Missing database file option, please provide a location for the database under 'location' with the '.db' extension.");

      this.client.db = new Database(this.options.location);

      this.client.db.pragma("journal_mode = WAL");

      if (!this.options.tables || this.options?.tables.length === 0) throw new TypeError("Missing variable tables, please provide at least one table.");
      if (this.options.tables.includes("__aoijs_vars__")) throw new TypeError("'__aoijs_vars__' is reserved as a table name.");

      this.tables = [...this.options.tables, "__aoijs_vars__"];
      this.client.db.tables = this.tables;

      this.createTables();
      this.readyAt = Date.now();

      if (!this.client.db.db) this.client.db.db = new EventEmitter();
      this.client.db.db.readyAt = Date.now();

      const { version } = require("../package.json");

      if (this.options.logging !== false) {
        AoiError.createConsoleMessage(
          [
            { text: "SQLite database loaded successfully", textColor: "green" },
            { text: `Loaded ${this.tables.length} tables`, textColor: "white" },
            { text: `Installed on v${version}`, textColor: "white" }
          ],
          "white",
          { text: " aoi.sqlite  ", textColor: "cyan" }
        );
      }

      this.client.once("ready", async () => {
        await require("aoi.js/src/events/Custom/timeout.js")({ client: this.client, interpreter: Interpreter }, undefined, undefined, true);
        setInterval(async () => {
          await require("aoi.js/src/events/Custom/handleResidueData.js")(this.client);
        }, 3.6e6);
      });

      this.client.db.db.emit("ready");
    } catch (err) {
      this.logError(`Failed to initialize: ${err.message}`);
      process.exit(1);
    }
  }

  createTables() {
    const createTables = this.client.db.transaction(() => {
      this.tables.forEach((table) => {
        this.client.db.prepare(`CREATE TABLE IF NOT EXISTS ${table} (key TEXT PRIMARY KEY, value JSON)`).run();
      });
    });
    createTables();
  }

  logError(message) {
    AoiError.createConsoleMessage([{ text: message, textColor: "red" }], "white", { text: " aoi.sqlite  ", textColor: "cyan" });
  }

  async ping() {
    const start = performance.now();
    await this.client.db.prepare(`SELECT 1`).get();
    const elapsed = performance.now() - start;
    return elapsed;
  }

  get(table, key, id = undefined) {
    const aoijs_vars = ["cooldown", "setTimeout", "ticketChannel"];
    let fullKey = key;
    if (id) fullKey = `${key}_${id}`;

    const query = `SELECT value FROM ${table} WHERE key = ?`;

    if (this.debug) {
      console.log(`[GET] ${table}:${fullKey}`);
    }

    let data;

    try {
      const row = this.client.db.prepare(query).get(fullKey);
      if (row) {
        data = JSON.parse(row.value);
      } else if (!aoijs_vars.includes(key) && this.client.variableManager.has(key, table)) {
        data = this.client.variableManager.get(key, table).default;
      }
    } catch (error) {
      this.logError(`Error in get: ${error.message}`);
      throw error;
    }

    if (this.debug) {
      console.log(`[GET Result] ${table}:${fullKey} -> ${JSON.stringify(data)}`);
    }

    return { value: data, key: fullKey, id };
  }

  set(table, key, id, value) {
    let fullKey = `${key}_${id}`;
    if (fullKey.endsWith("_undefined")) {
      fullKey = fullKey.replace("_undefined", "");
    }
    const query = `INSERT OR REPLACE INTO ${table} (key, value) VALUES (?, ?)`;
    const jsonValue = JSON.stringify(value);

    if (this.debug) {
      console.log(`[SET] ${table}:${fullKey} -> ${jsonValue}`);
    }

    try {
      this.client.db.prepare(query).run(fullKey, jsonValue);
    } catch (error) {
      this.logError(`Error in set: ${error.message}`);
      throw error;
    }
  }

  drop(table, variable) {
    const query = variable ? `DELETE FROM ${table} WHERE key = ?` : `DROP TABLE IF EXISTS ${table}`;
    if (this.debug) {
      console.log(`[DROP] ${table} ${variable ? `key: ${variable}` : ""}`);
    }

    try {
      this.client.db.prepare(query).run(variable);
    } catch (error) {
      this.logError(`Error in drop: ${error.message}`);
      throw error;
    }
  }

  findOne(table, key) {
    const sql = `SELECT value FROM ${table} WHERE key = ?`;
    if (this.debug) {
      console.log(`[FIND ONE] ${table}:${key}`);
    }

    try {
      const row = this.client.db.prepare(sql).get(key);
      return row ? { value: JSON.parse(row.value), key } : undefined;
    } catch (error) {
      this.logError(`Error in findOne: ${error.message}`);
      throw error;
    }
  }

  deleteMany(table, query) {
    if (this.debug) {
      console.log(`[DELETE MANY] ${table} query: ${JSON.stringify(query)}`);
    }

    let sql;
    if (typeof query === "function") {
      sql = `DELETE FROM ${table} WHERE key IN (${this.client.db
        .prepare(`SELECT key FROM ${table}`)
        .all()
        .filter(query)
        .map((r) => `'${r.key}'`)
        .join(",")})`;
    } else if (typeof query === "object") {
      const whereClause = Object.entries(query)
        .map(([k, v]) => `JSON_EXTRACT(value, '$.${k}') = '${v}'`)
        .join(" AND ");
      sql = `DELETE FROM ${table} WHERE ${whereClause}`;
    } else {
      sql = `DELETE FROM ${table} WHERE key = ?`;
    }

    try {
      this.client.db.prepare(sql).run(query);
    } catch (error) {
      this.logError(`Error in deleteMany: ${error.message}`);
      throw error;
    }
  }

  delete(table, key, id) {
    let fullKey = key;
    if (id) fullKey = `${key}_${id}`;

    if (this.debug) {
      console.log(`[DELETE] ${table}:${fullKey}`);
    }
    const sql = `DELETE FROM ${table} WHERE key = ?`;

    try {
      this.client.db.prepare(sql).run(fullKey);
    } catch (error) {
      this.logError(`Error in delete: ${error.message}`);
      throw error;
    }
  }

  findMany(table, query, limit) {
    if (this.debug) {
      console.log(`[FIND MANY] ${table} query: ${JSON.stringify(query)} limit: ${limit}`);
    }
    let results;
    try {
      if (typeof query === "function") {
        results = this.client.db.prepare(`SELECT * FROM ${table}`).all().filter(query);
      } else if (typeof query === "object") {
        const whereClause = Object.entries(query)
          .map(([k, v]) => `JSON_EXTRACT(value, '$.${k}') = '${v}'`)
          .join(" AND ");
        results = this.client.db.prepare(`SELECT * FROM ${table} WHERE ${whereClause}`).all();
      } else {
        const sql = `SELECT value FROM ${table} WHERE key LIKE ?`;
        results = this.client.db.prepare(sql).all(query);
      }

      if (limit) {
        results = results.slice(0, limit);
      }
      return results.map((r) => ({ value: r.value, key: r.key }));
    } catch (error) {
      this.logError(`Error in findMany: ${error.message}`);
      throw error;
    }
  }

  all(table, filter, limit = 100, sort = "asc") {
    if (this.debug) {
      console.log(`[ALL] ${table} limit: ${limit} sort: ${sort}`);
    }
    let results = [];
    try {
      results = this.client.db
        .prepare(`SELECT * FROM ${table}`)
        .all()
        .filter(filter)
        .map((row) => ({ value: JSON.parse(row.value), key: row.key }));
      if (sort === "asc") {
        results.sort((a, b) => a.value - b.value);
      } else if (sort === "desc") {
        results.sort((a, b) => b.value - a.value);
      }

      return results.slice(0, limit).map((data) => ({ value: data.value, key: data.key }));
    } catch (error) {
      this.logError(`Error in all: ${error.message}`);
      throw error;
    }
  }
}

module.exports = { Database: SQLDatabase };
