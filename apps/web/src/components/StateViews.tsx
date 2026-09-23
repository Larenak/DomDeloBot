export function LoadingState({ label = 'Загружаем данные' }: { label?: string }) {
  return (
    <div className="state-card" role="status">
      <span className="spinner" aria-hidden="true" />
      <div>
        <strong>{label}</strong>
        <p>Это займёт несколько секунд.</p>
      </div>
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="state-card state-card--error" role="alert">
      <span className="state-icon">!</span>
      <div>
        <strong>Не удалось загрузить данные</strong>
        <p>{message}</p>
        <button className="button button--secondary button--small" onClick={onRetry}>
          Повторить
        </button>
      </div>
    </div>
  );
}

export function EmptyState() {
  return (
    <div className="empty-state">
      <div className="empty-state__icon">✓</div>
      <h2>В доме пока нет открытых дел</h2>
      <p>Если заметите проблему, создайте дело — соседи смогут присоединиться.</p>
    </div>
  );
}

