import "dotenv/config";
import pg from "pg";

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function check() {
  const client = await pool.connect();
  
  // Check questions
  const qResult = await client.query('SELECT * FROM "Question"');
  console.log("Preguntas:", JSON.stringify(qResult.rows, null, 2));
  
  // Check campaigns
  const cResult = await client.query('SELECT * FROM "Campaign"');
  console.log("Campañas:", JSON.stringify(cResult.rows, null, 2));
  
  await pool.end();
}

check();