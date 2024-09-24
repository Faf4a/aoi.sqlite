const Database = require("better-sqlite3");
const AoiError = require("aoi.js/src/classes/AoiError");
const Interpreter = require("aoi.js/src/core/interpreter.js");
const { performance } = require("perf_hooks");

class SQLDatabase {
  constructor(client, options) {
    this.client = client;
    this.options = options;
    this.debug = this.options.debug ?? false;

    this.connect();
  }

  connect() {
    try {
      if (!this.options.location) throw new TypeError("Missing database folder, please provide a location for the database.");
      this.client.db = new Database(this.options.location);

      this.client.db.pragma("journal_mode = WAL");

      if (!this.options.tables || this.options?.tables.length === 0) throw new TypeError("Missing variable tables, please provide at least one table.");
      if (this.options.tables.includes("__aoijs_vars__")) throw new TypeError("'__aoijs_vars__' is reserved as a table name.");
      this.client.db.tables = [...this.options.tables, "__aoijs_vars__"];

      const createTables = this.client.db.transaction(() => {
        this.client.db.tables.forEach((table) => {
          this.client.db.prepare(`CREATE TABLE IF NOT EXISTS ${table} (key TEXT PRIMARY KEY, value TEXT)`).run();
        });
      });

      try {
        createTables();
      } catch (error) {
        throw error;
      }

      this.client.db.get = this.get.bind(this);
      this.client.db.set = this.set.bind(this);
      this.client.db.drop = this.drop.bind(this);
      this.client.db.delete = this.delete.bind(this);
      this.client.db.deleteMany = this.deleteMany.bind(this);
      this.client.db.findOne = this.findOne.bind(this);
      this.client.db.findMany = this.findMany.bind(this);
      this.client.db.all = this.all.bind(this);
      this.client.db.avgPing = this.ping.bind(this);

      if (!this.client.db.db) this.client.db.db = {};
      this.client.db.db.readyAt = Date.now();

      if (this.options.logging != false) {
        const { version } = require("../package.json");
        AoiError.createConsoleMessage(
          [
            {
              text: `SQLite database connected successfully`,
              textColor: "white"
            },
            {
              text: `Loaded ${this.client.db.tables.length} tables`,
              textColor: "white"
            },
            {
              text: `Installed on v${version}`,
              textColor: "green"
            }
          ],
          "white",
          { text: " aoi.sqlite  ", textColor: "cyan" }
        );
      }

      const client = this.client;

      this.client.once("ready", async () => {
        await require("aoi.js/src/events/Custom/timeout.js")({ client, interpreter: Interpreter }, undefined, undefined, true);

        setInterval(async () => {
          await require("aoi.js/src/events/Custom/handleResidueData.js")(client);
        }, 3.6e6);
      });
    } catch (err) {
      AoiError.createConsoleMessage(
        [
          {
            text: `Failed to initialize`,
            textColor: "red"
          },
          {
            text: err.message,
            textColor: "white"
          }
        ],
        "white",
        { text: " aoi.sqlite  ", textColor: "cyan" }
      );
      process.exit(0);
    }
  }

  async ping() {
    let start = performance.now();
    await this.client.db.prepare(`SELECT 1`).get();
    console.log(performance.now() - start);
    return performance.now() - start;
  }

  get(table, key, id = undefined) {
    const aoijs_vars = ["cooldown", "setTimeout", "ticketChannel"];
    const query = `SELECT value FROM ${table} WHERE key = ?`;
    let data;

    if (this.debug == true) {
      console.log(`[received] get(${table}, ${key}, ${id})`);
    }

    const op = this.client.db.transaction(() => {
      if (aoijs_vars.includes(key)) {
        data = this.client.db.prepare(query).get(`${key}_${id}`);
      } else {
        if (!this.client.variableManager.has(key, table)) return;
        const __var = this.client.variableManager.get(key, table)?.default;
        data = this.client.db.prepare(query).get(`${key}_${id}`) || __var;
      }
      console.log(data);
    });

    try {
      op();
    } catch (error) {
      throw error;
    }

    if (this.debug == true) {
      console.log(`[returning] get(${table}, ${key}, ${id}) -> ${typeof data === "object" ? JSON.stringify(data) : data}`);
    }

    return data;
  }

