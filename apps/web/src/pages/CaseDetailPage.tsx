import { caseStatusLabels, getAvailableTransitions } from '@domdelo/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ChangeEvent, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';

import { caseApi, getDemoUser } from '../api.js';
import { ErrorState, LoadingState } from '../components/StateViews.js';
import { formatRelativeDate, statusTone } from '../format.js';

const actionLabels = {
  resolved: 'Подтверждаю устранение',
  disputed: 'Проблема осталась',
} as const;

export function CaseDetailPage() {
  const { caseId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [uploadKind, setUploadKind] = useState<'problem' | 'result'>('problem');
  const query = useQuery({ queryKey: ['case', caseId], queryFn: () => caseApi.get(caseId) });
  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['case', caseId] }),
      queryClient.invalidateQueries({ queryKey: ['cases'] }),
    ]);
  };
  const confirm = useMutation({ mutationFn: () => caseApi.confirm(caseId), onSuccess: invalidate });
  const watch = useMutation({ mutationFn: () => caseApi.watch(caseId), onSuccess: invalidate });
  const transition = useMutation({
    mutationFn: (status: 'resolved' | 'disputed') =>
      caseApi.transition(caseId, { status, expectedVersion: query.data!.version }),
    onSuccess: invalidate,
  });
  const upload = useMutation({
    mutationFn: (file: File) => caseApi.upload(caseId, uploadKind, file),
    onSuccess: invalidate,
  });

  const role = getDemoUser().startsWith('dispatcher')
    ? 'dispatcher'
    : getDemoUser().startsWith('executor')
      ? 'executor'
      : 'resident';

  const onFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) upload.mutate(file);
    event.target.value = '';
  };

  if (query.isPending) return <main className="page"><LoadingState label="Открываем карточку" /></main>;
  if (query.isError) {
    return <main className="page"><ErrorState message={query.error.message} onRetry={() => void query.refetch()} /></main>;
  }

  const item = query.data;
  const residentTransitions = getAvailableTransitions(item.status, 'resident');

  return (
    <main className="page page--detail">
      <Link className="back-link" to={role === 'resident' ? '/' : '/dispatcher'}>← Назад к списку</Link>
      {searchParams.get('created') ? (
        <div className="success-banner">✓ Дело зарегистрировано. Соседи уже могут присоединиться.</div>
      ) : null}

      <section className="detail-card">
        <div className="detail-card__heading">
          <div>
            <span className={`status status--${statusTone(item.status)}`}>
              {caseStatusLabels[item.status]}
            </span>
            <span className="case-number">Дело №{item.number}</span>
          </div>
          {item.isDemo ? <span className="demo-chip">Демо-данные</span> : null}
        </div>
        <h1>{item.title}</h1>
        <p className="detail-description">{item.description}</p>
        <div className="detail-grid">
          <div><span>Место</span><strong>{item.place}{item.entrance ? `, подъезд ${item.entrance}` : ''}</strong></div>
          <div><span>Ответственный</span><strong>{item.responsibleOrganization}</strong></div>
          {item.assignee ? <div><span>Исполнитель</span><strong>{item.assignee}</strong></div> : null}
          <div><span>Обновлено</span><strong>{formatRelativeDate(item.updatedAt)}</strong></div>
        </div>
        <div className="collective-stats">
          <div><strong>{item.confirmationsCount}</strong><span>подтвердили</span></div>
          <div><strong>{item.watchersCount}</strong><span>следят</span></div>
        </div>
        {role === 'resident' ? (
          <div className="action-row">
            <button
              className="button button--primary"
              disabled={confirm.isPending}
              onClick={() => confirm.mutate()}
            >
              У меня тоже
            </button>
            <button
              className="button button--secondary"
              disabled={watch.isPending}
              onClick={() => watch.mutate()}
            >
              Следить за делом
            </button>
          </div>
        ) : null}
      </section>

      <section className="content-card">
        <div className="section-heading section-heading--inside">
          <div><h2>Фотографии</h2><p>Доказательства проблемы и результата</p></div>
        </div>
        {item.attachments.length ? (
          <div className="photo-grid">
            {item.attachments.map((attachment) => (
              <figure key={attachment.id}>
                <img src={attachment.url} alt={attachment.kind === 'result' ? 'Результат работы' : 'Проблема'} />
                <figcaption>{attachment.kind === 'result' ? 'Результат' : 'Проблема'}</figcaption>
              </figure>
            ))}
          </div>
        ) : <p className="muted-box">Фотографий пока нет.</p>}
        <div className="upload-row">
          <select value={uploadKind} onChange={(event) => setUploadKind(event.target.value as 'problem' | 'result')}>
            <option value="problem">Фото проблемы</option>
            {role !== 'resident' ? <option value="result">Фото результата</option> : null}
          </select>
          <label className="button button--secondary file-button">
            {upload.isPending ? 'Загружаем…' : 'Добавить фото'}
            <input type="file" accept="image/jpeg,image/png,image/webp" onChange={onFile} disabled={upload.isPending} />
          </label>
        </div>
        {upload.isError ? <p className="form-error">{upload.error.message}</p> : null}
      </section>

      {role === 'resident' && residentTransitions.length > 0 ? (
        <section className="verification-card">
          <span className="verification-card__icon">✓</span>
          <div>
            <h2>Работа выполнена. Проверьте результат</h2>
            <p>{item.resultComment || 'Исполнитель сообщил о завершении работ.'}</p>
            <div className="action-row">
              {residentTransitions.map((status) => (
                <button
                  key={status}
                  className={status === 'resolved' ? 'button button--primary' : 'button button--danger'}
                  disabled={transition.isPending}
                  onClick={() => transition.mutate(status as 'resolved' | 'disputed')}
                >
                  {actionLabels[status as keyof typeof actionLabels]}
                </button>
              ))}
            </div>
            {transition.isError ? <p className="form-error">{transition.error.message}</p> : null}
          </div>
        </section>
      ) : null}

      <section className="content-card">
        <div className="section-heading section-heading--inside">
          <div><h2>История дела</h2><p>Все значимые изменения</p></div>
        </div>
        <ol className="timeline">
          {[...item.history].reverse().map((historyItem) => (
            <li key={historyItem.id}>
              <span className="timeline__dot" />
              <div>
                <strong>{caseStatusLabels[historyItem.toStatus]}</strong>
                {historyItem.comment ? <p>{historyItem.comment}</p> : null}
                <span>{historyItem.actorName} · {formatRelativeDate(historyItem.createdAt)}</span>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}

