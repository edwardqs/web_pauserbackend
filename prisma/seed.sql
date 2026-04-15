-- Seed data for Programa de Excelencia

-- Insert campaign
INSERT INTO "Campaign" (name, "startDate", "endDate", "isActive", "createdAt")
VALUES ('Campaña 2024', NOW(), '2025-12-31'::timestamp, true, NOW());

-- Insert questions
INSERT INTO "Question" (text, "evidenceType", "order", "isActive", "createdAt")
VALUES 
('¿Cuentas con el manual de funciones actualizado?', 'PDF', 1, true, NOW()),
('¿Tienes el organigrama vigente publicado?', 'IMAGEN', 2, true, NOW()),
('¿Presentas informe mensual de actividades?', 'EXCEL', 3, true, NOW()),
('¿Cumples con el plan estratégico anual?', 'PPT', 4, true, NOW()),
('¿Tienes certificados de capacitación del personal?', 'PDF', 5, true, NOW()),
('¿Dispones de presupuesto aprobado?', 'EXCEL', 6, true, NOW());