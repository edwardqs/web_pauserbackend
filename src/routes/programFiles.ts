import { Router, Response } from "express";
import multer from "multer";
import { prisma } from "../lib/prisma.ts";
import { authMiddleware, AuthRequest } from "../middleware/auth.ts";
import ExcelJS from "exceljs";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

const parseId = (param: string | string[] | undefined): number => {
  const val = Array.isArray(param) ? param[0] : param;
  if (!val) throw new Error("ID inválido");
  const id = parseInt(val, 10);
  if (isNaN(id)) throw new Error("ID inválido");
  return id;
};

const paramStr = (param: string | string[] | undefined): string => {
  if (!param) return "";
  if (Array.isArray(param)) return String(param[0]);
  return param;
};

// ==================== HELPERS PARA EXCEL ====================
function getCellText(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") return String(v);
  if (v instanceof Date) return formatDate(v);
  if (typeof v === "object" && "richText" in v) {
    return (v as any).richText.map((r: any) => r.text).join("").trim();
  }
  if (typeof v === "object" && "result" in v) {
    return getCellTextFromValue((v as any).result);
  }
  return String(v).trim();
}

function getCellTextFromValue(v: any): string {
  if (v instanceof Date) return formatDate(v);
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

function formatDate(d: Date | null): string | null {
  if (!d || !(d instanceof Date) || isNaN(d.getTime())) return null;
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseExcelDate(cell: ExcelJS.Cell | undefined): Date | null {
  if (!cell || !cell.value) return null;
  const v = cell.value;
  if (v instanceof Date) return v;
  if (typeof v === "object" && "result" in v) {
    const res = (v as any).result;
    if (res instanceof Date) return res;
    if (typeof res === "number") {
      const excelEpoch = new Date(Date.UTC(1899, 11, 30));
      return new Date(excelEpoch.getTime() + res * 86400000);
    }
  }
  if (typeof v === "number") {
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    return new Date(excelEpoch.getTime() + v * 86400000);
  }
  if (typeof v === "string") {
    // Try catching DD/MM/YYYY or DD-MM-YYYY
    const match = v.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
    if (match) {
      const day = parseInt(match[1], 10);
      const month = parseInt(match[2], 10) - 1;
      let year = parseInt(match[3], 10);
      if (year < 100) year += year < 50 ? 2000 : 1900;
      const d = new Date(year, month, day);
      if (!isNaN(d.getTime())) return d;
    }
    // Fallback nativo
    const d = new Date(v);
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

// ==================== EXCEL RUTA - CONSTANTES ====================
const HEADER_ROW = 5;
const DATA_START_ROW = 6;

const COLUMN_MAP: Record<string, string> = {
  "APELLIDOS Y NOMBRES": "nombre",
  "SALIÓ A RUTA": "salio_a_ruta",
  "SALIO A RUTA": "salio_a_ruta",
  "COMENTARIO": "comentario",
  "DNI": "dni",
  "F.V DNI": "fv_dni",
  "F.V. DNI": "fv_dni",
  "FECHA VENCIMIENTO DNI": "fv_dni",
  "BREVETE CONDUCTOR": "brevete",
  "CATEGORÍA DE BREVETE": "categoria_brevete",
  "CATEGORIA DE BREVETE": "categoria_brevete",
  "F.V. BREVETE": "fv_brevete",
  "F.V BREVETE": "fv_brevete",
  "FECHA VENCIMIENTO BREVETE": "fv_brevete",
};

function calcularDiasRestantes(fechaVenc: Date | null): number | null {
  if (!fechaVenc) return null;
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const diff = fechaVenc.getTime() - hoy.getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

function calcularStatus(diasRestantes: number | null): string {
  if (diasRestantes === null) return "SIN FECHA";
  if (diasRestantes < 0) return "VENCIDO";
  if (diasRestantes <= 30) return "POR VENCER";
  return "VIGENTE";
}

interface RegistroRuta {
  numero: number;
  mes: string;
  nombre: string;
  salio_a_ruta: string;
  comentario: string;
  dni: string;
  fv_dni: string | null;
  tiempo_venc_dni: number | null;
  status_dni: string | null;
  brevete: string;
  categoria_brevete: string;
  fv_brevete: string | null;
  tiempo_venc_brevete: number | null;
  status_brevete: string | null;
}

async function parseExcelRuta(buffer: Buffer | Uint8Array | ArrayBuffer, period: string): Promise<RegistroRuta[]> {
  const workbook = new ExcelJS.Workbook();
  // @ts-ignore - ExcelJS accepts Uint8Array but types don't match
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];

  const headerRow = sheet.getRow(HEADER_ROW);
  const colIndex: Record<string, number> = {};

  headerRow.eachCell((cell, colNum) => {
    const headerText = getCellText(cell).toUpperCase();
    for (const [key, internalKey] of Object.entries(COLUMN_MAP)) {
      if (headerText === key.toUpperCase()) {
        colIndex[internalKey] = colNum;
        break;
      }
    }
  });

  const columnasObligatorias = ["nombre", "dni"];
  const encontradas = columnasObligatorias.filter(c => colIndex[c]);
  if (encontradas.length < columnasObligatorias.length) {
    throw new Error(`Columnas obligatorias no encontradas: ${columnasObligatorias.filter(c => !colIndex[c]).join(", ")}`);
  }

  const registros: RegistroRuta[] = [];
  let numero = 1;

  sheet.eachRow({ includeEmpty: false }, (row, rowNum) => {
    if (rowNum < DATA_START_ROW) return;

    const nombre = getCellText(row.getCell(colIndex["nombre"] || 0));
    if (!nombre) return;

    const salio_a_ruta = getCellText(row.getCell(colIndex["salio_a_ruta"] || 0));
    const comentario = getCellText(row.getCell(colIndex["comentario"] || 0));
    const dni = getCellText(row.getCell(colIndex["dni"] || 0));
    const brevete = getCellText(row.getCell(colIndex["brevete"] || 0));
    const categoria_brevete = getCellText(row.getCell(colIndex["categoria_brevete"] || 0));

    const fvDniDate = parseExcelDate(row.getCell(colIndex["fv_dni"] || 0));
    const fvBrevDate = parseExcelDate(row.getCell(colIndex["fv_brevete"] || 0));

    const tiempo_venc_dni = calcularDiasRestantes(fvDniDate);
    const tiempo_venc_brevete = calcularDiasRestantes(fvBrevDate);

    registros.push({
      numero,
      mes: period,
      nombre,
      salio_a_ruta,
      comentario,
      dni,
      fv_dni: formatDate(fvDniDate),
      tiempo_venc_dni,
      status_dni: tiempo_venc_dni !== null ? calcularStatus(tiempo_venc_dni) : null,
      brevete,
      categoria_brevete,
      fv_brevete: formatDate(fvBrevDate),
      tiempo_venc_brevete,
      status_brevete: tiempo_venc_brevete !== null ? calcularStatus(tiempo_venc_brevete) : null,
    });

    numero++;
  });

  return registros;
}

interface CellInfo {
  cell: string;
  value: string;
  type: string;
  isStatic: boolean;
  isInput: boolean;
}

interface StructureMap {
  sheetName: string;
  totalRows: number;
  totalCols: number;
  cells: CellInfo[];
  inputs: { cell: string; label: string }[];
  mergedCells: { range: string }[];
  checksum: {
    rowCount: number;
    colCount: number;
    staticHeaders: { cell: string; value: string }[];
  };
}

// GET /:programId/config - Obtener config activa
router.get("/:programId/config", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const programId = parseId(req.params.programId);
    const config = await prisma.programFileConfig.findUnique({
      where: { programId },
      include: { records: { orderBy: { period: "desc" }, take: 6 } },
    });
    res.json(config);
  } catch (error) {
    res.status(500).json({ error: "Error al obtener configuración" });
  }
});

// POST /:programId/upload-template - Subir Excel y extraer structureMap
router.post("/:programId/upload-template", authMiddleware, upload.single("file"), async (req: AuthRequest, res: Response) => {
  try {
    if (req.user?.roleId !== 1) {
      return res.status(403).json({ error: "Solo admins pueden subir plantillas" });
    }

    const programId = parseId(req.params.programId);
    const program = await prisma.program.findUnique({ where: { id: programId } });
    if (!program) {
      return res.status(404).json({ error: "Programa no encontrado" });
    }

    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: "No se recibió archivo" });
    }

    if (!file.originalname.match(/\.xlsx?$/)) {
      return res.status(400).json({ error: "Solo se aceptan archivos .xlsx" });
    }

    const workbook = new ExcelJS.Workbook();
    // @ts-ignore - ExcelJS accepts Uint8Array but types don't match
    await workbook.xlsx.load(file.buffer);
    const sheet = workbook.worksheets[0];

    const cells: CellInfo[] = [];
    sheet.eachRow({ includeEmpty: false }, (row, rowNum) => {
      row.eachCell({ includeEmpty: false }, (cell, colNum) => {
        const cellAddr = cell.address;
        const cellValue = getCellText(cell);
        cells.push({
          cell: cellAddr,
          value: cellValue,
          type: "text",
          isStatic: true,
          isInput: false,
        });
      });
    });

    const mergedCells = sheet.model.merges?.map((m: any) => ({ range: m })) || [];
    const checksum = {
      rowCount: sheet.rowCount,
      colCount: sheet.columnCount,
      staticHeaders: cells.slice(0, 10).map((c) => ({ cell: c.cell, value: c.value })),
    };

    const structureMap: StructureMap = {
      sheetName: sheet.name || "Hoja1",
      totalRows: sheet.rowCount,
      totalCols: sheet.columnCount,
      cells,
      inputs: [],
      mergedCells,
      checksum,
    };

    res.json({
      fileName: file.originalname,
      structureMap,
    });
  } catch (error: any) {
    console.error("Error al procesar Excel:", error);
    res.status(500).json({ error: error.message || "Error al procesar Excel" });
  }
});

