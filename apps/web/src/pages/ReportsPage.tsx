import type { CaseCategory } from '@domdelo/contracts';
import { useQuery } from '@tanstack/react-query';

import { reportApi } from '../api.js';
import { ErrorState, LoadingState } from '../components/StateViews.js';
import { formatDateTime } from '../format.js';

const categoryNames: Record<CaseCategory, string> = {
  lighting: 'Освещение', entrance: 'Подъезд', elevator: 'Лифт', water: 'Вода',
  heating: 'Отопление', yard: 'Двор', other: 'Другое',
};

export function ReportsPage() {
  const query = useQuery({ queryKey: ['house-report'], queryFn: reportApi.house, refetchInterval: 30_000 });
  return <main className="page">
    <section className="hero hero--dispatcher"><div>
      <span className="eyebrow">Сводные данные</span>
      <h1>Обращения по дому</h1>
      <p>Число отдельных дел, категории и сроки исполнения внутри ДомДела.</p>
    </div></section>
    {query.isPending ? <LoadingState label="Загружаем сводку" /> : null}
    {query.isError ? <ErrorState message={query.error.message} onRetry={() => void query.refetch()} /> : null}
    {query.data ? <section className="content-card">
      <h2>{query.data.address}</h2>
      <p className="muted">Внутренние данные ДомДела · обновлено {formatDateTime(query.data.asOf)}</p>
      <div className="report-grid">
        <div><strong>{query.data.totalCases}</strong><span>отдельных дел</span></div>
        <div><strong>{query.data.openCases}</strong><span>в работе</span></div>
        <div><strong>{query.data.overdueForecasts}</strong><span>просрочен прогноз</span></div>
        <div><strong>{query.data.manyConfirmed}</strong><span>три и более подтверждения</span></div>
      </div>
      <h3>По категориям</h3>
      <div className="summary-categories">{query.data.categories.map((entry) =>
        <span key={entry.category}>{categoryNames[entry.category]}: {entry.cases} дел, {entry.confirmations} подтверждений</span>)}
      </div>
      <p className="muted">Подтверждения соседей не считаются отдельными жалобами. Прогноз исполнителя не является нормативным сроком.</p>
    </section> : null}
  </main>;
}
