import "dotenv/config";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  try {
    // Desactivar campaña anterior
    await pool.query('UPDATE "Campaign" SET "isActive" = false');
    
    // Crear nueva campaña
    const result = await pool.query(`
      INSERT INTO "Campaign" (name, "startDate", "endDate", "isActive")
      VALUES ('Campaña 2026', NOW(), NOW() + INTERVAL '30 days', true)
      RETURNING *
    `);
    
    console.log("Nueva campaña creada:", result.rows[0]);
  } finally {
    await pool.end();
  }
}

main().catch(console.error);