// PUT /:programId/config - Guardar config con inputs marcados + frecuencia
router.put("/:programId/config", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (req.user?.roleId !== 1) {
      return res.status(403).json({ error: "Solo admins pueden configurar" });
    }

    const programId = parseId(req.params.programId);
    const { fileName, structureMap, frequencyType, executionDay } = req.body;

    if (!structureMap) {
      return res.status(400).json({ error: "No se proporcionó el mapeo de estructura de Excel" });
    }

    const program = await prisma.program.findUnique({ where: { id: programId } });
    if (!program) {
      return res.status(404).json({ error: "Programa no encontrado" });
    }

    const config = await prisma.programFileConfig.upsert({
      where: { programId },
      create: {
        programId,
        fileName: fileName || "plantilla.xlsx",
        structureMap,
        frequencyType: frequencyType || "MENSUAL",
        executionDay: executionDay || null,
      },
      update: {
        fileName: fileName || "plantilla.xlsx",
        structureMap,
        frequencyType: frequencyType || "MENSUAL",
        executionDay: executionDay || null,
      },
    });

    // Auto-crear o actualizar pregunta EXCEL_DATA
    const excelQuestion = await prisma.question.findFirst({
      where: { type: "EXCEL_DATA", excelConfigId: config.id }
    });

    if (excelQuestion) {
      // Actualizar si existe
      await prisma.question.update({
        where: { id: excelQuestion.id },
        data: { isActive: true }
      });
    } else {
      // Crear nueva pregunta oculta para EXCEL_DATA
      await prisma.question.create({
        data: {
          text: `Datos Excel - ${program.name}`,
          description: `Registros importados del programa ${program.name}`,
          targetType: "MIS_PROGRAMAS",
          type: "EXCEL_DATA",
          excelConfigId: config.id,
          hidden: true,
          frequencyType: "MENSUAL",
          order: 99999,
        }
      });
    }

    res.json(config);
  } catch (error: any) {
    console.error("Error al guardar config:", error);
    res.status(500).json({ error: error.message || "Error al guardar configuración" });
  }
});

