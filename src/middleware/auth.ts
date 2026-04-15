import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "supersecretkey";

export interface AuthRequest extends Request {
  user?: {
    id: number;
    email: string;
    roleId: number;
    roleName?: string;
    cargoId?: number | null;
  };
}

export const authMiddleware = (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization as string || req.headers.Authorization as string;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Token no proporcionado" });
    }

    const token = authHeader.split(" ")[1]?.replace(/"/g, "");

    const decoded = jwt.verify(token, JWT_SECRET) as {
      id: number;
      email: string;
      roleId: number;
      roleName?: string;
    };

    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: "Token inválido o expirado" });
  }
};

export const requireRole = (roleIds: number[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: "No autenticado" });
    }

    if (!roleIds.includes(req.user.roleId)) {
      return res.status(403).json({ error: "Sin permisos suficientes" });
    }

    next();
  };
};