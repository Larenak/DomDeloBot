import type { CaseCategory, CaseDto } from '@domdelo/contracts';

export const COMPLAINT_GUIDE_URL = 'https://cdn.dom.gosuslugi.ru/webhelp/topics/sent_messages/t_add-grazhd.html';

type DeadlinePolicy = {
  key: string;
  durationMs?: number;
  title: string;
  note: string;
  sourceUrl?: string;
};

const day = 24 * 60 * 60 * 1000;
const gosstroyAppendix = 'https://www.consultant.ru/document/cons_doc_LAW_44772/7357adcd6bafe122003836568c247fe307e4decb/';
const rule416 = 'https://www.consultant.ru/document/cons_doc_LAW_146444/1d59c63d8681f73a97b1e1c5940421f2fadce49d/';

// These are product control windows, not an automatic legal finding. In particular,
// §13 of Resolution 416 measures an emergency from the damage/report, whereas this
// app starts its visible clock only when the case enters the UK queue.
const policies: Record<CaseCategory, DeadlinePolicy> = {
  lighting: {
    key: 'lighting-7d-v1', durationMs: 7 * day, title: 'Освещение — 7 суток',
    note: 'Ориентир по приложению 2 к постановлению Госстроя № 170 для освещения общедомовых помещений. Для иных электрических неисправностей срок может быть другим.',
    sourceUrl: gosstroyAppendix,
  },
  entrance: {
    key: 'entrance-1d-v1', durationMs: day, title: 'Подъезд и двери — 1 сутки',
    note: 'Ориентир по приложению 2 к постановлению Госстроя № 170 для входных дверей подъезда. Для других неисправностей подъезда, включая домофон, это внутренний контрольный срок ДомДела.',
    sourceUrl: gosstroyAppendix,
  },
  elevator: {
    key: 'elevator-1d-v1', durationMs: day, title: 'Лифт — 1 сутки',
    note: 'Ориентир по приложению 2 к постановлению Госстроя № 170 для неисправностей лифта.',
    sourceUrl: gosstroyAppendix,
  },
  water: {
    key: 'water-3d-v1', durationMs: 3 * day, title: 'Вода — 3 суток',
    note: 'Внутренний контрольный срок ДомДела. Пункт 13 постановления № 416 устанавливает 3 суток для устранения аварийного повреждения внутридомовой системы с даты повреждения; для обычной заявки этот срок автоматически не применяется.',
    sourceUrl: rule416,
  },
  heating: {
    key: 'heating-3d-v1', durationMs: 3 * day, title: 'Отопление — 3 суток',
    note: 'Внутренний контрольный срок ДомДела. Пункт 13 постановления № 416 устанавливает 3 суток для устранения аварийного повреждения внутридомовой системы с даты повреждения; для обычной заявки этот срок автоматически не применяется.',
    sourceUrl: rule416,
  },
  yard: {
    key: 'yard-elapsed-v1', title: 'Двор — время в работе',
    note: 'Единый нормативный срок выполнения работ по этой категории не установлен. Показываем фактическое время с момента регистрации дела до сообщения исполнителя о выполнении; это не срок, установленный законом.',
  },
  other: {
    key: 'other-elapsed-v1', title: 'Другое — время в работе',
    note: 'Для разных работ в этой категории сроки могут различаться. Единый нормативный срок не установлен. Показываем фактическое время с момента регистрации дела до сообщения исполнителя о выполнении; это не срок, установленный законом.',
  },
};

const policiesByKey = new Map(Object.values(policies).map((policy) => [policy.key, policy]));

export function startCaseDeadline(category: CaseCategory, startedAt: Date): {
  policyKey: string; startedAt: Date; dueAt?: Date;
} {
  const policy = policies[category];
  return {
    policyKey: policy.key,
    startedAt,
    ...(policy.durationMs ? { dueAt: new Date(startedAt.getTime() + policy.durationMs) } : {}),
  };
}

export function caseDeadlineDto(input: {
  policyKey: string | null | undefined;
  startedAt: Date | string | null | undefined;
  dueAt: Date | string | null | undefined;
  stoppedAt?: Date | string | null | undefined;
}): CaseDto['deadline'] {
  if (!input.policyKey || !input.startedAt) return undefined;
  const policy = policiesByKey.get(input.policyKey);
  if (!policy) return undefined;
  return {
    startedAt: new Date(input.startedAt).toISOString(),
    ...(input.dueAt ? { dueAt: new Date(input.dueAt).toISOString() } : {}),
    ...(input.stoppedAt ? { stoppedAt: new Date(input.stoppedAt).toISOString() } : {}),
    title: policy.title,
    note: policy.note,
    ...(policy.sourceUrl ? { sourceUrl: policy.sourceUrl } : {}),
    ...(input.dueAt ? { complaintGuideUrl: COMPLAINT_GUIDE_URL } : {}),
  };
}
