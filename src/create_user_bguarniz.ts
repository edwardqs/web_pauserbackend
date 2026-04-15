import "dotenv/config";
import bcrypt from "bcryptjs";
import pg from "pg";

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function createUser() {
  const client = await pool.connect();

  try {
    // 1. Verificar sedes existentes
    const sedesResult = await client.query(`SELECT id, name FROM "Sede" ORDER BY id`);
    console.log("\n📍 Sedes disponibles:");
    sedesResult.rows.forEach(s => console.log(`   ${s.id}. ${s.name}`));

    // 2. Verificar unidades
    const unidadesResult = await client.query(`SELECT id, name FROM "UnidadNegocio" ORDER BY id`);
    console.log("\n🏢 Unidades de Negocio disponibles:");
    unidadesResult.rows.forEach(u => console.log(`   ${u.id}. ${u.name}`));

    // 3. Verificar cargos
    const cargosResult = await client.query(`SELECT id, name FROM "Cargo" ORDER BY id`);
    console.log("\n💼 Cargos disponibles:");
    cargosResult.rows.forEach(c => console.log(`   ${c.id}. ${c.name}`));

    // 4. Buscar datos específicos (case insensitive)
    const sede = sedesResult.rows.find(s => s.name.toLowerCase().includes("ac") || s.name.toLowerCase().includes("sede central"));
    const unidad = unidadesResult.rows.find(u => u.name.toLowerCase().includes("administración") || u.name.toLowerCase().includes("administracion"));
    const cargo = cargosResult.rows.find(c => c.name.toLowerCase().includes("coordinador de mejora contínua") || c.name.toLowerCase().includes("coordinador de mejora continua"));

    if (!sede) {
      console.log("\n❌ No se encontró sede 'AC'. Usa una existente.");
      await pool.end();
      return;
    }
    if (!unidad) {
      console.log("\n❌ No se encontró unidad 'ADMINISTRACIÓN'. Usa una existente.");
      await pool.end();
      return;
    }
    if (!cargo) {
      console.log("\n❌ No se encontró cargo 'COORDINADOR DE MEJORA CONTINUA'. Usa uno existente.");
      await pool.end();
      return;
    }

    console.log("\n=== DATOS SELECCIONADOS ===\n");
    console.log(`Sede: ${sede.name} (ID: ${sede.id})`);
    console.log(`Unidad: ${unidad.name} (ID: ${unidad.id})`);
    console.log(`Cargo: ${cargo.name} (ID: ${cargo.id})`);

    // 5. Verificar si usuario existe
    const userExists = await client.query(`SELECT id FROM "User" WHERE email = $1`, ["bguarniz@pauserdistribuciones.com"]);

    if (userExists.rows.length > 0) {
      console.log("\n⚠️  El usuario ya existe. Actualizando datos...\n");
      const hashedPassword = await bcrypt.hash("p@user*", 10);
      await client.query(
        `UPDATE "User" SET password = $1, name = $2, "roleId" = 1, "sedeId" = $3, "unidadId" = $4, "cargoId" = $5 WHERE email = $6`,
        [hashedPassword, "GUARNIZ CALVO BLANCA NAOMI", sede.id, unidad.id, cargo.id, "bguarniz@pauserdistribuciones.com"]
      );
    } else {
      const hashedPassword = await bcrypt.hash("p@user*", 10);
      await client.query(
        `INSERT INTO "User" (email, password, name, "roleId", "sedeId", "unidadId", "cargoId", "createdAt") 
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
        ["bguarniz@pauserdistribuciones.com", hashedPassword, "GUARNIZ CALVO BLANCA NAOMI", 1, sede.id, unidad.id, cargo.id]
      );
      console.log("\n✅ Usuario creado exitosamente\n");
    }

    // 6. Verificar datos finales
    const result = await client.query(`
      SELECT u.id, u.email, u.name, r.name as role, s.name as sede, un.name as unidad, c.name as cargo 
      FROM "User" u 
      JOIN "Role" r ON u."roleId" = r.id 
      LEFT JOIN "Sede" s ON u."sedeId" = s.id 
      LEFT JOIN "UnidadNegocio" un ON u."unidadId" = un.id 
      LEFT JOIN "Cargo" c ON u."cargoId" = c.id 
      WHERE u.email = $1
    `, ["bguarniz@pauserdistribuciones.com"]);

    const user = result.rows[0];

    console.log("=== USUARIO CONFIGURADO ===\n");
    console.log(`ID: ${user.id}`);
    console.log(`Email: ${user.email}`);
    console.log(`Nombre: ${user.name}`);
    console.log(`Rol: ${user.role}`);
    console.log(`Sede: ${user.sede}`);
    console.log(`Unidad de Negocio: ${user.unidad}`);
    console.log(`Cargo: ${user.cargo}`);
    console.log(`\nContraseña: p@user*`);
    console.log(`\n✅ Password hasheado con bcrypt`);

  } catch (error) {
    console.error("❌ Error:", error);
  } finally {
    await pool.end();
  }
}

createUser();
