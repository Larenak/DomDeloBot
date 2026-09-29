import type { UserRole } from '@domdelo/domain';
import type { PollDto } from '@domdelo/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { pollApi } from '../api.js';
import { ErrorState, LoadingState } from '../components/StateViews.js';
import { formatDateTime } from '../format.js';

function PollCard({ poll, canVote }: { poll: PollDto; canVote: boolean }) {
  const queryClient = useQueryClient();
  const vote = useMutation({
    mutationFn: (optionId: string) => pollApi.vote(poll.id, optionId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['polls'] }),
  });
  const closed = new Date(poll.closesAt).getTime() <= Date.now();
  return <article className="content-card poll-card">
    <div className="section-heading section-heading--inside">
      <div><h2>{poll.question}</h2><p>Предварительный опрос дома · до {formatDateTime(poll.closesAt)}</p></div>
      {poll.isDemo ? <span className="demo-chip">Демо</span> : null}
    </div>
    <div className="poll-options">
      {poll.options.map((option) => (
        <button className={'poll-option' + (poll.myOptionId === option.id ? ' poll-option--selected' : '')}
          key={option.id} type="button" onClick={() => vote.mutate(option.id)}
          disabled={!canVote || closed || Boolean(poll.myOptionId) || vote.isPending}>
          <span>{option.label}</span><strong>{option.votes}</strong>
        </button>
      ))}
    </div>
    <p className="muted">Ответов: {poll.totalVotes}. {poll.myOptionId ? 'Ваш ответ сохранён.' :
      closed ? 'Опрос завершён.' : canVote ? 'Можно выбрать один вариант.' : 'Ответ доступен подтверждённому собственнику.'}</p>
    {vote.isError ? <p className="form-error">{vote.error.message}</p> : null}
  </article>;
}

export function PollsPage({ role }: { role: UserRole }) {
  const canCreate = role === 'chair' || role === 'admin';
  const canVote = role === 'owner' || role === 'chair';
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ['polls'], queryFn: pollApi.list });
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [closesAt, setClosesAt] = useState('');
  const create = useMutation({
    mutationFn: () => pollApi.create({
      question: question.trim(),
      options: options.map((value) => value.trim()).filter(Boolean),
      closesAt: new Date(closesAt).toISOString(),
    }),
    onSuccess: async () => {
      setQuestion(''); setOptions(['', '']); setClosesAt('');
      await queryClient.invalidateQueries({ queryKey: ['polls'] });
    },
  });

  return <main className="page">
    <section className="hero"><div><span className="eyebrow">Мнение дома</span>
      <h1>Благоустройство</h1>
      <p>Председатель спрашивает мнение собственников. Результат не заменяет официальное ОСС.</p>
    </div></section>
    {canCreate ? <section className="content-card">
      <h2>Новый опрос</h2>
      <label>Вопрос<input value={question} maxLength={300} onChange={(event) => setQuestion(event.target.value)} /></label>
      {options.map((value, index) => <label key={index}>Вариант {index + 1}
        <input value={value} maxLength={120} onChange={(event) => setOptions((current) =>
          current.map((item, optionIndex) => optionIndex === index ? event.target.value : item))} />
      </label>)}
      {options.length < 6 ? <button className="button button--secondary" type="button"
        onClick={() => setOptions([...options, ''])}>Добавить вариант</button> : null}
      <label>Завершить<input type="datetime-local" value={closesAt}
        onChange={(event) => setClosesAt(event.target.value)} /></label>
      <button className="button button--primary" type="button"
        disabled={create.isPending || question.trim().length < 10 || options.filter((value) => value.trim()).length < 2 || !closesAt}
        onClick={() => create.mutate()}>Создать опрос</button>
      {create.isError ? <p className="form-error">{create.error.message}</p> : null}
    </section> : null}
    {query.isPending ? <LoadingState label="Загружаем опросы" /> : null}
    {query.isError ? <ErrorState message={query.error.message} onRetry={() => void query.refetch()} /> : null}
    {query.data?.length === 0 ? <section className="content-card"><p>Опросов пока нет.</p></section> : null}
    {query.data?.map((poll) => <PollCard key={poll.id} poll={poll} canVote={canVote} />)}
  </main>;
}
