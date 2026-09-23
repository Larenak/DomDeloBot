import type { CaseDto, TransitionCaseInput } from '@domdelo/contracts';
import { caseStatusLabels, getAvailableTransitions } from '@domdelo/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';

import { caseApi, getDemoUser } from '../api.js';
import { ErrorState, LoadingState } from '../components/StateViews.js';
import { formatRelativeDate, statusTone } from '../format.js';

const nextLabels: Partial<Record<CaseDto['status'], string>> = {
  registered: 'Назначить',
  assigned: 'Начать работы',
  in_progress: 'Передать на проверку',
  disputed: 'Назначить повторно',
};

function DispatcherCase({ item }: { item: CaseDto }) {
  const queryClient = useQueryClient();
  const [assignee, setAssignee] = useState(item.assignee || 'Электрик Илья');
  const [comment, setComment] = useState('Работы выполнены, освещение восстановлено.');
  const role = getDemoUser().startsWith('executor') ? 'executor' : 'dispatcher';
  const next = getAvailableTransitions(item.status, role)[0];
  const mutation = useMutation({
    mutationFn: (input: TransitionCaseInput) => caseApi.transition(item.id, input),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['cases'] }),
        queryClient.invalidateQueries({ queryKey: ['case', item.id] }),
      ]);
    },
  });

  const advance = () => {
    if (!next) return;
    mutation.mutate({
      status: next,
      expectedVersion: item.version,
      ...(next === 'assigned' ? { assignee } : {}),
      ...(next === 'awaiting_resident_verification' ? { comment } : {}),
    });
  };

  return (
    <article className="queue-card">
      <div className="queue-card__main">
        <div className="case-card__topline">
          <span className={`status status--${statusTone(item.status)}`}>{caseStatusLabels[item.status]}</span>
          <span className="muted">№ {item.number} · {formatRelativeDate(item.updatedAt)}</span>
        </div>
        <Link to={`/cases/${item.id}`}><h3>{item.title}</h3></Link>
        <p>{item.place}{item.entrance ? ` · подъезд ${item.entrance}` : ''}</p>
        <div className="queue-card__facts">
          <span>● {item.confirmationsCount} жильцов</span>
          <span>{item.responsibleOrganization}</span>
        </div>
      </div>
      {next ? (
        <div className="queue-card__action">
          {next === 'assigned' ? (
            <label>Исполнитель<input value={assignee} onChange={(event) => setAssignee(event.target.value)} /></label>
          ) : null}
          {next === 'awaiting_resident_verification' ? (
            <label>Комментарий<textarea rows={2} value={comment} onChange={(event) => setComment(event.target.value)} /></label>
          ) : null}
          <button className="button button--primary button--wide" onClick={advance} disabled={mutation.isPending}>
            {mutation.isPending ? 'Сохраняем…' : nextLabels[item.status] || caseStatusLabels[next]}
          </button>
          {mutation.isError ? <p className="form-error">{mutation.error.message}</p> : null}
        </div>
      ) : <span className="queue-card__done">Действий не требуется</span>}
    </article>
  );
}

export function DispatcherPage() {
  const query = useQuery({ queryKey: ['cases'], queryFn: caseApi.list, refetchInterval: 15_000 });
  const openCases = query.data?.filter((item) => item.status !== 'resolved') || [];
  return (
    <main className="page">
      <section className="hero hero--dispatcher">
        <div><span className="eyebrow">УК «Наш дом»</span><h1>Очередь диспетчера</h1><p>Дела, которым нужен следующий шаг.</p></div>
        <div className="dispatcher-kpi"><strong>{openCases.length}</strong><span>в работе</span></div>
      </section>
      {query.isPending ? <LoadingState label="Загружаем очередь" /> : null}
      {query.isError ? <ErrorState message={query.error.message} onRetry={() => void query.refetch()} /> : null}
      {query.data ? <div className="queue-list">{openCases.map((item) => <DispatcherCase key={item.id} item={item} />)}</div> : null}
    </main>
  );
}

