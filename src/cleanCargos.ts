import "dotenv/config";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  try {
    // Limpiar duplicados
    await pool.query(`
      DELETE FROM "Cargo" WHERE id NOT IN (
        SELECT MIN(id) FROM "Cargo" GROUP BY name
      )
    `);
    
    const result = await pool.query('SELECT * FROM "Cargo" ORDER BY id');
    console.log("Cargos limpios:", result.rows);
  } finally {
    await pool.end();
  }
}

main().catch(console.error);