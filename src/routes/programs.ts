import { Router, Response } from "express";
import { prisma } from "../lib/prisma.ts";
import { authMiddleware, AuthRequest } from "../middleware/auth.ts";

console.log(">>> programs.ts loaded");

const router = Router();

const parseId = (id: string | string[]): number => parseInt(id as string);

// ==================== LISTAR PROGRAMAS ====================
router.get("/", authMiddleware, async (_req: AuthRequest, res: Response) => {
  try {
    const programs = await prisma.program.findMany({
      include: {
        _count: {
          select: { users: true, questions: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });
    res.json(programs);
  } catch (error) {
    console.error("Error al listar programas:", error);
    res.status(500).json({ error: "Error al listar programas" });
  }
});

// ==================== OBTENER PROGRAMAS DEL USUARIO LOGUEADO ====================
// IMPORTANTE: Debe estar ANTES de /:id para que Express no interprete "my-programs" como un :id
router.get("/my-programs", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    console.log("my-programs userId:", userId);

    if (!userId) {
      return res.status(401).json({ error: "Usuario no identificado" });
    }

    const userPrograms = await prisma.userProgram.findMany({
      where: { userId },
      include: {
        program: {
          include: {
            questions: {
              include: {
                question: {
                  include: {
                    options: { orderBy: { label: "asc" } },
                    configs: true,
                    cargos: { include: { cargo: { select: { id: true, name: true } } } },
                    selectors: {
                      include: { options: { orderBy: { order: "asc" } } },
                      orderBy: { order: "asc" },
                    },
                    flowConfig: {
                      include: {
                        approvalCargo: true,
                        triggers: {
                          include: {
                            triggerOption: true,
                            triggerSelector: {
                              include: { options: { orderBy: { order: "asc" } } },
                            },
                            delegateCargo: true,
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    console.log("my-programs found:", userPrograms.length);

    // Obtener campaña activa
    const campaign = await prisma.campaign.findFirst({ where: { isActive: true } });

    // Para cada programa, obtener resumen de evaluación
    const programs = await Promise.all(
      userPrograms.map(async (up) => {
        let evaluationSummary = null;

        if (campaign) {
          const evaluation = await prisma.evaluation.findFirst({
            where: { 
              userId, 
              campaignId: campaign.id, 
              source: "MIS_PROGRAMAS", 
              programId: up.program.id 
            },
            include: { answers: { select: { awardedScore: true, adminScore: true, periodStart: true } } },
          });

          if (evaluation) {
            const totalAuto = evaluation.answers.reduce((sum, a) => sum + (a.awardedScore || 0), 0);
            const totalAdmin = evaluation.answers.reduce((sum, a) => sum + (a.adminScore || 0), 0);
            const hasAdminReview = evaluation.answers.some(a => a.adminScore !== null);
            const periodsCount = new Set(evaluation.answers.map(a => a.periodStart?.toISOString()).filter(Boolean)).size;

            evaluationSummary = {
              id: evaluation.id,
              totalScore: totalAuto,
              totalAdminScore: hasAdminReview ? totalAdmin : null,
              maxScore: evaluation.maxScore,
              completedAt: evaluation.completedAt,
              periodsAnswered: periodsCount,
            };
          }
        }

        return {
          id: up.program.id,
          name: up.program.name,
          description: up.program.description,
          assignedAt: up.assignedAt,
          questions: up.program.questions.map(qp => qp.question),
          evaluation: evaluationSummary,
        };
      })
    );

    res.json(programs);
  } catch (error: any) {
    console.error("Error my-programs:", error);
    res.status(500).json({ error: error.message || "Error al obtener tus programas" });
  }
});

// ==================== OBTENER PROGRAMA POR ID ====================
router.get("/:id", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const program = await prisma.program.findUnique({
      where: { id: parseId(req.params.id) },
      include: {
        users: {
          include: {
            user: {
              select: { id: true, email: true, name: true, sede: true, unidadNegocio: true, cargo: true },
            },
          },
        },
        questions: {
          include: {
            question: { select: { id: true, text: true, order: true } },
          },
        },
      },
    });

    if (!program) {
      return res.status(404).json({ error: "Programa no encontrado" });
    }

    res.json(program);
  } catch (error) {
    res.status(500).json({ error: "Error al obtener programa" });
  }
});

// ==================== CREAR PROGRAMA ====================
router.post("/", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (req.user?.roleId !== 1) {
      return res.status(403).json({ error: "Solo admins pueden crear programas" });
    }

    const { name, description } = req.body;

    if (!name) {
      return res.status(400).json({ error: "El nombre es requerido" });
    }

    const existing = await prisma.program.findUnique({ where: { name } });
    if (existing) {
      return res.status(400).json({ error: "Ya existe un programa con ese nombre" });
    }

    const program = await prisma.program.create({
      data: { name, description },
    });

    res.status(201).json({ message: "Programa creado exitosamente", program });
  } catch (error) {
    console.error("Error al crear programa:", error);
    res.status(500).json({ error: "Error al crear programa" });
  }
});

// ==================== ACTUALIZAR PROGRAMA ====================
router.put("/:id", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (req.user?.roleId !== 1) {
      return res.status(403).json({ error: "Solo admins pueden editar programas" });
    }

    const { name, description, isActive } = req.body;

    const existing = await prisma.program.findUnique({ where: { id: parseId(req.params.id) } });
    if (!existing) {
      return res.status(404).json({ error: "Programa no encontrado" });
    }

    const program = await prisma.program.update({
      where: { id: parseId(req.params.id) },
      data: {
        ...(name && { name }),
        ...(description !== undefined && { description }),
        ...(isActive !== undefined && { isActive }),
      },
    });

    res.json({ message: "Programa actualizado exitosamente", program });
  } catch (error: any) {
    if (error.code === "P2002") {
      return res.status(400).json({ error: "Ya existe un programa con ese nombre" });
    }
    res.status(500).json({ error: "Error al actualizar programa" });
  }
});

// ==================== ELIMINAR PROGRAMA ====================
router.delete("/:id", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (req.user?.roleId !== 1) {
      return res.status(403).json({ error: "Solo admins pueden eliminar programas" });
    }

    const existing = await prisma.program.findUnique({ where: { id: parseId(req.params.id) } });
    if (!existing) {
      return res.status(404).json({ error: "Programa no encontrado" });
    }

    await prisma.program.delete({ where: { id: parseId(req.params.id) } });
    res.json({ message: "Programa eliminado exitosamente" });
  } catch (error) {
    res.status(500).json({ error: "Error al eliminar programa" });
  }
});

// ==================== ASIGNAR USUARIOS A PROGRAMA ====================
router.post("/:id/assign-users", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (req.user?.roleId !== 1) {
      return res.status(403).json({ error: "Solo admins pueden asignar usuarios" });
    }

    const { userIds, cargoId, sedeId, unidadId } = req.body;
    const programId = parseId(req.params.id);

    const program = await prisma.program.findUnique({ where: { id: programId } });
    if (!program) {
      return res.status(404).json({ error: "Programa no encontrado" });
    }

    let users: { id: number }[] = [];

    if (userIds && Array.isArray(userIds)) {
      users = await prisma.user.findMany({ where: { id: { in: userIds } } });
    } else if (cargoId || sedeId || unidadId) {
      const where: any = {};
      if (cargoId) where.cargoId = cargoId;
      if (sedeId) where.sedeId = sedeId;
      if (unidadId) where.unidadId = unidadId;
      users = await prisma.user.findMany({ where, select: { id: true } });
    } else {
      return res.status(400).json({ error: "Debe proporcionar userIds o filtros (cargoId, sedeId, unidadId)" });
    }

    const assignments = users.map(u => ({ userId: u.id, programId }));
    await prisma.userProgram.createMany({ data: assignments, skipDuplicates: true });

    res.json({
      message: `${users.length} usuario(s) asignados al programa ${program.name}`,
      count: users.length,
    });
  } catch (error) {
    console.error("Error al asignar usuarios:", error);
    res.status(500).json({ error: "Error al asignar usuarios" });
  }
});

// ==================== REMOVER USUARIO DE PROGRAMA ====================
router.delete("/:id/users/:userId", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (req.user?.roleId !== 1) {
      return res.status(403).json({ error: "Solo admins pueden remover usuarios" });
    }

    await prisma.userProgram.deleteMany({
      where: {
        programId: parseId(req.params.id),
        userId: parseId(req.params.userId),
      },
    });

    res.json({ message: "Usuario removido del programa" });
  } catch (error) {
    res.status(500).json({ error: "Error al remover usuario" });
  }
});

// ==================== ASIGNAR PREGUNTAS A PROGRAMA ====================
router.post("/:id/assign-questions", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (req.user?.roleId !== 1) {
      return res.status(403).json({ error: "Solo admins pueden asignar preguntas" });
    }

    const { questionIds } = req.body;
    const programId = parseId(req.params.id);

    if (!questionIds || !Array.isArray(questionIds)) {
      return res.status(400).json({ error: "Debe proporcionar questionIds" });
    }

    const program = await prisma.program.findUnique({ where: { id: programId } });
    if (!program) {
      return res.status(404).json({ error: "Programa no encontrado" });
    }

    const assignments = questionIds.map((qId: number) => ({ questionId: qId, programId }));
    await prisma.questionProgram.createMany({ data: assignments, skipDuplicates: true });

    res.json({
      message: `${questionIds.length} pregunta(s) asignadas al programa ${program.name}`,
      count: questionIds.length,
    });
  } catch (error) {
    console.error("Error al asignar preguntas:", error);
    res.status(500).json({ error: "Error al asignar preguntas" });
  }
});

