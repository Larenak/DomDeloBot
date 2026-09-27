import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { caseApi, houseApi } from '../api.js';
import { CaseCard } from '../components/CaseCard.js';
import { EmptyState, ErrorState, LoadingState } from '../components/StateViews.js';

export function CasesPage() {
  const query = useQuery({ queryKey: ['cases'], queryFn: caseApi.list });
  const houses = useQuery({ queryKey: ['house-context'], queryFn: houseApi.context });
  const activeHouse = houses.data?.houses.find((house) => house.isActive);
  const watchedCases = query.data?.filter((item) => item.isWatched) || [];
  const otherCases = query.data?.filter((item) => !item.isWatched) || [];

  return (
    <main className="page">
      <section className="hero">
        <div>
          <span className="eyebrow">{activeHouse?.address || 'Выбранный дом'}</span>
          <h1>Дела нашего дома</h1>
          <p>Одна проблема — одно прозрачное дело до подтверждённого результата.</p>
        </div>
        <Link className="button button--primary hero__button" to="/new">
          <span aria-hidden="true">＋</span> Создать дело
        </Link>
      </section>

      {query.isPending ? <LoadingState label="Загружаем дела дома" /> : null}
      {query.isError ? (
        <ErrorState message={query.error.message} onRetry={() => void query.refetch()} />
      ) : null}
      {query.data?.length === 0 ? <EmptyState /> : null}
      {query.data && query.data.length > 0 ? (
        <>
          <section className="section-heading">
            <div>
              <h2>Отслеживаю</h2>
              <p>Дела этого дома, за которыми вы следите</p>
            </div>
            <span className="count-badge">{watchedCases.length}</span>
          </section>
          {watchedCases.length ? (
            <div className="case-list">
              {watchedCases.map((item) => <CaseCard key={item.id} item={item} />)}
            </div>
          ) : (
            <p className="muted-box">Откройте дело и нажмите «Следить за делом» — оно появится здесь.</p>
          )}
          <section className="section-heading">
            <div>
              <h2>Остальные дела дома</h2>
              <p>Все обращения по выбранному адресу, на которые вы ещё не подписаны</p>
            </div>
            <span className="count-badge">{otherCases.length}</span>
          </section>
          {otherCases.length ? (
            <div className="case-list">
              {otherCases.map((item) => <CaseCard key={item.id} item={item} />)}
            </div>
          ) : <p className="muted-box">Других дел пока нет.</p>}
        </>
      ) : null}
    </main>
  );
}
