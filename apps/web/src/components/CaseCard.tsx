import type { CaseDto } from '@domdelo/contracts';
import { caseStatusLabels } from '@domdelo/domain';
import { Link } from 'react-router-dom';

import { formatRelativeDate, statusTone } from '../format.js';

const categoryIcons: Record<CaseDto['category'], string> = {
  lighting: '☀',
  entrance: '↗',
  elevator: '↕',
  water: '◉',
  heating: '≈',
  yard: '⌂',
  other: '•',
};

export function CaseCard({ item }: { item: CaseDto }) {
  return (
    <Link className="case-card" to={`/cases/${item.id}`}>
      <div className={`case-card__icon case-card__icon--${item.category}`} aria-hidden="true">
        {categoryIcons[item.category]}
      </div>
      <div className="case-card__body">
        <div className="case-card__topline">
          <span className={`status status--${statusTone(item.status)}`}>
            {caseStatusLabels[item.status]}
          </span>
          <span className="muted">№ {item.number}</span>
        </div>
        <h3>{item.title}</h3>
        <p className="case-card__place">
          {item.place}
          {item.entrance ? ` · подъезд ${item.entrance}` : ''}
        </p>
        <div className="case-card__meta">
          <span>● {item.confirmationsCount} подтвердили</span>
          <span>{formatRelativeDate(item.updatedAt)}</span>
        </div>
      </div>
      <span className="case-card__arrow" aria-hidden="true">›</span>
    </Link>
  );
}

