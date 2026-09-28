import { neon } from '@neondatabase/serverless';
import pg from 'pg';
import { publisherConfig, localSimulation } from './env.js';
import { publisherContext } from './context.js';

let database;
let localPool;
function connection() {
  if (database) return database;
  const url = publisherConfig().databaseUrl;
  if (localSimulation()) {
    localPool = new pg.Pool({ connectionString: url, max: 5,
      // SQL DATE has no timezone. Match Neon's canonical date input instead of
      // pg's local-midnight Date, which shifts a day when serialized in Paris.
      types: { getTypeParser: (oid, format) => oid === 1082 ? value => value : pg.types.getTypeParser(oid, format) },
    });
    database = { local: true };
  } else {
    // Neon HTTP transport; never fall back to a CRM or browser credential.
    const parsed = new URL(url);
    if (!parsed.hostname.endsWith('.neon.tech')) throw new Error('Publisher database must be the configured Neon store.');
    database = neon(url);
  }
  return database;
}

export async function transaction(statements) {
  const database = connection();
  const actor = publisherContext.getStore()?.actor || '';
  const entries = [{ text: "select set_config('publisher.actor', $1, true)", values: [actor] }, ...statements];
  if (database.local) {
    const client = await localPool.connect();
    try {
      await client.query('BEGIN');
      const result = [];
      for (const entry of entries) result.push((await client.query(entry.text, entry.values)).rows);
      await client.query('COMMIT');
      return result.slice(1);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }
  const result = await database.transaction(entries.map(entry => database.query(entry.text, entry.values)));
  return result.slice(1);
}

export async function query(text, values = []) {
  return (await transaction([{ text, values }]))[0];
}
export function sql() {
  return (strings, ...values) => query(strings.reduce((text, part, index) => text + (index ? `$${index}` : '') + part, ''), values);
}
