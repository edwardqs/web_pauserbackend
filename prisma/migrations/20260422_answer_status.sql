-- Migration: add status, completedAt, updatedAt to Answer
-- Date: 2026-04-22

-- Step 1: Add new columns
ALTER TABLE "Answer" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'ANSWERED';
ALTER TABLE "Answer" ADD COLUMN "completedAt" TIMESTAMP;
ALTER TABLE "Answer" ADD COLUMN "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW();

-- Step 2: Backfill existing answers based on delegation/approval state
UPDATE "Answer" a
SET "status" = CASE
  WHEN EXISTS (SELECT 1 FROM "AnswerDelegation" d WHERE d."answerId"=a.id AND d.status='PENDIENTE') THEN 'PENDING_DELEGATION'
  WHEN EXISTS (SELECT 1 FROM "AnswerApproval" ap WHERE ap."answerId"=a.id AND ap.status='PENDIENTE') THEN 'PENDING_APPROVAL'
  ELSE 'COMPLETED'
END,
"completedAt" = CASE WHEN a."status"='COMPLETED' THEN a."createdAt" ELSE NULL END;

-- Step 3: Set updatedAt to current timestamp for all existing rows
UPDATE "Answer" SET "updatedAt" = NOW() WHERE "updatedAt" IS NULL;