// GET /:programId/records - Lista de MonthlyRecord
router.get("/:programId/records", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const programId = parseId(req.params.programId);
    const config = await prisma.programFileConfig.findUnique({
      where: { programId },
      include: { records: { orderBy: { period: "desc" } } },
    });

    if (!config) {
      return res.json([]);
    }

    res.json(config.records);
  } catch (error) {
    res.status(500).json({ error: "Error al obtener registros" });
  }
});

// GET /:programId/records/latest - Último período completado
router.get("/:programId/records/latest", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const programId = parseId(req.params.programId);

    const config = await prisma.programFileConfig.findUnique({ where: { programId } });
    if (!config) {
      return res.json(null);
    }

    const latestRecord = await prisma.monthlyRecord.findFirst({
      where: { configId: config.id, status: "COMPLETADO" },
      orderBy: { period: "desc" },
    });

    res.json(latestRecord);
  } catch (error) {
    res.status(500).json({ error: "Error al obtener último registro" });
  }
});

// GET /:programId/records/:period - Datos de un período
router.get("/:programId/records/:period", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const programId = parseId(req.params.programId);
    const period = paramStr(req.params.period);

    const config = await prisma.programFileConfig.findUnique({ where: { programId } });
    if (!config) {
      return res.status(404).json({ error: "No hay configuración para este programa" });
    }

    const record = await prisma.monthlyRecord.findUnique({
      where: { configId_period: { configId: config.id, period } },
    });

    res.json(record || { configId: config.id, period, data: {}, status: "PENDIENTE", source: "MANUAL" });
  } catch (error) {
    res.status(500).json({ error: "Error al obtener registro" });
  }
});

