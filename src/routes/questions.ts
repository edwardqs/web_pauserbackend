import { Router } from "express";
import { prisma } from "../lib/prisma.ts";
import { authMiddleware, AuthRequest } from "../middleware/auth.ts";

const router = Router();

// GET /api/questions - Admin ve todas, usuario solo ve las de su cargo
router.get("/", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const isAdmin = req.user?.roleId === 1;
    const cargoId = req.query.cargoId ? parseInt(req.query.cargoId as string) : null;
    const targetType = req.query.targetType as string | undefined;

    const where: any = { isActive: true };

    // Filtrar por targetType (EXCELENCIA, MIS_PROGRAMAS, o AMBOS)
    if (targetType && ["EXCELENCIA", "MIS_PROGRAMAS"].includes(targetType)) {
      where.targetType = { in: [targetType, "AMBOS"] };
    }

    if (isAdmin) {
      const questions = await prisma.question.findMany({
        where,
        orderBy: { order: "asc" },
        include: {
          configs: true,
          cargos: { include: { cargo: { select: { id: true, name: true } } } },
          options: { orderBy: { label: "asc" } },
        },
      });
      return res.json(questions);
    }

    // Usuario común: solo ve preguntas de su cargo
    if (!cargoId) {
      return res.status(400).json({ error: "Cargo no identificado" });
    }

    where.cargos = { some: { cargoId } };

    const questions = await prisma.question.findMany({
      where,
      orderBy: { order: "asc" },
      include: { 
        configs: true,
        options: { orderBy: { label: "asc" } },
      },
    });

    res.json(questions);
  } catch (error) {
    res.status(500).json({ error: "Error al obtener preguntas" });
  }
});

// POST /api/questions - Crear pregunta (admin)
router.post("/", authMiddleware, async (req: AuthRequest, res) => {
  try {
    if (req.user?.roleId !== 1) {
      return res.status(403).json({ error: "Solo admins pueden crear preguntas" });
    }

    const { text, description, configs, order, cargoIds, frequencyType, frequencyDay, frequencyInterval, options, targetType } = req.body;

    console.log("POST /api/questions - Body received:", JSON.stringify(req.body, null, 2));

    if (!text) {
      return res.status(400).json({ error: "El texto de la pregunta es requerido" });
    }

    if (!configs || !Array.isArray(configs) || configs.length === 0) {
      return res.status(400).json({ error: "Debes configurar al menos un tipo de archivo" });
    }

    if (!options || !Array.isArray(options) || options.length === 0) {
      return res.status(400).json({ error: "Debes agregar al menos una opción de respuesta con puntaje" });
    }

    const parsedOrder = order !== undefined ? parseInt(order, 10) : 0;
    const validFreqTypes = ["UNICA", "DIARIA", "SEMANAL", "MENSUAL", "ANUAL", "DIA_ESPECIFICO"];
    const parsedFreqType = frequencyType && validFreqTypes.includes(frequencyType) ? frequencyType : "UNICA";
    const parsedFreqDay = frequencyDay !== undefined && frequencyDay !== null ? parseInt(frequencyDay, 10) : null;
    const parsedFreqInterval = frequencyInterval !== undefined && frequencyInterval !== null ? parseInt(frequencyInterval, 10) : null;
    const validTargets = ["EXCELENCIA", "MIS_PROGRAMAS", "AMBOS"];
    const parsedTarget = targetType && validTargets.includes(targetType) ? targetType : "AMBOS";

    const question = await prisma.question.create({
      data: {
        text,
        description: description || null,
        order: parsedOrder,
        frequencyType: parsedFreqType,
        frequencyDay: parsedFreqDay,
        frequencyInterval: parsedFreqInterval,
        targetType: parsedTarget,
        configs: {
          create: configs.map((c: any) => ({
            fileType: c.fileType,
            maxFiles: c.maxFiles || 1,
          })),
        },
        options: {
          create: options.map((opt: any) => ({
            label: opt.label,
            text: opt.text,
            score: parseInt(opt.score, 10) || 0,
            isDefault: opt.isDefault || false,
          })),
        },
        ...(cargoIds && Array.isArray(cargoIds) && cargoIds.length > 0 && {
          cargos: {
            create: cargoIds.map((cid: number) => ({ cargoId: parseInt(String(cid), 10) })),
          },
        }),
      },
      include: {
        configs: true,
        cargos: { include: { cargo: { select: { id: true, name: true } } } },
        options: { orderBy: { label: "asc" } },
      },
    });

    res.status(201).json(question);
  } catch (error: any) {
    console.error("Error al crear pregunta:", error);
    console.error("Error details:", error?.message);
    console.error("Error meta:", error?.meta);
    res.status(500).json({ error: "Error al crear pregunta", details: error?.message });
  }
});