  set(table, key, id, value) {
    const query = `INSERT OR REPLACE INTO ${table} (key, value) VALUES (?, ?)`;

    if (this.debug == true) {
      console.log(`[received] set(${table}, ${key}, ${id}, ${typeof value === "object" ? JSON.stringify(value) : value})`);
    }

    const op = this.client.db.transaction(() => {
      this.client.db.prepare(query).run(`${key}_${id}`, value);
    });

    try {
      op();
    } catch (error) {
      throw error;
    }

    if (this.debug == true) {
      console.log(`[returning] set(${table}, ${key}, ${id}, ${value}) -> ${typeof value === "object" ? JSON.stringify(value) : value}`);
    }
  }

  drop(table, variable) {
    if (this.debug == true) {
      console.log(`[received] drop(${table}, ${variable})`);
    }

    const query = variable ? `DELETE FROM ${table} WHERE key = ?` : `DROP TABLE IF EXISTS ${table}`;

    const dropOperation = this.client.db.transaction(() => {
      this.client.db.prepare(query).run(variable ? variable : undefined);
    });

    try {
      dropOperation();
    } catch (error) {
      throw error;
    }

    if (this.debug == true) {
      console.log(`[returning] drop(${table}, ${variable}) -> dropped ${table}`);
    }
  }

  findOne(table, query) {
    const sql = `SELECT value FROM ${table} WHERE key = ?`;
    const op = this.client.db.transaction(() => {
      const result = this.client.db.prepare(sql).get(query)?.value;
      return result;
    });

    try {
      return op();
    } catch (error) {
      throw error;
    }
  }

  deleteMany(table, query) {
    if (this.debug == true) {
      console.log(`[received] deleteMany(${table}, ${query})`);
    }

    if (typeof query === "object") {
      query = JSON.stringify(query);
    }

    const sql = `DELETE FROM ${table} WHERE key = ?`;
    const op = this.client.db.transaction(() => {
      this.client.db.prepare(sql).run(query);
    });

    try {
      op();
    } catch (error) {
      throw error;
    }

    if (this.debug == true) {
      console.log(`[returning] deleteMany(${table}, ${query}) -> deleted`);
    }
  }

  delete(table, key, id) {
    if (this.debug == true) {
      console.log(`[received] delete(${table}, ${key}_${id})`);
    }

    const sql = `DELETE FROM ${table} WHERE key = ?`;
    const op = this.client.db.transaction(() => {
      this.client.db.prepare(sql).run(`${key}_${id}`);
    });

    try {
      op();
    } catch (error) {
      throw error;
    }

    if (this.debug == true) {
      console.log(`[returned] delete(${table}, ${key}_${id}) -> deleted`);
    }
  }

  findMany(table, query, limit) {
    let results;
    const sql = `SELECT * FROM ${table} WHERE key LIKE ?`;

    if (this.debug == true) {
      console.log(`[received] findMany(${table}, ${query}, ${limit})`);
    }

    const op = this.client.db.transaction(() => {
      if (typeof query === "function") {
        results = this.client.db.prepare(`SELECT * FROM ${table}`).all().filter(query);
      } else {
        results = this.client.db.prepare(sql).all(query);
      }

      if (limit) {
        results = results.slice(0, limit);
      }
    });

    try {
      op();
      return results;
    } catch (error) {
      throw error;
    }
  }

  all(table, filter, list = 100, sort = "asc") {
    let results = [];
    const sql = `SELECT * FROM ${table}`;

    if (this.debug == true) {
      console.log(`[received] all(${table}, ${filter}, ${list}, ${sort})`);
    }

    const op = this.client.db.transaction(() => {
      results = this.client.db.prepare(sql).all().filter(filter);

      if (sort === "asc") {
        results.sort((a, b) => a.value - b.value);
      } else if (sort === "desc") {
        results.sort((a, b) => b.value - a.value);
      }
    });

    try {
      op();
      if (this.debug == true) {
        console.log(`[returning] all(${table}, ${filter}, ${list}, ${sort}) -> ${results.length} items`);
      }
      return results.slice(0, list);
    } catch (error) {
      throw error;
    }
  }
}

module.exports = { Database: SQLDatabase };
