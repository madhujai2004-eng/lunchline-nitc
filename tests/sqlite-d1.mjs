import { DatabaseSync } from 'node:sqlite';

// Run the production SQL through SQLite while preserving D1 batch atomicity.
export class SqliteD1 {
  constructor() {
    this.database = new DatabaseSync(':memory:');
    this.database.exec('PRAGMA foreign_keys = ON');
  }

  prepare(sql) {
    return new SqliteStatement(this, sql);
  }

  async exec(sql) {
    this.database.exec(sql);
    return { count: 1, duration: 0 };
  }

  async batch(statements) {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const results = statements.map((statement) => statement.execute());
      this.database.exec('COMMIT');
      return results;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  withSession() {
    return this;
  }

  close() {
    this.database.close();
  }
}

class SqliteStatement {
  constructor(owner, sql, parameters = []) {
    this.owner = owner;
    this.sql = sql;
    this.parameters = parameters;
  }

  bind(...parameters) {
    if (parameters.length > 100) throw new Error('D1 maximum bound parameters per query exceeded');
    return new SqliteStatement(this.owner, this.sql, parameters);
  }

  execute() {
    const statement = this.owner.database.prepare(this.sql);
    const returnsRows = statement.columns().length > 0;
    if (returnsRows) {
      const results = statement.all(...this.parameters).map((row) => ({ ...row }));
      const changes = this.owner.database.prepare('SELECT changes() AS changes').get().changes;
      return { success: true, results, meta: { changes, duration: 0 } };
    }
    const result = statement.run(...this.parameters);
    return {
      success: true,
      results: [],
      meta: { changes: result.changes, last_row_id: Number(result.lastInsertRowid), duration: 0 },
    };
  }

  async first(column) {
    const result = this.owner.database.prepare(this.sql).get(...this.parameters);
    if (!result) return null;
    return column ? result[column] : { ...result };
  }

  async all() {
    return this.execute();
  }

  async run() {
    return this.execute();
  }

  async raw() {
    return this.owner.database.prepare(this.sql).setReturnArrays(true).all(...this.parameters);
  }
}
