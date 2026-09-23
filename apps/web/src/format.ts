import type { CaseStatus } from '@domdelo/domain';

export function formatRelativeDate(value: string, now = new Date()): string {
  const date = new Date(value);
  const diffMinutes = Math.max(0, Math.round((now.getTime() - date.getTime()) / 60_000));
  if (diffMinutes < 1) return 'только что';
  if (diffMinutes < 60) return `${diffMinutes} мин назад`;
  const hours = Math.floor(diffMinutes / 60);
  if (hours < 24) return `${hours} ч назад`;
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' }).format(date);
}

export function statusTone(status: CaseStatus): string {
  if (status === 'resolved') return 'success';
  if (status === 'disputed') return 'danger';
  if (status === 'awaiting_resident_verification') return 'attention';
  if (status === 'in_progress' || status === 'assigned') return 'progress';
  return 'neutral';
}

