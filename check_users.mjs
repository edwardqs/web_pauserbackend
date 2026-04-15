import pkg from './generated/prisma/client.js';
const { PrismaClient } = pkg;

const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany({
    include: {
      role: true,
      sede: true,
      unidadNegocio: true,
      cargo: true,
    },
  });

  console.log('\n=== USUARIOS REGISTRADOS ===\n');
  console.log(`Total: ${users.length} usuarios\n`);

  users.forEach((u, i) => {
    console.log(`${i + 1}. ${u.name || u.email}`);
    console.log(`   Email: ${u.email}`);
    console.log(`   Role: ${u.role.name}`);
    console.log(`   Sede: ${u.sede?.name || 'N/A'}`);
    console.log(`   Unidad: ${u.unidadNegocio?.name || 'N/A'}`);
    console.log(`   Cargo: ${u.cargo?.name || 'N/A'}`);
    console.log('');
  });

  await prisma.$disconnect();
}

main().catch(console.error);
