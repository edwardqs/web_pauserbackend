/**
 * Calcula el período actual basado en la frecuencia de la pregunta
 * Retorna { periodStart, periodEnd } para saber en qué período estamos
 */
export function getCurrentPeriod(
  frequencyType: string,
  frequencyDay: number | null,
  frequencyInterval: number | null,
  referenceDate: Date = new Date()
): { periodStart: Date; periodEnd: Date } {
  const interval = frequencyInterval || 1;
  const date = new Date(referenceDate);

  switch (frequencyType) {
    case "DIARIA": {
      const start = new Date(date);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      return { periodStart: start, periodEnd: end };
    }

    case "SEMANAL": {
      // frequencyDay: 1=Lunes, 7=Domingo. Si no se especifica, usa Lunes
      const targetDay = frequencyDay || 1;
      const currentDay = date.getDay() || 7; // Convertir 0(Domingo) a 7
      const daysSinceTarget = currentDay - targetDay;
      
      // Calcular en qué semana estamos (cada `interval` semanas)
      const weekStart = new Date(date);
      weekStart.setDate(weekStart.getDate() - daysSinceTarget);
      
      // Determinar si estamos en un período de intervalo
      const startOfYear = new Date(date.getFullYear(), 0, 1);
      const weeksSinceYearStart = Math.floor(
        (weekStart.getTime() - startOfYear.getTime()) / (7 * 24 * 60 * 60 * 1000)
      );
      const currentPeriodWeek = Math.floor(weeksSinceYearStart / interval) * interval;
      
      const periodStart = new Date(startOfYear);
      periodStart.setDate(periodStart.getDate() + currentPeriodWeek * 7);
      
      const periodEnd = new Date(periodStart);
      periodEnd.setDate(periodEnd.getDate() + interval * 7);
      
      return { periodStart, periodEnd };
    }

    case "MENSUAL": {
      // frequencyDay: día del mes (1-31). Si no se especifica, usa 1
      const targetDay = frequencyDay || 1;
      const month = date.getMonth();
      const year = date.getFullYear();
      
      // Calcular en qué período de intervalo estamos
      const currentPeriodMonth = Math.floor(month / interval) * interval;
      
      const periodStart = new Date(year, currentPeriodMonth, targetDay);
      const nextPeriodMonth = currentPeriodMonth + interval;
      const periodEnd = new Date(year, nextPeriodMonth, targetDay);
      
      return { periodStart, periodEnd };
    }

    case "ANUAL": {
      const year = date.getFullYear();
      // Si frequencyDay y frequencyInterval no se usan mucho para anual, simplificar
      const periodStart = new Date(year, 0, 1);
      const periodEnd = new Date(year + interval, 0, 1);
      return { periodStart, periodEnd };
    }

    case "DIA_ESPECIFICO": {
      // frequencyDay: día específico del mes (ej: día 15)
      const targetDay = frequencyDay || 1;
      const dayOfMonth = date.getDate();
      
      if (dayOfMonth < targetDay) {
        // Todavía no llegamos al día específico este mes
        const periodStart = new Date(date.getFullYear(), date.getMonth() - 1, targetDay);
        const periodEnd = new Date(date.getFullYear(), date.getMonth(), targetDay);
        return { periodStart, periodEnd };
      } else {
        const periodStart = new Date(date.getFullYear(), date.getMonth(), targetDay);
        const periodEnd = new Date(date.getFullYear(), date.getMonth() + 1, targetDay);
        return { periodStart, periodEnd };
      }
    }

    case "UNICA":
    default: {
      // Preguntas únicas: un solo período que abarca toda la campaña
      const epochStart = new Date(2000, 0, 1);
      const epochEnd = new Date(2100, 0, 1);
      return { periodStart: epochStart, periodEnd: epochEnd };
    }
  }
}

/**
 * Verifica si una pregunta debería mostrarse como disponible hoy
 */
export function isQuestionAvailableToday(
  frequencyType: string,
  frequencyDay: number | null,
  frequencyInterval: number | null,
  today: Date = new Date()
): boolean {
  switch (frequencyType) {
    case "DIARIA":
      return true; // Siempre disponible cada día

    case "SEMANAL": {
      const targetDay = frequencyDay || 1; // 1=Lunes, 7=Domingo
      const currentDay = today.getDay() || 7;
      // Verificar si estamos en la semana correcta del intervalo
      const startOfYear = new Date(today.getFullYear(), 0, 1);
      const msInWeek = 7 * 24 * 60 * 60 * 1000;
      const weeksSinceYearStart = Math.floor(
        (today.getTime() - startOfYear.getTime()) / msInWeek
      );
      return weeksSinceYearStart % (frequencyInterval || 1) === 0;
    }

    case "MENSUAL": {
      const targetDay = frequencyDay || 1;
      const todayDay = today.getDate();
      // Disponible si hoy es >= al día objetivo
      return todayDay >= targetDay;
    }

    case "ANUAL":
      return true;

    case "DIA_ESPECIFICO": {
      const targetDay = frequencyDay || 1;
      const todayDay = today.getDate();
      return todayDay === targetDay;
    }

    case "UNICA":
    default:
      return true;
  }
}
