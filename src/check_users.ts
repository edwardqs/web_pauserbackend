import "dotenv/config";
import pg from "pg";

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function checkUsers() {
  const client = await pool.connect();

  // Check users
  const result = await client.query(`
    SELECT 
      u.id, u.email, u.name, u."createdAt",
      r.name as "roleName",
      s.name as "sedeName",
      un.name as "unidadName",
      c.name as "cargoName"
    FROM "User" u
    LEFT JOIN "Role" r ON u."roleId" = r.id
    LEFT JOIN "Sede" s ON u."sedeId" = s.id
    LEFT JOIN "UnidadNegocio" un ON u."unidadId" = un.id
    LEFT JOIN "Cargo" c ON u."cargoId" = c.id
    ORDER BY u.id
  `);

  console.log('\n=== USUARIOS REGISTRADOS ===\n');
  console.log(`Total: ${result.rows.length} usuarios\n`);

  result.rows.forEach((u, i) => {
    console.log(`${i + 1}. ${u.name || u.email}`);
    console.log(`   Email: ${u.email}`);
    console.log(`   Rol: ${u.roleName}`);
    console.log(`   Sede: ${u.sedeName || 'N/A'}`);
    console.log(`   Unidad de Negocio: ${u.unidadName || 'N/A'}`);
    console.log(`   Cargo: ${u.cargoName || 'N/A'}`);
    console.log(`   Creado: ${new Date(u.createdAt).toLocaleDateString('es-CL')}`);
    console.log('');
  });

  await pool.end();
}

checkUsers().catch(console.error);
