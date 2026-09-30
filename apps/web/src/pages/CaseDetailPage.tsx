import { caseStatusLabels, getAvailableTransitions, type UserRole } from '@domdelo/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ChangeEvent, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { caseApi } from '../api.js';
import { ErrorState, LoadingState } from '../components/StateViews.js';
import { PhotoGallery } from '../components/PhotoGallery.js';
import { CaseDeadlinePanel } from '../components/CaseDeadlinePanel.js';
import { formatDateTime, formatRelativeDate, statusTone } from '../format.js';

const actionLabels = {
  resolved: 'Подтверждаю устранение',
  disputed: 'Проблема осталась',
} as const;

export function CaseDetailPage({ demoMode, role }: { demoMode: boolean; role: UserRole }) {
  const { caseId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [deleteConfirmation, setDeleteConfirmation] = useState(false);
  const deleted = useRef(false);
  const [uploadKind, setUploadKind] = useState<'problem' | 'result'>('problem');
  const query = useQuery({ queryKey: ['case', caseId], queryFn: () => caseApi.get(caseId), refetchInterval: 15_000 });
  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['case', caseId] }),
      queryClient.invalidateQueries({ queryKey: ['cases'] }),
    ]);
  };
  const confirm = useMutation({ mutationFn: () => caseApi.confirm(caseId), onSuccess: (updated) => {
    queryClient.setQueryData(['case', caseId], updated);
    void queryClient.invalidateQueries({ queryKey: ['cases'] });
  } });
  const watch = useMutation({
    mutationFn: (isWatched: boolean) => isWatched ? caseApi.unwatch(caseId) : caseApi.watch(caseId),
    onSuccess: invalidate,
  });
  const transition = useMutation({
    mutationFn: (status: 'resolved' | 'disputed') =>
      caseApi.transition(caseId, { status, expectedVersion: query.data!.version }),
    onSuccess: invalidate,
  });
  const upload = useMutation({
    mutationFn: (file: File) => caseApi.upload(caseId, uploadKind, file),
    onSuccess: invalidate,
  });

  const isResidentRole = ['resident', 'chair'].includes(role);
  const remove = useMutation({
    mutationFn: () => caseApi.remove(caseId),
    onSuccess: async () => {
      deleted.current = true;
      await queryClient.cancelQueries({ queryKey: ['case', caseId], exact: true });
      navigate(isResidentRole ? '/' : '/dispatcher', { replace: true });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['cases'] }),
        queryClient.invalidateQueries({ queryKey: ['house-report'] }),
        queryClient.invalidateQueries({ queryKey: ['polls'] }),
      ]);
    },
  });

  useEffect(() => {
    deleted.current = false;
    return () => {
      // Remove the card after its observer has unsubscribed, so it cannot fetch again.
      if (deleted.current) queryClient.removeQueries({ queryKey: ['case', caseId], exact: true });
    };
  }, [caseId, queryClient]);

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
      <Link className="back-link" to={isResidentRole ? '/' : '/dispatcher'}>← Назад к списку</Link>
      {searchParams.get('created') ? (
        <div className="success-banner" role="status">✓ Дело успешно размещено. Соседи уже могут присоединиться.</div>
      ) : null}
      {searchParams.get('joined') ? (
        <div className="success-banner">✓ Вы присоединились к делу. Теперь это одна коллективная проблема.</div>
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
          <div><span>Предполагаемый адресат</span><strong>{item.responsibleOrganization}</strong></div>
          {item.assignee ? <div><span>Исполнитель</span><strong>{item.assignee}</strong></div> : null}
          <div><span>Плановая дата от диспетчера</span><strong>{item.plannedCompletionAt ? formatDateTime(item.plannedCompletionAt) : 'Пока не указана'}</strong></div>
          <div><span>Обновлено</span><strong>{formatRelativeDate(item.updatedAt)}</strong></div>
        </div>
        <div className="collective-stats">
          <div><strong>{item.confirmationsCount}</strong><span>подтвердили</span></div>
          <div><strong>{item.watchersCount}</strong><span>следят</span></div>
        </div>
        <div className={item.submission.sentAt ? 'submission-panel submission-panel--sent' : 'submission-panel'} role="status">
          {item.submission.sentAt ? (
            <>
              <strong>✓ Дело успешно отправлено диспетчеру УК</strong>
              <p>Демонстрационная отправка в очередь УК · {formatDateTime(item.submission.sentAt)}</p>
              <p>Подтверждений: {item.confirmationsCount} из {item.submission.requiredConfirmations} необходимых.</p>
            </>
          ) : (
            <>
              <strong>Подтверждений для отправки в УК: {item.confirmationsCount} из {item.submission.requiredConfirmations}</strong>
              <progress value={Math.min(item.confirmationsCount, item.submission.requiredConfirmations)} max={item.submission.requiredConfirmations} aria-label="Подтверждения для отправки в УК" />
              <p>Нужно ещё {Math.max(0, item.submission.requiredConfirmations - item.confirmationsCount)}. Автор уже учтён.</p>
              <p>В доме зарегистрировано аккаунтов: {item.submission.registeredAccounts}. Порог — 10%, округлённые вверх, минимум 2. Правило действует и для срочных дел.</p>
            </>
          )}
        </div>
        {isResidentRole ? (
          <div className="action-row">
            <button
              className="button button--primary"
              disabled={confirm.isPending || item.isConfirmed}
              onClick={() => confirm.mutate()}
            >
              {item.isConfirmed ? '✓ Вы подтвердили проблему' : confirm.isPending ? 'Подтверждаем…' : 'У меня тоже'}
            </button>
            <button
              className="button button--secondary"
              disabled={watch.isPending}
              onClick={() => watch.mutate(item.isWatched)}
            >
              {item.isWatched ? '★ Не следить за делом' : '☆ Следить за делом'}
            </button>
          </div>
        ) : null}
        {confirm.isError ? <p className="form-error" role="alert">{confirm.error.message}</p> : null}
        {watch.isError ? <p className="form-error">{watch.error.message}</p> : null}
      </section>

      {item.canDelete ? (
        <section className="content-card">
          {deleteConfirmation ? (
            <div role="alert">
              <h2>Удалить дело №{item.number}?</h2>
              <p>Дело исчезнет из списка у всех жителей. Восстановить его не получится.</p>
              <div className="action-row">
                <button className="button button--danger" disabled={remove.isPending} onClick={() => remove.mutate()}>
                  {remove.isPending ? 'Удаляем…' : 'Да, удалить дело'}
                </button>
                <button className="button button--secondary" disabled={remove.isPending} onClick={() => {
                  setDeleteConfirmation(false);
                  remove.reset();
                }}>Отмена</button>
              </div>
            </div>
          ) : <button className="button button--danger" onClick={() => setDeleteConfirmation(true)}>Удалить дело</button>}
          {remove.isError ? <p className="form-error" role="alert">{remove.error.message}</p> : null}
        </section>
      ) : null}

      {item.deadline ? <CaseDeadlinePanel deadline={item.deadline} /> : null}

      <section className="content-card">
        <div className="section-heading section-heading--inside">
          <div><h2>Фотографии</h2><p>Доказательства проблемы и результата</p></div>
        </div>
        {item.attachments.length ? <PhotoGallery attachments={item.attachments} /> : <p className="muted-box">Фотографий пока нет.</p>}
        {(demoMode || !item.isDemo) ? <div className="upload-row">
          <select value={uploadKind} onChange={(event) => setUploadKind(event.target.value as 'problem' | 'result')}>
            <option value="problem">Фото проблемы</option>
            {['dispatcher', 'executor', 'admin'].includes(role) ? <option value="result">Фото результата</option> : null}
          </select>
          <label className="button button--secondary file-button">
            {upload.isPending ? 'Загружаем…' : 'Добавить фото'}
            <input type="file" accept="image/jpeg,image/png,image/webp" onChange={onFile} disabled={upload.isPending} />
          </label>
        </div> : <p className="muted-box">Загрузка фото в открытом демонстрационном доме отключена.</p>}
        {upload.isError ? <p className="form-error">{upload.error.message}</p> : null}
      </section>

      {isResidentRole && residentTransitions.length > 0 ? (
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
          <div><h2>История дела</h2><p>Этапы внутри ДомДела; это не статус заявки в ГИС ЖКХ</p></div>
        </div>
        <ol className="timeline">
          {[...item.history].reverse().map((historyItem) => (
            <li key={historyItem.id}>
              <span className="timeline__dot" />
              <div>
                <strong>{caseStatusLabels[historyItem.toStatus]}</strong>
                {historyItem.comment ? <p>{historyItem.comment}</p> : null}
                {historyItem.plannedCompletionAt ? <p>Плановая дата: {formatDateTime(historyItem.plannedCompletionAt)}</p> : null}
                <span>{historyItem.actorName} · {formatDateTime(historyItem.createdAt)}</span>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
