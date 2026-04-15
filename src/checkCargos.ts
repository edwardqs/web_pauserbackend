import "dotenv/config";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  try {
    const result = await pool.query('SELECT * FROM "Cargo" ORDER BY id LIMIT 10');
    console.log("Cargos en BD:", result.rows);
  } finally {
    await pool.end();
  }
}

main().catch(console.error);