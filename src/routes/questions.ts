import { Router } from "express";
import { prisma } from "../lib/prisma.ts";
import { authMiddleware, AuthRequest } from "../middleware/auth.ts";
import { parseId } from "../utils/frequency.ts";

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
          selectors: { 
            include: { options: { orderBy: { order: "asc" } } },
            orderBy: { order: "asc" }
          },
          flowConfig: {
            include: {
              approvalCargo: true,
              triggers: {
                include: {
                  triggerOption: true,
                  triggerSelector: true,
                  delegateCargo: true,
                },
              },
            },
          },
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
        selectors: { 
          include: { options: { orderBy: { order: "asc" } } },
          orderBy: { order: "asc" }
        },
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

    const { text, description, configs, order, cargoIds, frequencyType, frequencyDay, frequencyInterval, options, targetType, flow, selectors } = req.body;

    console.log("POST /api/questions - Body received:", JSON.stringify(req.body, null, 2));

    if (!text) {
      return res.status(400).json({ error: "El texto de la pregunta es requerido" });
    }

    if (!configs || !Array.isArray(configs) || configs.length === 0) {
      return res.status(400).json({ error: "Debes configurar al menos un tipo de archivo" });
    }

    let finalOptions = options;
    if (!finalOptions || !Array.isArray(finalOptions) || finalOptions.length === 0) {
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
          create: finalOptions.map((opt: any) => ({
            label: opt.label,
            text: opt.text,
            score: parseInt(opt.score, 10) || 0,
            isDefault: opt.isDefault || false,
            semanticKey: opt.semanticKey || null,
            isLocked: opt.isLocked || false,
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
          selectors: { 
            include: { options: { orderBy: { order: "asc" } } },
            orderBy: { order: "asc" }
          },
          flowConfig: {
            include: {
              approvalCargo: true,
              triggers: {
                include: {
                  triggerOption: true,
                  triggerSelector: true,
                  delegateCargo: true,
                },
              },
            },
          },
        },
      });

    // Crear selectores si existen
    if (selectors && Array.isArray(selectors) && selectors.length > 0) {
      for (const sel of selectors) {
        const createdSelector = await prisma.questionSelector.create({
          data: {
            questionId: question.id,
            selectorKey: sel.selectorKey,
            label: sel.label,
            selectorType: sel.selectorType || "YES_NO",
            renderAs: sel.renderAs || "RADIO",
            allowsMultiple: sel.allowsMultiple || false,
            required: sel.required !== false,
            order: sel.order || 0,
          },
        });
        
        // Crear opciones del selector
        if (sel.options && Array.isArray(sel.options)) {
          for (const opt of sel.options) {
            await prisma.questionSelectorOption.create({
              data: {
                selectorId: createdSelector.id,
                label: opt.label,
                text: opt.text,
                semanticKey: opt.semanticKey || null,
                order: opt.order || 0,
              },
            });
          }
        }
      }
    }

    if (flow && typeof flow === "object" && flow.isActive) {
      const flowConfigData: any = {
        questionId: question.id,
        isActive: flow.isActive !== false,
        requiresApproval: flow.requiresApproval || false,
        approvalCargoId: flow.approvalCargoId ? parseInt(String(flow.approvalCargoId), 10) : null,
        requiresDelegation: flow.requiresDelegation || false,
        deadlineOffsetDays: flow.deadlineOffsetDays || 2,
        deadlineBusinessDays: flow.deadlineBusinessDays || false,
      };

      const flowConfig = await prisma.questionFlowConfig.create({
        data: flowConfigData,
      });

      if (flow.requiresDelegation && Array.isArray(flow.triggers)) {
        for (const trigger of flow.triggers) {
          if (trigger.delegateCargoId) {
            let resolvedSelectorId: number | null = null;
            if (trigger.triggerSelectorKey && trigger.triggerMode?.startsWith("SELECTOR_")) {
              const selector = await prisma.questionSelector.findFirst({
                where: { questionId: question.id, selectorKey: trigger.triggerSelectorKey }
              });
              resolvedSelectorId = selector?.id || null;
            } else if (trigger.triggerSelectorId && !isNaN(parseInt(String(trigger.triggerSelectorId)))) {
              resolvedSelectorId = parseInt(String(trigger.triggerSelectorId));
            }
            
            await prisma.questionFlowTrigger.create({
              data: {
                flowConfigId: flowConfig.id,
                delegateCargoId: parseInt(String(trigger.delegateCargoId), 10),
                triggerMode: trigger.triggerMode || "OPTION_SEMANTIC",
                triggerSemanticKey: trigger.triggerSemanticKey || null,
                triggerOptionId: trigger.triggerOptionId ? parseInt(String(trigger.triggerOptionId), 10) : null,
                triggerScore: trigger.triggerScore != null ? parseInt(String(trigger.triggerScore), 10) : null,
                triggerSelectorId: resolvedSelectorId,
                triggerSelectorOptionId: trigger.triggerSelectorOptionId ? parseInt(String(trigger.triggerSelectorOptionId), 10) : null,
                triggerSelectorSemanticKey: trigger.triggerSelectorSemanticKey || null,
                secondFileType: trigger.secondFileType || "EXCEL",
                secondFileMaxFiles: trigger.secondFileMaxFiles || 1,
                secondFileLabel: trigger.secondFileLabel || "Plan de Acción",
              },
            });
          }
        }
      }
      
      const updatedQuestion = await prisma.question.findUnique({
        where: { id: question.id },
        include: {
          configs: true,
          cargos: { include: { cargo: { select: { id: true, name: true } } } },
          options: { orderBy: { label: "asc" } },
          selectors: { 
            include: { options: { orderBy: { order: "asc" } } },
            orderBy: { order: "asc" }
          },
          flowConfig: {
            include: {
              approvalCargo: true,
              triggers: {
                include: {
                  triggerOption: true,
                  triggerSelector: true,
                  delegateCargo: true,
                },
              },
            },
          },
        },
      });
      return res.status(201).json(updatedQuestion);
    }

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
    const { text, description, configs, order, isActive, cargoIds, frequencyType, frequencyDay, frequencyInterval, options, targetType, flow, selectors } = req.body;
    console.log("PUT /api/questions/:id - Body received:", JSON.stringify(req.body, null, 2));
    const questionId = parseId(id);

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
            semanticKey: opt.semanticKey || null,
            isLocked: opt.isLocked || false,
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
          selectors: { 
            include: { options: { orderBy: { order: "asc" } } },
            orderBy: { order: "asc" }
          },
          flowConfig: {
            include: {
              approvalCargo: true,
              triggers: {
                include: {
                  triggerOption: true,
                  triggerSelector: true,
                  delegateCargo: true,
                },
              },
            },
          },
        },
      });

    // Actualizar selectores si se proporcionan
    if (selectors !== undefined) {
      await prisma.questionSelectorOption.deleteMany({
        where: { selector: { questionId } },
      });
      await prisma.questionSelector.deleteMany({ where: { questionId } });
      
      if (Array.isArray(selectors) && selectors.length > 0) {
        for (const sel of selectors) {
          const createdSelector = await prisma.questionSelector.create({
            data: {
              questionId,
              selectorKey: sel.selectorKey,
              label: sel.label,
              selectorType: sel.selectorType || "YES_NO",
              renderAs: sel.renderAs || "RADIO",
              allowsMultiple: sel.allowsMultiple || false,
              required: sel.required !== false,
              order: sel.order || 0,
            },
          });
          
          if (sel.options && Array.isArray(sel.options)) {
            for (const opt of sel.options) {
              await prisma.questionSelectorOption.create({
                data: {
                  selectorId: createdSelector.id,
                  label: opt.label,
                  text: opt.text,
                  semanticKey: opt.semanticKey || null,
                  order: opt.order || 0,
                },
              });
            }
          }
        }
      }
    }

    if (flow && typeof flow === "object") {
      const existingFlow = await prisma.questionFlowConfig.findUnique({ where: { questionId } });
      
      if (existingFlow) {
        await prisma.questionFlowConfig.update({
          where: { questionId },
          data: {
            isActive: flow.isActive !== false,
            requiresApproval: flow.requiresApproval || false,
            approvalCargoId: flow.approvalCargoId ? parseInt(String(flow.approvalCargoId), 10) : null,
            requiresDelegation: flow.requiresDelegation || false,
            deadlineOffsetDays: flow.deadlineOffsetDays || 2,
            deadlineBusinessDays: flow.deadlineBusinessDays || false,
          },
        });

        if (flow.requiresDelegation && Array.isArray(flow.triggers)) {
          await prisma.questionFlowTrigger.deleteMany({ where: { flowConfigId: existingFlow.id } });
          
          for (const trigger of flow.triggers) {
            if (trigger.delegateCargoId) {
              let resolvedSelectorId: number | null = null;
              if (trigger.triggerSelectorKey && trigger.triggerMode?.startsWith("SELECTOR_")) {
                const selector = await prisma.questionSelector.findFirst({
                  where: { questionId, selectorKey: trigger.triggerSelectorKey }
                });
                resolvedSelectorId = selector?.id || null;
              } else if (trigger.triggerSelectorId && !isNaN(parseInt(String(trigger.triggerSelectorId)))) {
                resolvedSelectorId = parseInt(String(trigger.triggerSelectorId));
              }
              
              await prisma.questionFlowTrigger.create({
                data: {
                  flowConfigId: existingFlow.id,
                  delegateCargoId: parseInt(String(trigger.delegateCargoId), 10),
                  triggerMode: trigger.triggerMode || "OPTION_SEMANTIC",
                  triggerSemanticKey: trigger.triggerSemanticKey || null,
                  triggerOptionId: trigger.triggerOptionId ? parseInt(String(trigger.triggerOptionId), 10) : null,
                  triggerScore: trigger.triggerScore != null ? parseInt(String(trigger.triggerScore), 10) : null,
                  triggerSelectorId: resolvedSelectorId,
                  triggerSelectorOptionId: trigger.triggerSelectorOptionId ? parseInt(String(trigger.triggerSelectorOptionId), 10) : null,
                  triggerSelectorSemanticKey: trigger.triggerSelectorSemanticKey || null,
                  secondFileType: trigger.secondFileType || "EXCEL",
                  secondFileMaxFiles: trigger.secondFileMaxFiles || 1,
                  secondFileLabel: trigger.secondFileLabel || "Plan de Acción",
                },
              });
            }
          }
        }
      } else if (flow.isActive) {
        const flowConfig = await prisma.questionFlowConfig.create({
          data: {
            questionId,
            isActive: true,
            requiresApproval: flow.requiresApproval || false,
            approvalCargoId: flow.approvalCargoId ? parseInt(String(flow.approvalCargoId), 10) : null,
            requiresDelegation: flow.requiresDelegation || false,
            deadlineOffsetDays: flow.deadlineOffsetDays || 2,
            deadlineBusinessDays: flow.deadlineBusinessDays || false,
          },
        });

        if (flow.requiresDelegation && Array.isArray(flow.triggers)) {
          for (const trigger of flow.triggers) {
            if (trigger.delegateCargoId) {
              let resolvedSelectorId: number | null = null;
              if (trigger.triggerSelectorKey && trigger.triggerMode?.startsWith("SELECTOR_")) {
                const selector = await prisma.questionSelector.findFirst({
                  where: { questionId, selectorKey: trigger.triggerSelectorKey }
                });
                resolvedSelectorId = selector?.id || null;
              } else if (trigger.triggerSelectorId && !isNaN(parseInt(String(trigger.triggerSelectorId)))) {
                resolvedSelectorId = parseInt(String(trigger.triggerSelectorId));
              }
              
              await prisma.questionFlowTrigger.create({
                data: {
                  flowConfigId: flowConfig.id,
                  delegateCargoId: parseInt(String(trigger.delegateCargoId), 10),
                  triggerMode: trigger.triggerMode || "OPTION_SEMANTIC",
                  triggerSemanticKey: trigger.triggerSemanticKey || null,
                  triggerOptionId: trigger.triggerOptionId ? parseInt(String(trigger.triggerOptionId), 10) : null,
                  triggerScore: trigger.triggerScore != null ? parseInt(String(trigger.triggerScore), 10) : null,
                  triggerSelectorId: resolvedSelectorId,
                  triggerSelectorOptionId: trigger.triggerSelectorOptionId ? parseInt(String(trigger.triggerSelectorOptionId), 10) : null,
                  triggerSelectorSemanticKey: trigger.triggerSelectorSemanticKey || null,
                  secondFileType: trigger.secondFileType || "EXCEL",
                  secondFileMaxFiles: trigger.secondFileMaxFiles || 1,
                  secondFileLabel: trigger.secondFileLabel || "Plan de Acción",
                },
              });
            }
          }
        }
      }

      const updatedQuestion = await prisma.question.findUnique({
        where: { id: questionId },
        include: {
          configs: true,
          cargos: { include: { cargo: { select: { id: true, name: true } } } },
          options: { orderBy: { label: "asc" } },
          selectors: { 
            include: { options: { orderBy: { order: "asc" } } },
            orderBy: { order: "asc" }
          },
          flowConfig: {
            include: {
              approvalCargo: true,
              triggers: {
                include: {
                  triggerOption: true,
                  triggerSelector: true,
                  delegateCargo: true,
                },
              },
            },
          },
        },
      });
      return res.json(updatedQuestion);
    }

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
      where: { id: parseId(id) },
      data: { isActive: false },
    });

    res.json({ message: "Pregunta eliminada" });
  } catch (error) {
    res.status(500).json({ error: "Error al eliminar pregunta" });
  }
});

export default router;