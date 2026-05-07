import bcrypt from "bcryptjs";
import { prisma } from "./src/lib/prisma.ts";

async function main() {
  console.log("🌱 Starting seed...");

  // 1. Roles
  console.log("  Creating roles...");
  const adminRole = await prisma.role.upsert({
    where: { name: "ADMIN" },
    update: {},
    create: { name: "ADMIN" },
  });
  const userRole = await prisma.role.upsert({
    where: { name: "USER" },
    update: {},
    create: { name: "USER" },
  });

  // 2. References
  console.log("  Creating references...");
  const sedes = await Promise.all([
    prisma.sede.upsert({ where: { id_name: { id: 1, name: "Sede Central" } }, update: {}, create: { name: "Sede Central" } }),
    prisma.sede.upsert({ where: { id_name: { id: 2, name: "Sede Norte" } }, update: {}, create: { name: "Sede Norte" } }),
    prisma.sede.upsert({ where: { id_name: { id: 3, name: "Sede Sur" } }, update: {}, create: { name: "Sede Sur" } }),
  ]);

  const unidades = await Promise.all([
    prisma.unidadNegocio.upsert({ where: { id_name: { id: 1, name: "Administración" } }, update: {}, create: { name: "Administración" } }),
    prisma.unidadNegocio.upsert({ where: { id_name: { id: 2, name: "Operaciones" } }, update: {}, create: { name: "Operaciones" } }),
    prisma.unidadNegocio.upsert({ where: { id_name: { id: 3, name: "Logística" } }, update: {}, create: { name: "Logística" } }),
  ]);

  const cargos = await Promise.all([
    prisma.cargo.upsert({ where: { id_name: { id: 1, name: "Gerente General" } }, update: {}, create: { name: "Gerente General" } }),
    prisma.cargo.upsert({ where: { id_name: { id: 2, name: "Jefe de Departamento" } }, update: {}, create: { name: "Jefe de Departamento" } }),
    prisma.cargo.upsert({ where: { id_name: { id: 3, name: "Analista" } }, update: {}, create: { name: "Analista" } }),
    prisma.cargo.upsert({ where: { id_name: { id: 4, name: "Coordinador" } }, update: {}, create: { name: "Coordinador" } }),
    prisma.cargo.upsert({ where: { id_name: { id: 5, name: "Asistente Administrativo" } }, update: {}, create: { name: "Asistente Administrativo" } }),
  ]);

  // 3. Users
  console.log("  Creating users...");
  const hashedPassword = await bcrypt.hash("admin123", 10);

  const adminUser = await prisma.user.upsert({
    where: { email: "admin@pauser.com" },
    update: { password: hashedPassword, roleId: adminRole.id, name: "Administrador" },
    create: {
      email: "admin@pauser.com",
      password: hashedPassword,
      name: "Administrador",
      roleId: adminRole.id,
      cargoId: cargos[0].id,
      sedeId: sedes[0].id,
      unidadId: unidades[0].id,
    },
  });

  const testPassword = await bcrypt.hash("user123", 10);

  const users = await Promise.all([
    prisma.user.upsert({
      where: { email: "jefe@pauser.com" },
      update: { password: testPassword },
      create: {
        email: "jefe@pauser.com",
        password: testPassword,
        name: "Juan Pérez",
        roleId: userRole.id,
        cargoId: cargos[1].id,
        sedeId: sedes[0].id,
        unidadId: unidades[1].id,
      },
    }),
    prisma.user.upsert({
      where: { email: "analista@pauser.com" },
      update: { password: testPassword },
      create: {
        email: "analista@pauser.com",
        password: testPassword,
        name: "María García",
        roleId: userRole.id,
        cargoId: cargos[2].id,
        sedeId: sedes[1].id,
        unidadId: unidades[0].id,
      },
    }),
    prisma.user.upsert({
      where: { email: "coordinador@pauser.com" },
      update: { password: testPassword },
      create: {
        email: "coordinador@pauser.com",
        password: testPassword,
        name: "Carlos López",
        roleId: userRole.id,
        cargoId: cargos[3].id,
        sedeId: sedes[2].id,
        unidadId: unidades[2].id,
      },
    }),
  ]);

  // 4. Campaign
  console.log("  Creating campaign...");
  const campaign = await prisma.campaign.upsert({
    where: { id: 1 },
    update: {
      name: "Campaña 2026",
      startDate: new Date("2026-01-01"),
      endDate: new Date("2026-12-31"),
      isActive: true,
    },
    create: {
      name: "Campaña 2026",
      startDate: new Date("2026-01-01"),
      endDate: new Date("2026-12-31"),
      isActive: true,
    },
  });

  // Assign all users to campaign
  for (const user of [adminUser, ...users]) {
    await prisma.campaignUser.upsert({
      where: { campaignId_userId: { campaignId: campaign.id, userId: user.id } },
      update: {},
      create: { campaignId: campaign.id, userId: user.id },
    });
  }

  // 5. Questions
  console.log("  Creating questions...");
  const questions = [];

  const questionData = [
    {
      text: "¿Cuentas con el manual de funciones actualizado?",
      description: "Verificar que el manual de funciones esté vigente y accesible",
      points: 3,
      frequencyType: "UNICA",
      order: 1,
      targetType: "EXCELENCIA",
      options: [
        { label: "A", text: "Sí, completo y actualizado", score: 3, semanticKey: "YES", isDefault: false },
        { label: "B", text: "Parcialmente actualizado", score: 2, semanticKey: null, isDefault: false },
        { label: "C", text: "No cuenta con manual", score: 0, semanticKey: "NO", isDefault: false },
      ],
      configs: [
        { fileType: "PDF", maxFiles: 1 },
      ],
      cargos: cargos.map(c => c.id),
    },
    {
      text: "¿Tienes el organigrama vigente publicado?",
      description: "El organigrama debe estar visible y actualizado",
      points: 3,
      frequencyType: "UNICA",
      order: 2,
      targetType: "EXCELENCIA",
      options: [
        { label: "A", text: "Sí, publicado y vigente", score: 3, semanticKey: "YES", isDefault: false },
        { label: "B", text: "Existe pero no está publicado", score: 1, semanticKey: null, isDefault: false },
        { label: "C", text: "No cuenta con organigrama", score: 0, semanticKey: "NO", isDefault: false },
      ],
      configs: [
        { fileType: "IMAGEN", maxFiles: 1 },
      ],
      cargos: cargos.map(c => c.id),
    },
    {
      text: "¿Presentas informe mensual de actividades?",
      description: "Informe mensual con métricas y resultados",
      points: 3,
      frequencyType: "MENSUAL",
      frequencyDay: 5,
      order: 3,
      targetType: "EXCELENCIA",
      options: [
        { label: "A", text: "Sí, presentado a tiempo", score: 3, semanticKey: "YES", isDefault: false },
        { label: "B", text: "Presentado con retraso", score: 1, semanticKey: null, isDefault: false },
        { label: "C", text: "No presenta informe", score: 0, semanticKey: "NO", isDefault: false },
      ],
      configs: [
        { fileType: "EXCEL", maxFiles: 1 },
        { fileType: "PDF", maxFiles: 1 },
      ],
      cargos: cargos.map(c => c.id),
    },
    {
      text: "¿Cumples con el plan estratégico anual?",
      description: "Seguimiento del plan estratégico del año vigente",
      points: 3,
      frequencyType: "ANUAL",
      order: 4,
      targetType: "EXCELENCIA",
      options: [
        { label: "A", text: "Sí, cumplimiento mayor al 80%", score: 3, semanticKey: "YES", isDefault: false },
        { label: "B", text: "Cumplimiento entre 50-80%", score: 2, semanticKey: null, isDefault: false },
        { label: "C", text: "Cumplimiento menor al 50%", score: 0, semanticKey: "NO", isDefault: false },
      ],
      configs: [
        { fileType: "PPT", maxFiles: 1 },
      ],
      cargos: cargos.map(c => c.id),
    },
    {
      text: "¿Tienes certificados de capacitación del personal?",
      description: "Evidencia de capacitaciones realizadas",
      points: 3,
      frequencyType: "MENSUAL",
      frequencyDay: 15,
      order: 5,
      targetType: "EXCELENCIA",
      options: [
        { label: "A", text: "Sí, todos certificados", score: 3, semanticKey: "YES", isDefault: false },
        { label: "B", text: "Parcialmente certificados", score: 2, semanticKey: null, isDefault: false },
        { label: "C", text: "Sin certificaciones", score: 0, semanticKey: "NO", isDefault: false },
      ],
      configs: [
        { fileType: "PDF", maxFiles: 5 },
      ],
      cargos: cargos.map(c => c.id),
    },
    {
      text: "¿Dispones de presupuesto aprobado?",
      description: "Documento de presupuesto vigente aprobado",
      points: 3,
      frequencyType: "UNICA",
      order: 6,
      targetType: "EXCELENCIA",
      options: [
        { label: "A", text: "Sí, presupuesto aprobado", score: 3, semanticKey: "YES", isDefault: false },
        { label: "B", text: "En proceso de aprobación", score: 1, semanticKey: null, isDefault: false },
        { label: "C", text: "Sin presupuesto", score: 0, semanticKey: "NO", isDefault: false },
      ],
      configs: [
        { fileType: "EXCEL", maxFiles: 1 },
      ],
      cargos: cargos.map(c => c.id),
    },
  ];

  for (const qd of questionData) {
    const { options, configs, cargos: qCargos, ...questionFields } = qd;

    const question = await prisma.question.upsert({
      where: { id: qd.order },
      update: questionFields,
      create: questionFields,
    });
    questions.push(question);

    // Options
    for (const opt of options) {
      await prisma.questionOption.upsert({
        where: { questionId_label: { questionId: question.id, label: opt.label } },
        update: opt,
        create: { ...opt, questionId: question.id },
      });
    }

    // Configs
    for (const cfg of configs) {
      await prisma.questionConfig.upsert({
        where: { questionId_fileType: { questionId: question.id, fileType: cfg.fileType } },
        update: cfg,
        create: { ...cfg, questionId: question.id },
      });
    }

    // Cargos
    for (const cargoId of qCargos) {
      await prisma.questionCargo.upsert({
        where: { questionId_cargoId: { questionId: question.id, cargoId } },
        update: {},
        create: { questionId: question.id, cargoId },
      });
    }
  }

  // 6. Programs
  console.log("  Creating programs...");
  const program = await prisma.program.upsert({
    where: { name: "Programa de Mejora Continua" },
    update: {},
    create: {
      name: "Programa de Mejora Continua",
      description: "Programa de autoevaluación mensual para mejora continua de procesos",
      isActive: true,
    },
  });

  // Assign users to program
  for (const user of users) {
    await prisma.userProgram.upsert({
      where: { userId_programId: { userId: user.id, programId: program.id } },
      update: {},
      create: { userId: user.id, programId: program.id },
    });
  }

  console.log("✅ Seed completed successfully!");
  console.log("");
  console.log("📋 Credentials:");
  console.log("  Admin: admin@pauser.com / admin123");
  console.log("  User:  jefe@pauser.com / user123");
  console.log("  User:  analista@pauser.com / user123");
  console.log("  User:  coordinador@pauser.com / user123");
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
