import { Router, Response } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma.ts";
import { authMiddleware, AuthRequest } from "../middleware/auth.ts";
import { parseId, queryNum } from "../utils/frequency.ts";

const router = Router();

// ==================== CREATE USER ====================
router.post("/", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (req.user?.roleId !== 1) {
      return res.status(403).json({ error: "Solo admins pueden crear usuarios" });
    }

    const { email, password, name, roleId = 2, sedeId, unidadId, cargoId } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email y password son requeridos" });
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(400).json({ error: "El email ya está registrado" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name,
        roleId,
        sedeId: sedeId || null,
        unidadId: unidadId || null,
        cargoId: cargoId || null,
      },
      include: {
        role: { select: { id: true, name: true } },
        sede: { select: { id: true, name: true } },
        unidadNegocio: { select: { id: true, name: true } },
        cargo: { select: { id: true, name: true } },
      },
    });

    res.status(201).json({
      message: "Usuario creado exitosamente",
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        roleId: user.roleId,
        roleName: user.role.name,
        sede: user.sede,
        unidadNegocio: user.unidadNegocio,
        cargo: user.cargo,
        createdAt: user.createdAt,
      },
    });
  } catch (error) {
    console.error("Error al crear usuario:", error);
    res.status(500).json({ error: "Error al crear usuario" });
  }
});

router.put("/:id", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (req.user?.roleId !== 1) {
      return res.status(403).json({ error: "Solo admins pueden modificar usuarios" });
    }

    const { id } = req.params;
    const { email, password, name, roleId, sedeId, unidadId, cargoId } = req.body;
    const userId = parseId(id);

    const existingUser = await prisma.user.findUnique({ where: { id: userId } });
    if (!existingUser) {
      return res.status(404).json({ error: "Usuario no encontrado" });
    }

    const updateData: any = {
      ...(email && { email }),
      ...(name && { name }),
      ...(roleId && { roleId }),
      ...(sedeId !== undefined && { sedeId: sedeId || null }),
      ...(unidadId !== undefined && { unidadId: unidadId || null }),
      ...(cargoId !== undefined && { cargoId: cargoId || null }),
    };

    if (password) {
      updateData.password = await bcrypt.hash(password, 10);
    }

    const user = await prisma.user.update({
      where: { id: userId },
      data: updateData,
      include: {
        role: { select: { id: true, name: true } },
        sede: { select: { id: true, name: true } },
        unidadNegocio: { select: { id: true, name: true } },
        cargo: { select: { id: true, name: true } },
      },
    });

    res.json({
      message: "Usuario actualizado exitosamente",
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        roleId: user.roleId,
        roleName: user.role.name,
        sede: user.sede,
        unidadNegocio: user.unidadNegocio,
        cargo: user.cargo,
        createdAt: user.createdAt,
      },
    });
  } catch (error: any) {
    console.error("Error al actualizar usuario:", error);
    if (error.code === "P2002") {
      return res.status(400).json({ error: "El email ya está registrado" });
    }
    res.status(500).json({ error: "Error al actualizar usuario" });
  }
});

// ==================== DELETE USER ====================
router.delete("/:id", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (req.user?.roleId !== 1) {
      return res.status(403).json({ error: "Solo admins pueden eliminar usuarios" });
    }

    const { id } = req.params;
    const userId = parseId(id);

    const existingUser = await prisma.user.findUnique({ where: { id: userId } });
    if (!existingUser) {
      return res.status(404).json({ error: "Usuario no encontrado" });
    }

    if (userId === req.user.id) {
      return res.status(400).json({ error: "No puedes eliminar tu propia cuenta" });
    }

    await prisma.user.delete({ where: { id: userId } });

    res.json({ message: "Usuario eliminado exitosamente" });
  } catch (error) {
    console.error("Error al eliminar usuario:", error);
    res.status(500).json({ error: "Error al eliminar usuario" });
  }
});

router.get("/roles", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const roles = await prisma.role.findMany();
    res.json(roles);
  } catch (error) {
    res.status(500).json({ error: "Error al listar roles" });
  }
});

router.put("/:id/role", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (req.user?.roleId !== 1) {
      return res.status(403).json({ error: "Solo admins pueden modificar usuarios" });
    }

    const { id } = req.params;
    const { roleId, sedeId, unidadId, cargoId } = req.body;
    const userId = parseId(id);

    const user = await prisma.user.update({
      where: { id: userId },
      data: {
        ...(roleId && { roleId }),
        ...(sedeId !== undefined && { sedeId: sedeId || null }),
        ...(unidadId !== undefined && { unidadId: unidadId || null }),
        ...(cargoId !== undefined && { cargoId: cargoId || null }),
      },
      include: {
        role: { select: { id: true, name: true } },
        sede: { select: { id: true, name: true } },
        unidadNegocio: { select: { id: true, name: true } },
        cargo: { select: { id: true, name: true } },
      },
    });

    res.json(user);
  } catch (error) {
    res.status(500).json({ error: "Error al actualizar usuario" });
  }
});

