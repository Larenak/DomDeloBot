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

  const remove = useMutation({
    mutationFn: houseApi.remove,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['house-context'] }),
        queryClient.invalidateQueries({ queryKey: ['cases'] }),
        queryClient.invalidateQueries({ queryKey: ['polls'] }),
        queryClient.invalidateQueries({ queryKey: ['house-report'] }),
      ]);
    },
  });

  return (
    <main className="page page--narrow">
      <section className="hero hero--houses">
        <div>
          <span className="eyebrow">Мои адреса</span>
          <h1>Ваши дома</h1>
          <p>Добавляйте адреса без кода, выбирайте текущий дом и смотрите его дела.</p>
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
              <div className="house-card__actions">
                {house.isActive ? (
                  <span className="active-house-badge">Выбран</span>
                ) : (
                  <button
                    className="button button--secondary button--small"
                    disabled={select.isPending || remove.isPending}
                    onClick={() => select.mutate(house.id)}
                  >
                    Выбрать
                  </button>
                )}
                <button
                  className="button button--danger button--small"
                  disabled={remove.isPending}
                  onClick={() => {
                    if (window.confirm(`Удалить адрес «${house.address}» из профиля? Доступ к этому дому будет отозван.`)) {
                      remove.mutate(house.id);
                    }
                  }}
                >
                  Удалить
                </button>
              </div>
            </article>
          ))}
          {select.isError ? <p className="form-error">{select.error.message}</p> : null}
          {remove.isError ? <p className="form-error" role="alert">{remove.error.message}</p> : null}
        </section>
      ) : null}

      <section className="form-card houses-add-card">
        <h2>Добавить ещё один дом</h2>
        <HouseAddressForm compact />
      </section>
    </main>
  );
}
