import "dotenv/config";
import pg from "pg";

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function fixRole() {
  const client = await pool.connect();
  
  // Update user role to admin
  await client.query('UPDATE "User" SET role = $1 WHERE email = $2', ['admin', 'admin@test.com']);
  console.log("Role updated to admin!");
  
  await pool.end();
}

fixRole();