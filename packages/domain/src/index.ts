export const caseStatuses = [
  'draft',
  'registered',
  'assigned',
  'in_progress',
  'awaiting_resident_verification',
  'resolved',
  'disputed',
] as const;

export type CaseStatus = (typeof caseStatuses)[number];

export const userRoles = ['resident', 'dispatcher', 'executor', 'admin'] as const;
export type UserRole = (typeof userRoles)[number];

export type WorkflowActor = {
  id: string;
  role: UserRole;
  houseId: string;
};

export class WorkflowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkflowError';
  }
}

const allowedTransitions: Record<CaseStatus, readonly CaseStatus[]> = {
  draft: ['registered'],
  registered: ['assigned'],
  assigned: ['in_progress'],
  in_progress: ['awaiting_resident_verification'],
  awaiting_resident_verification: ['resolved', 'disputed'],
  disputed: ['assigned'],
  resolved: [],
};

const roleTransitions: Record<UserRole, readonly CaseStatus[]> = {
  resident: ['resolved', 'disputed'],
  dispatcher: ['registered', 'assigned', 'in_progress', 'awaiting_resident_verification'],
  executor: ['in_progress', 'awaiting_resident_verification'],
  admin: caseStatuses,
};

export function assertTransitionAllowed(
  from: CaseStatus,
  to: CaseStatus,
  actorRole: UserRole,
): void {
  if (!allowedTransitions[from].includes(to)) {
    throw new WorkflowError(`Переход ${from} -> ${to} недопустим`);
  }

  if (!roleTransitions[actorRole].includes(to)) {
    throw new WorkflowError(`Роль ${actorRole} не может установить статус ${to}`);
  }
}

export function getAvailableTransitions(from: CaseStatus, actorRole: UserRole): CaseStatus[] {
  return allowedTransitions[from].filter((status) => roleTransitions[actorRole].includes(status));
}

export const openCaseStatuses: readonly CaseStatus[] = caseStatuses.filter(
  (status) => status !== 'resolved',
);

export const caseStatusLabels: Record<CaseStatus, string> = {
  draft: 'Черновик',
  registered: 'Зарегистрировано',
  assigned: 'Назначен исполнитель',
  in_progress: 'Работы начаты',
  awaiting_resident_verification: 'Ожидает проверки жильцами',
  resolved: 'Результат подтверждён',
  disputed: 'Результат оспорен',
};