// ==================== REMOVER PREGUNTA DE PROGRAMA ====================
router.delete("/:id/questions/:questionId", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (req.user?.roleId !== 1) {
      return res.status(403).json({ error: "Solo admins pueden remover preguntas" });
    }

    await prisma.questionProgram.deleteMany({
      where: {
        programId: parseId(req.params.id),
        questionId: parseId(req.params.questionId),
      },
    });

    res.json({ message: "Pregunta removida del programa" });
  } catch (error) {
    res.status(500).json({ error: "Error al remover pregunta" });
  }
});

// ==================== OBTENER PREGUNTAS DE UN PROGRAMA ====================
router.get("/:id/questions", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const questionPrograms = await prisma.questionProgram.findMany({
      where: { programId: parseId(req.params.id) },
      include: {
        question: {
          include: {
            cargos: { include: { cargo: true } },
            options: { orderBy: { label: "asc" } },
            configs: true,
            selectors: {
              include: { options: { orderBy: { order: "asc" } } },
              orderBy: { order: "asc" },
            },
            flowConfig: {
              include: {
                approvalCargo: true,
                triggers: {
                  include: {
                    triggerOption: true,
                    triggerSelector: {
                      include: { options: { orderBy: { order: "asc" } } },
                    },
                    delegateCargo: true,
                  },
                },
              },
            },
          },
        },
      },
      orderBy: { question: { order: "asc" } },
    });

    res.json(questionPrograms.map(qp => ({ ...qp.question, assignedAt: qp.assignedAt })));
  } catch (error) {
    res.status(500).json({ error: "Error al obtener preguntas del programa" });
  }
});

