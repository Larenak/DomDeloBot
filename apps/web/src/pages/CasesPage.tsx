import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { caseApi } from '../api.js';
import { CaseCard } from '../components/CaseCard.js';
import { EmptyState, ErrorState, LoadingState } from '../components/StateViews.js';

export function CasesPage({ demoMode }: { demoMode: boolean }) {
  const query = useQuery({ queryKey: ['cases'], queryFn: caseApi.list });

  return (
    <main className="page">
      <section className="hero">
        <div>
          <span className="eyebrow">Дом на ул. Спортивной, 12</span>
          <h1>Дела нашего дома</h1>
          <p>Одна проблема — одно прозрачное дело до подтверждённого результата.</p>
        </div>
        <Link className="button button--primary hero__button" to="/new">
          <span aria-hidden="true">＋</span> Создать дело
        </Link>
      </section>

      <section className="section-heading">
        <div>
          <h2>Открытые дела</h2>
          {demoMode ? <p>Демо-данные одного дома</p> : null}
        </div>
        {query.data ? <span className="count-badge">{query.data.length}</span> : null}
      </section>

      {query.isPending ? <LoadingState label="Загружаем дела дома" /> : null}
      {query.isError ? (
        <ErrorState message={query.error.message} onRetry={() => void query.refetch()} />
      ) : null}
      {query.data?.length === 0 ? <EmptyState /> : null}
      {query.data ? (
        <div className="case-list">
          {query.data.map((item) => (
            <CaseCard key={item.id} item={item} />
          ))}
        </div>
      ) : null}
    </main>
  );
}