// PUT /api/questions/:id - Actualizar pregunta (admin)
router.put("/:id", authMiddleware, async (req: AuthRequest, res) => {
  try {
    if (req.user?.roleId !== 1) {
      return res.status(403).json({ error: "Solo admins pueden modificar preguntas" });
    }

    const { id } = req.params;
    const { text, description, configs, order, isActive, cargoIds, frequencyType, frequencyDay, frequencyInterval, options, targetType } = req.body;
    console.log("PUT /api/questions/:id - Body received:", JSON.stringify(req.body, null, 2));
    const questionId = parseInt(id);

    if (isNaN(questionId)) {
      return res.status(400).json({ error: "ID de pregunta inválido" });
    }

    const validFreqTypes = ["UNICA", "DIARIA", "SEMANAL", "MENSUAL", "ANUAL", "DIA_ESPECIFICO"];
    const parsedFreqType = frequencyType && validFreqTypes.includes(frequencyType) ? frequencyType : undefined;
    const parsedFreqDay = frequencyDay !== undefined && frequencyDay !== null ? parseInt(frequencyDay, 10) : undefined;
    const parsedFreqInterval = frequencyInterval !== undefined && frequencyInterval !== null ? parseInt(frequencyInterval, 10) : undefined;
    const validTargets = ["EXCELENCIA", "MIS_PROGRAMAS", "AMBOS"];
    const parsedTarget = targetType && validTargets.includes(targetType) ? targetType : undefined;

    if (configs) {
      await prisma.questionConfig.deleteMany({ where: { questionId } });
      await prisma.questionConfig.createMany({
        data: configs.map((c: any) => ({
          questionId,
          fileType: c.fileType,
          maxFiles: c.maxFiles || 1,
        })),
      });
    }

    if (cargoIds !== undefined) {
      await prisma.questionCargo.deleteMany({ where: { questionId } });
      if (cargoIds.length > 0) {
        await prisma.questionCargo.createMany({
          data: cargoIds.map((cid: number) => ({ questionId, cargoId: cid })),
        });
      }
    }

    if (options !== undefined) {
      await prisma.questionOption.deleteMany({ where: { questionId } });
      if (options.length > 0) {
        await prisma.questionOption.createMany({
          data: options.map((opt: any) => ({
            questionId,
            label: opt.label,
            text: opt.text,
            score: parseInt(opt.score, 10) || 0,
            isDefault: opt.isDefault || false,
          })),
        });
      }
    }

    const question = await prisma.question.update({
      where: { id: questionId },
      data: {
        ...(text && { text }),
        ...(description !== undefined && { description }),
        ...(order !== undefined && { order }),
        ...(isActive !== undefined && { isActive }),
        ...(parsedFreqType !== undefined && { frequencyType: parsedFreqType }),
        ...(parsedFreqDay !== undefined && { frequencyDay: parsedFreqDay }),
        ...(parsedFreqInterval !== undefined && { frequencyInterval: parsedFreqInterval }),
        ...(parsedTarget !== undefined && { targetType: parsedTarget }),
      },
      include: {
        configs: true,
        cargos: { include: { cargo: { select: { id: true, name: true } } } },
        options: { orderBy: { label: "asc" } },
      },
    });

    res.json(question);
  } catch (error: any) {
    console.error("Error al actualizar pregunta:", error);
    console.error("Error details:", error?.message);
    res.status(500).json({ error: "Error al actualizar pregunta", details: error?.message });
  }
});

// DELETE /api/questions/:id - Eliminar pregunta (admin)
router.delete("/:id", authMiddleware, async (req: AuthRequest, res) => {
  try {
    if (req.user?.roleId !== 1) {
      return res.status(403).json({ error: "Solo admins pueden eliminar preguntas" });
    }

    const { id } = req.params;

    await prisma.question.update({
      where: { id: parseInt(id) },
      data: { isActive: false },
    });

    res.json({ message: "Pregunta eliminada" });
  } catch (error) {
    res.status(500).json({ error: "Error al eliminar pregunta" });
  }
});

export default router;