// ==================== OBTENER USUARIOS DE UN PROGRAMA ====================
router.get("/:id/users", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userPrograms = await prisma.userProgram.findMany({
      where: { programId: parseId(req.params.id) },
      include: {
        user: { include: { role: true, sede: true, unidadNegocio: true, cargo: true } },
      },
    });

    res.json(userPrograms.map(up => ({ ...up.user, assignedAt: up.assignedAt })));
  } catch (error) {
    res.status(500).json({ error: "Error al obtener usuarios del programa" });
  }
});

// ==================== CREAR PREGUNTA PARA PROGRAMA ====================
router.post("/:id/create-question", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (req.user?.roleId !== 1) {
      return res.status(403).json({ error: "Solo admins pueden crear preguntas" });
    }

    const programId = parseId(req.params.id);
    const { text, description, order, configs, options, frequencyType, frequencyDay, frequencyInterval, flow } = req.body;

    if (!text) {
      return res.status(400).json({ error: "El texto de la pregunta es requerido" });
    }

    let finalOptions = options;
    if (!finalOptions || !Array.isArray(finalOptions) || finalOptions.length === 0) {
      return res.status(400).json({ error: "Debes agregar al menos una opción de respuesta" });
    }

    const program = await prisma.program.findUnique({ where: { id: programId } });
    if (!program) {
      return res.status(404).json({ error: "Programa no encontrado" });
    }

    const validFreqTypes = ["UNICA", "DIARIA", "SEMANAL", "MENSUAL", "ANUAL", "DIA_ESPECIFICO"];
    const parsedFreqType = frequencyType && validFreqTypes.includes(frequencyType) ? frequencyType : "UNICA";
    const parsedFreqDay = frequencyDay != null ? parseInt(frequencyDay, 10) : null;
    const parsedFreqInterval = frequencyInterval != null ? parseInt(frequencyInterval, 10) : null;
    const parsedOrder = order !== undefined ? parseInt(order, 10) : 0;

    const question = await prisma.$transaction(async (tx) => {
      const q = await tx.question.create({
        data: {
          text,
          description: description || null,
          order: parsedOrder,
          targetType: "MIS_PROGRAMAS",
          frequencyType: parsedFreqType,
          frequencyDay: parsedFreqDay,
          frequencyInterval: parsedFreqInterval,
          configs: configs && configs.length > 0 ? {
            create: configs.map((c: any) => ({
              fileType: c.fileType,
              maxFiles: c.maxFiles || 1,
            })),
          } : undefined,
          options: {
            create: finalOptions.map((opt: any) => ({
              label: opt.label,
              text: opt.text,
              score: parseInt(opt.score, 10) || 0,
              isDefault: opt.isDefault || false,
              semanticKey: opt.semanticKey || null,
              isLocked: false,
            })),
          },
        },
        include: {
          configs: true,
          options: { orderBy: { label: "asc" } },
        },
      });

      await tx.questionProgram.create({
        data: { questionId: q.id, programId },
      });

      if (flow && typeof flow === "object" && flow.isActive) {
        const flowConfigData: any = {
          questionId: q.id,
          isActive: flow.isActive !== false,
          requiresApproval: flow.requiresApproval || false,
          approvalCargoId: flow.approvalCargoId ? parseInt(String(flow.approvalCargoId), 10) : null,
          requiresDelegation: flow.requiresDelegation || false,
          deadlineOffsetDays: flow.deadlineOffsetDays || 2,
          deadlineBusinessDays: flow.deadlineBusinessDays || false,
        };

        const flowConfig = await tx.questionFlowConfig.create({
          data: flowConfigData,
        });

        if (flow.requiresDelegation && Array.isArray(flow.triggers) && flow.triggers.length > 0) {
          for (const trigger of flow.triggers) {
            if (trigger.delegateCargoId) {
              await tx.questionFlowTrigger.create({
                data: {
                  flowConfigId: flowConfig.id,
                  delegateCargoId: parseInt(String(trigger.delegateCargoId), 10),
                  triggerMode: trigger.triggerMode || "OPTION_SEMANTIC",
                  triggerSemanticKey: trigger.triggerSemanticKey || null,
                  triggerOptionId: trigger.triggerOptionId ? parseInt(String(trigger.triggerOptionId), 10) : null,
                  triggerScore: trigger.triggerScore != null ? parseInt(String(trigger.triggerScore), 10) : null,
                  secondFileType: trigger.secondFileType || "EXCEL",
                  secondFileMaxFiles: trigger.secondFileMaxFiles || 1,
                  secondFileLabel: trigger.secondFileLabel || "Plan de Acción",
                },
              });
            }
          }
        }
      }

      return q;
    });

    res.status(201).json({
      message: `Pregunta creada y asignada a ${program.name}`,
      question,
    });
  } catch (error: any) {
    console.error("Error al crear pregunta del programa:", error);
    res.status(500).json({ error: error.message || "Error al crear pregunta" });
  }
});

export default router;
