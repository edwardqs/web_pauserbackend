import { prisma } from "./lib/prisma.js";

async function main() {
  // Check user 3's program questions
  const up = await prisma.userProgram.findMany({
    where: { userId: 3 },
    include: {
      program: {
        include: {
          questions: {
            include: {
              question: {
                select: { id: true, text: true, description: true, points: true, order: true },
              },
            },
          },
        },
      },
    },
  });

  console.log("User 3 program details:");
  up.forEach(u => {
    console.log(`Program: ${u.program.name}`);
    console.log(`Questions: ${u.program.questions.length}`);
    u.program.questions.forEach(q => {
      console.log(`- ${q.question.text.substring(0,30)} (pts: ${q.question.points})`);
    });
  });
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => { console.error(e); prisma.$disconnect(); });