import "dotenv/config";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  try {
    // Ver las campañas
    const result = await pool.query('SELECT id, name FROM "Campaign"');
    console.log("Campañas:", result.rows);
  } finally {
    await pool.end();
  }
}

main().catch(console.error);