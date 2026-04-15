import "dotenv/config";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  try {
    // Ver campaña activa
    const campaign = await pool.query(`
      SELECT * FROM "Campaign" WHERE "isActive" = true
    `);
    console.log("Campaña activa:", campaign.rows);

    // Ver preguntas
    const questions = await pool.query(`
      SELECT id, text FROM "Question" WHERE "isActive" = true
    `);
    console.log("Preguntas:", questions.rows);

    // Ver usuarios en campaña
    const assigned = await pool.query(`
      SELECT * FROM "CampaignUser"
    `);
    console.log("Usuarios asignados:", assigned.rows);
  } finally {
    await pool.end();
  }
}

main().catch(console.error);