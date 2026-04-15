import "dotenv/config";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  try {
    // Eliminar la campaña 1 (la antigua con fechas incorrectas)
    await pool.query('DELETE FROM "Campaign" WHERE id = 1');
    console.log("Campaña 1 eliminada");
    
    const result = await pool.query('SELECT id, name FROM "Campaign"');
    console.log("Campañas restantes:", result.rows);
  } finally {
    await pool.end();
  }
}

main().catch(console.error);