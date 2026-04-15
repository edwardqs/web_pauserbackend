import { PrismaClient } from "../generated/prisma";
const prisma = new PrismaClient();

async function run() {
  const payload = {
    campaignId: 2,
    answers: [
      {
        questionId: 1,
        files: [
          {
            fileType: "PDF",
            fileName: "CV_QUISPE SANCHEZ EDWARD STEVEN.pdf",
            fileUrl: "http://localhost:3000/uploads/1775773724218-435864925-CV_QUISPE SANCHEZ EDWARD STEVEN.pdf"
          },
          {
            fileType: "IMAGEN",
            fileName: "Imagen2.png",
            fileUrl: "http://localhost:3000/uploads/1775773735444-161195458-Imagen2.png"
          }
        ]
      },
      {
        questionId: 2,
        files: [
           {
            fileType: "IMAGEN",
            fileName: "284.jpg",
            fileUrl: "http://localhost:3000/uploads/1775773767954-356498970-284.jpg"
           }
        ]
      }
    ]
  };

  try {
    const existingEvaluation = await prisma.evaluation.findUnique({
      where: { userId_campaignId: { userId: 1, campaignId: payload.campaignId } },
    });
    if (existingEvaluation) {
      await prisma.evaluation.delete({ where: { id: existingEvaluation.id } });
    }

    const evaluation = await prisma.evaluation.create({
      data: {
        userId: 1,
        campaignId: payload.campaignId,
        totalScore: 6,
        maxScore: 6,
        completedAt: new Date(),
        answers: {
          create: payload.answers.map((a: any) => ({
            questionId: a.questionId,
            awardedScore: a.files && a.files.length > 0 ? 3 : 0,
            files: a.files ? {
              create: a.files.map((f: any) => ({
                fileType: f.fileType,
                fileName: f.fileName,
                fileUrl: f.fileUrl,
              })),
            } : undefined,
          })),
        },
      },
    });
    console.log("SUCCESS:", evaluation);
  } catch (e: any) {
    console.error("PRISMA ERROR:", e);
  }
}

run();
