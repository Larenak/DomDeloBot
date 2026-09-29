import type { CaseDto, HouseReportDto } from '@domdelo/contracts';

export function makeHouseReport(houseId: string, address: string, items: CaseDto[]): HouseReportDto {
  const now = Date.now();
  const byCategory = new Map<CaseDto['category'], { cases: number; confirmations: number }>();
  for (const item of items) {
    const current = byCategory.get(item.category) ?? { cases: 0, confirmations: 0 };
    current.cases += 1;
    current.confirmations += item.confirmationsCount;
    byCategory.set(item.category, current);
  }
  return {
    houseId,
    address,
    asOf: new Date(now).toISOString(),
    totalCases: items.length,
    openCases: items.filter((item) => item.status !== 'resolved').length,
    overdueForecasts: items.filter((item) =>
      item.status !== 'resolved' && item.plannedCompletionAt &&
      new Date(item.plannedCompletionAt).getTime() < now).length,
    manyConfirmed: items.filter((item) =>
      item.status !== 'resolved' && item.confirmationsCount >= 3).length,
    categories: [...byCategory].map(([category, values]) => ({ category, ...values }))
      .sort((a, b) => b.cases - a.cases),
    source: 'domdelo_internal',
  };
}