// PATCH /:programId/records/:period/ajuste - Ajuste inline de un registro
router.patch("/:programId/records/:period/ajuste", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (req.user?.roleId !== 1) {
      return res.status(403).json({ error: "Solo admins pueden ajustar" });
    }

    const programId = parseId(req.params.programId);
    const period = paramStr(req.params.period);
    const { numero, campo, nuevoValor } = req.body;

    const config = await prisma.programFileConfig.findUnique({ where: { programId } });
    if (!config) {
      return res.status(404).json({ error: "No hay configuración" });
    }

    const record = await prisma.monthlyRecord.findUnique({
      where: { configId_period: { configId: config.id, period } },
    });

    if (!record) {
      return res.status(404).json({ error: "No hay registro para este período" });
    }

    const data = record.data as any;
    const registros = data.registros || [];

    const idx = registros.findIndex((r: any) => r.numero === numero);
    if (idx === -1) {
      return res.status(404).json({ error: "Registro no encontrado" });
    }

    registros[idx][campo] = nuevoValor;
    registros[idx].editado = true;
    registros[idx].editadoPor = req.user?.email;
    registros[idx].editadoEn = new Date().toISOString();

    await prisma.monthlyRecord.update({
      where: { id: record.id },
      data: { data: { registros }, status: "COMPLETADO" },
    });

    res.json({ message: "Registro actualizado", registroActualizado: registros[idx] });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Error al ajustar" });
  }
});

// POST /:programId/records/:period - Guardar edición manual
router.post("/:programId/records/:period", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (req.user?.roleId !== 1) {
      return res.status(403).json({ error: "Solo admins pueden guardar" });
    }

    const programId = parseId(req.params.programId);
    const period = paramStr(req.params.period);
    const { data, status, source } = req.body;

    const config = await prisma.programFileConfig.findUnique({ where: { programId } });
    if (!config) {
      return res.status(404).json({ error: "No hay configuración para este programa" });
    }

    const record = await prisma.monthlyRecord.upsert({
      where: { configId_period: { configId: config.id, period } },
      create: {
        configId: config.id,
        period,
        data: data || {},
        status: status || "PENDIENTE",
        source: source || "MANUAL",
        completedAt: status === "COMPLETADO" ? new Date() : null,
      },
      update: {
        data: data || {},
        status: status || "PENDIENTE",
        source: source || "MANUAL",
        completedAt: status === "COMPLETADO" ? new Date() : null,
      },
    });

    res.json(record);
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Error al guardar registro" });
  }
});

