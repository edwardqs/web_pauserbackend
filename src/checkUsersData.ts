import "dotenv/config";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  try {
    const result = await pool.query(`
      SELECT 
        u.id,
        u.email,
        u.name,
        r.name as rol,
        s.name as sede,
        un.name as unidad,
        c.name as cargo
      FROM "User" u
      LEFT JOIN "Role" r ON u."roleId" = r.id
      LEFT JOIN "Sede" s ON u."sedeId" = s.id
      LEFT JOIN "UnidadNegocio" un ON u."unidadId" = un.id
      LEFT JOIN "Cargo" c ON u."cargoId" = c.id
      ORDER BY u.id
    `);
    
    console.log("Usuarios:");
    console.table(result.rows);
  } finally {
    await pool.end();
  }
}

main().catch(console.error);