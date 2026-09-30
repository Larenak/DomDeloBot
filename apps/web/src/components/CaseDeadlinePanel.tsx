import type { CaseDto } from '@domdelo/contracts';
import { useEffect, useState } from 'react';

import { formatDateTime } from '../format.js';

export function formatElapsedTime(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return [days ? `${days} д` : '', days || hours ? `${hours} ч` : '', `${minutes} мин`, `${remainder} с`]
    .filter(Boolean).join(' ');
}

export function CaseDeadlinePanel({ deadline }: { deadline: NonNullable<CaseDto['deadline']> }) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (deadline.stoppedAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [deadline.stoppedAt]);

  const startedAt = new Date(deadline.startedAt).getTime();
  const stoppedAt = deadline.stoppedAt ? new Date(deadline.stoppedAt).getTime() : undefined;
  const effectiveNow = stoppedAt ?? now;
  const dueAt = deadline.dueAt ? new Date(deadline.dueAt).getTime() : undefined;
  const overdue = dueAt !== undefined && effectiveNow > dueAt;

  return (
    <section className={`content-card case-deadline${overdue ? ' case-deadline--overdue' : ''}`}>
      <h2>{deadline.title}</h2>
      {dueAt === undefined ? (
        <>
          <p className="case-deadline__time" role="timer">{formatElapsedTime(effectiveNow - startedAt)}</p>
          <p>{deadline.stoppedAt ? 'Исполнитель сообщил о выполнении — отсчёт остановлен.' : 'Время в работе с момента регистрации дела.'}</p>
        </>
      ) : (
        <>
          <p className="case-deadline__time" role="timer">
            {overdue
              ? `${deadline.stoppedAt ? 'Контрольный срок был превышен на' : 'Контрольный срок превышен на'} ${formatElapsedTime(effectiveNow - dueAt)}`
              : deadline.stoppedAt
                ? 'Работа завершена до контрольного срока'
                : `Осталось ${formatElapsedTime(dueAt - now)}`}
          </p>
          <p>Контрольная дата: {formatDateTime(deadline.dueAt!)}</p>
        </>
      )}
      <p className="case-deadline__note">{deadline.note}</p>
      {deadline.sourceUrl ? <a href={deadline.sourceUrl} target="_blank" rel="noopener noreferrer">Основание для ориентира ↗</a> : null}
      {overdue && deadline.complaintGuideUrl ? (
        <p className="case-deadline__complaint">
          {deadline.stoppedAt ? 'Работа отмечена выполненной после контрольной даты.' : 'Контрольная дата прошла, а дело ещё не выполнено.'}{' '}
          При необходимости вы можете самостоятельно направить обращение в УК или жилищную инспекцию через ГИС ЖКХ.{' '}
          <a href={deadline.complaintGuideUrl} target="_blank" rel="noopener noreferrer">Инструкция по подаче обращения ↗</a>
        </p>
      ) : null}
    </section>
  );
}
