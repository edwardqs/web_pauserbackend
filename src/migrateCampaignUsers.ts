import "dotenv/config";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "CampaignUser" (
        id SERIAL PRIMARY KEY,
        "campaignId" INTEGER NOT NULL,
        "userId" INTEGER NOT NULL,
        "assignedAt" TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT "CampaignUser_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"(id) ON DELETE CASCADE,
        CONSTRAINT "CampaignUser_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"(id) ON DELETE CASCADE,
        CONSTRAINT "CampaignUser_campaignId_userId_key" UNIQUE ("campaignId", "userId")
      )
    `);
    console.log("Tabla CampaignUser creada");
    console.log("¡Migración completada!");
  } finally {
    await pool.end();
  }
}

main().catch(console.error);