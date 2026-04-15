import "dotenv/config";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  try {
    const result = await pool.query(`
      SELECT c.id, c.name, c."startDate", c."endDate", c."isActive",
             COUNT(cu."userId") as assigned,
             COUNT(e.id) as evaluations
      FROM "Campaign" c
      LEFT JOIN "CampaignUser" cu ON c.id = cu."campaignId"
      LEFT JOIN "Evaluation" e ON c.id = e."campaignId"
      GROUP BY c.id
      ORDER BY c.id DESC
    `);
    
    console.log("Campañas:");
    console.table(result.rows);
  } finally {
    await pool.end();
  }
}

main().catch(console.error);