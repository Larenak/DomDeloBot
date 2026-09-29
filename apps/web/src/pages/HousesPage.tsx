import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { houseApi } from '../api.js';
import { HouseAddressForm } from '../components/HouseAddressForm.js';
import { ErrorState, LoadingState } from '../components/StateViews.js';

export function HousesPage() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ['house-context'], queryFn: houseApi.context });
  const select = useMutation({
    mutationFn: houseApi.select,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['house-context'] }),
        queryClient.invalidateQueries({ queryKey: ['cases'] }),
      ]);
    },
  });

  return (
    <main className="page page--narrow">
      <section className="hero hero--houses">
        <div>
          <span className="eyebrow">Мои адреса</span>
          <h1>Ваши дома</h1>
          <p>Добавляйте адреса и выбирайте дом, дела которого хотите видеть сейчас.</p>
        </div>
      </section>

      {query.isPending ? <LoadingState label="Загружаем адреса" /> : null}
      {query.isError ? (
        <ErrorState message={query.error.message} onRetry={() => void query.refetch()} />
      ) : null}
      {query.data ? (
        <section className="house-list" aria-label="Добавленные дома">
          {query.data.houses.map((house) => (
            <article className={`house-card${house.isActive ? ' house-card--active' : ''}`} key={house.id}>
              <div>
                <span>{house.isActive ? 'Текущий дом' : 'Добавлен в избранное'}</span>
                <strong>{house.address}</strong>
              </div>
              {house.isActive ? (
                <span className="active-house-badge">Выбран</span>
              ) : (
                <button
                  className="button button--secondary button--small"
                  disabled={select.isPending}
                  onClick={() => select.mutate(house.id)}
                >
                  Выбрать
                </button>
              )}
            </article>
          ))}
          {select.isError ? <p className="form-error">{select.error.message}</p> : null}
        </section>
      ) : null}

      <section className="form-card houses-add-card">
        <h2>Добавить ещё один дом</h2>
        <HouseAddressForm compact />
      </section>
    </main>
  );
}