// POST /:programId/records/:period/import - Importar Excel del período (Ruta)
router.post("/:programId/records/:period/import", authMiddleware, upload.single("file"), async (req: AuthRequest, res: Response) => {
  try {
    if (req.user?.roleId !== 1) {
      return res.status(403).json({ error: "Solo admins pueden importar" });
    }

    const programId = parseId(req.params.programId);
    const period = paramStr(req.params.period);
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: "No se recibió archivo" });
    }

    const config = await prisma.programFileConfig.findUnique({ where: { programId } });
    if (!config) {
      return res.status(404).json({ error: "No hay configuración para este programa" });
    }

    const registros = await parseExcelRuta(file.buffer, period);

    if (registros.length === 0) {
      return res.status(400).json({ error: "No se encontraron datos de personas en el archivo" });
    }

    const record = await prisma.monthlyRecord.upsert({
      where: { configId_period: { configId: config.id, period } },
      create: {
        configId: config.id,
        period,
        data: { registros } as any,
        status: "COMPLETADO",
        source: "EXCEL",
        completedAt: new Date(),
      },
      update: {
        data: { registros } as any,
        status: "COMPLETADO",
        source: "EXCEL",
        completedAt: new Date(),
      },
    });

    res.json({
      message: `${registros.length} registros importados`,
      record,
      state: "IMPORTADO",
      resumen: {
        total: registros.length,
        salenARuta: registros.filter(r => r.salio_a_ruta === "SI").length,
        vencidosDni: registros.filter(r => r.status_dni === "VENCIDO").length,
        porVencerDni: registros.filter(r => r.status_dni === "POR VENCER").length,
        vigentesDni: registros.filter(r => r.status_dni === "VIGENTE").length,
        vencidosBrevete: registros.filter(r => r.status_brevete === "VENCIDO").length,
        porVencerBrevete: registros.filter(r => r.status_brevete === "POR VENCER").length,
      },
    });
  } catch (error: any) {
    console.error("Error al importar:", error);
    res.status(500).json({ error: error.message || "Error al importar Excel" });
  }
});

// GET /:programId/pending-status - ¿Hay carga vencida?
router.get("/:programId/pending-status", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const programId = parseId(req.params.programId);
    const config = await prisma.programFileConfig.findUnique({ where: { programId } });

    if (!config || config.frequencyType !== "MENSUAL") {
      return res.json({ hasPendingLoad: false });
    }

    const today = new Date();
    const period = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;

    const existingRecord = await prisma.monthlyRecord.findUnique({
      where: { configId_period: { configId: config.id, period } },
    });

    const hasPending = !existingRecord && config.executionDay && today.getDate() > config.executionDay;

    res.json({
      hasPendingLoad: hasPending,
      period,
      executionDay: config.executionDay,
      daysSinceExpected: hasPending ? today.getDate() - config.executionDay! : 0,
    });
  } catch (error) {
    res.status(500).json({ error: "Error al verificar estado" });
  }
});

// GET /:programId/records/:period/summary - Resumen de status
router.get("/:programId/records/:period/summary", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const programId = parseId(req.params.programId);
    const period = paramStr(req.params.period);

    const config = await prisma.programFileConfig.findUnique({ where: { programId } });
    if (!config) {
      return res.json(null);
    }

    const record = await prisma.monthlyRecord.findUnique({
      where: { configId_period: { configId: config.id, period } },
    });

    if (!record) {
      return res.json(null);
    }

    const data = record.data as unknown as { registros: RegistroRuta[] };
    const regs = data.registros || [];

    res.json({
      period,
      totalPersonas: regs.length,
      salenARuta: regs.filter(r => r.salio_a_ruta === "SI").length,
      dni: {
        vigentes: regs.filter(r => r.status_dni === "VIGENTE").length,
        porVencer: regs.filter(r => r.status_dni === "POR VENCER").length,
        vencidos: regs.filter(r => r.status_dni === "VENCIDO").length,
        sinFecha: regs.filter(r => r.status_dni === "SIN FECHA").length,
      },
      brevete: {
        vigentes: regs.filter(r => r.status_brevete === "VIGENTE").length,
        porVencer: regs.filter(r => r.status_brevete === "POR VENCER").length,
        vencidos: regs.filter(r => r.status_brevete === "VENCIDO").length,
        sinFecha: regs.filter(r => r.status_brevete === "SIN FECHA").length,
      },
    });
  } catch (error) {
    res.status(500).json({ error: "Error al obtener resumen" });
  }
});

export default router;