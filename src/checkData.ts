import "dotenv/config";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  try {
    // Verificar roles
    const roles = await pool.query('SELECT id, name FROM "Role"');
    console.log("Roles:", roles.rows);

    // Verificar usuarios
    const users = await pool.query('SELECT id, email, "roleId" FROM "User"');
    console.log("Users:", users.rows);
  } finally {
    await pool.end();
  }
}

main().catch(console.error);