router.get("/", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { sedeId, unidadId, cargoId } = req.query;

    const where: any = {};
    if (sedeId) where.sedeId = queryNum(sedeId);
    if (unidadId) where.unidadId = queryNum(unidadId);
    if (cargoId) where.cargoId = queryNum(cargoId);

    const users = await prisma.user.findMany({
      where,
      select: {
        id: true,
        email: true,
        name: true,
        createdAt: true,
        role: { select: { id: true, name: true } },
        sede: { select: { id: true, name: true } },
        unidadNegocio: { select: { id: true, name: true } },
        cargo: { select: { id: true, name: true } },
      },
    });
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: "Error al listar usuarios" });
  }
});

router.put("/profile", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    
    // Solo admins pueden editar su información organizacional
    if (req.user!.roleId !== 1) {
      return res.status(403).json({ error: "Solo el admin puede editar su información organizacional" });
    }

    const { name, sedeId, unidadId, cargoId } = req.body;

    const user = await prisma.user.update({
      where: { id: userId },
      data: {
        ...(name && { name }),
        ...(sedeId !== undefined && { sedeId: sedeId || null }),
        ...(unidadId !== undefined && { unidadId: unidadId || null }),
        ...(cargoId !== undefined && { cargoId: cargoId || null }),
      },
      include: {
        role: { select: { id: true, name: true } },
        sede: { select: { id: true, name: true } },
        unidadNegocio: { select: { id: true, name: true } },
        cargo: { select: { id: true, name: true } },
      },
    });

    res.json(user);
  } catch (error) {
    res.status(500).json({ error: "Error al actualizar perfil" });
  }
});

router.get("/:id", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = parseId(id);

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        createdAt: true,
        role: { select: { id: true, name: true } },
        sede: { select: { id: true, name: true } },
        unidadNegocio: { select: { id: true, name: true } },
        cargo: { select: { id: true, name: true } },
      },
    });

    if (!user) {
      return res.status(404).json({ error: "Usuario no encontrado" });
    }

    res.json(user);
  } catch (error) {
    res.status(500).json({ error: "Error al obtener usuario" });
  }
});

// ==================== PROGRAMAS DE USUARIO ====================

// GET /users/:id/programs - Obtener programas asignados a un usuario
router.get("/:id/programs", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (req.user?.roleId !== 1) {
      return res.status(403).json({ error: "Solo admins pueden ver programas de usuario" });
    }

    const userId = parseId(req.params.id);

    const userPrograms = await prisma.userProgram.findMany({
      where: { userId },
      include: {
        program: {
          select: {
            id: true,
            name: true,
            description: true,
            isActive: true,
          },
        },
      },
      orderBy: {
        program: { name: "asc" },
      },
    });

    // Obtener todos los programas disponibles
    const allPrograms = await prisma.program.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        description: true,
        isActive: true,
      },
      orderBy: { name: "asc" },
    });

    const assignedProgramIds = userPrograms.map(up => up.programId);

    res.json({
      assigned: userPrograms.map(up => ({
        ...up.program,
        assignedAt: up.assignedAt,
      })),
      available: allPrograms.filter(p => !assignedProgramIds.includes(p.id)),
    });
  } catch (error) {
    console.error("Error al obtener programas de usuario:", error);
    res.status(500).json({ error: "Error al obtener programas de usuario" });
  }
});

// POST /users/:id/programs - Asignar/quitar programas a un usuario
router.post("/:id/programs", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (req.user?.roleId !== 1) {
      return res.status(403).json({ error: "Solo admins pueden gestionar programas de usuario" });
    }

    const userId = parseId(req.params.id);
    const { programIds }: { programIds: number[] } = req.body;

    if (!Array.isArray(programIds)) {
      return res.status(400).json({ error: "programIds debe ser un array" });
    }

    // Verificar que el usuario existe
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return res.status(404).json({ error: "Usuario no encontrado" });
    }

    // Obtener asignaciones actuales
    const currentAssignments = await prisma.userProgram.findMany({
      where: { userId },
      select: { programId: true },
    });

    const currentProgramIds = currentAssignments.map(a => a.programId);

    // Programas a agregar (están en el nuevo array pero no en el actual)
    const toAdd = programIds.filter(id => !currentProgramIds.includes(id));

    // Programas a quitar (están en el actual pero no en el nuevo array)
    const toRemove = currentProgramIds.filter(id => !programIds.includes(id));

    // Ejecutar cambios
    const results = await prisma.$transaction(async (tx) => {
      // Agregar nuevos
      if (toAdd.length > 0) {
        await tx.userProgram.createMany({
          data: toAdd.map(programId => ({ userId, programId })),
        });
      }

      // Quitar
      if (toRemove.length > 0) {
        await tx.userProgram.deleteMany({
          where: {
            userId,
            programId: { in: toRemove },
          },
        });
      }

      // Obtener lista final actualizada
      const updated = await tx.userProgram.findMany({
        where: { userId },
        include: {
          program: {
            select: { id: true, name: true, description: true, isActive: true },
          },
        },
        orderBy: { program: { name: "asc" } },
      });

      return updated;
    });

    res.json({
      message: "Programas actualizados exitosamente",
      added: toAdd.length,
      removed: toRemove.length,
      programs: results.map(r => ({
        ...r.program,
        assignedAt: r.assignedAt,
      })),
    });
  } catch (error) {
    console.error("Error al gestionar programas de usuario:", error);
    res.status(500).json({ error: "Error al gestionar programas de usuario" });
  }
});

export default router;