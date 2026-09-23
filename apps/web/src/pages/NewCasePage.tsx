import type { CaseCategory, DuplicateSearchInput } from '@domdelo/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { caseApi } from '../api.js';
import { CaseCard } from '../components/CaseCard.js';

const categories: Array<{ value: CaseCategory; label: string }> = [
  { value: 'lighting', label: 'Освещение' },
  { value: 'entrance', label: 'Подъезд и двери' },
  { value: 'elevator', label: 'Лифт' },
  { value: 'water', label: 'Вода' },
  { value: 'heating', label: 'Отопление' },
  { value: 'yard', label: 'Двор' },
  { value: 'other', label: 'Другое' },
];

const initialForm: DuplicateSearchInput & { title: string } = {
  title: '',
  description: '',
  category: 'lighting',
  entrance: '',
  place: '',
};

export function NewCasePage() {
  const [form, setForm] = useState(initialForm);
  const [step, setStep] = useState<'form' | 'duplicates'>('form');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const duplicates = useMutation({ mutationFn: caseApi.duplicates });
  const createCase = useMutation({
    mutationFn: caseApi.create,
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: ['cases'] });
      navigate(`/cases/${created.id}?created=1`);
    },
  });

  const checkDuplicates = (event: FormEvent) => {
    event.preventDefault();
    duplicates.mutate(
      {
        description: form.description,
        category: form.category,
        ...(form.entrance ? { entrance: form.entrance } : {}),
        place: form.place,
      },
      { onSuccess: () => setStep('duplicates') },
    );
  };

  const submitNew = (duplicateCaseId?: string) => {
    createCase.mutate({
      title: form.title,
      description: form.description,
      category: form.category,
      ...(form.entrance ? { entrance: form.entrance } : {}),
      place: form.place,
      ...(duplicateCaseId ? { duplicateCaseId } : {}),
    });
  };

  return (
    <main className="page page--narrow">
      <Link className="back-link" to="/">← Все дела</Link>
      <div className="form-card">
        <span className="eyebrow">Новое дело</span>
        <h1>{step === 'form' ? 'Что случилось?' : 'Похоже, это уже обсуждают'}</h1>
        {step === 'form' ? (
          <form onSubmit={checkDuplicates} className="case-form">
            <label>
              Короткий заголовок
              <input
                required
                minLength={5}
                maxLength={120}
                value={form.title}
                onChange={(event) => setForm({ ...form, title: event.target.value })}
                placeholder="Например, не горит свет на этаже"
              />
            </label>
            <label>
              Категория
              <select
                value={form.category}
                onChange={(event) =>
                  setForm({ ...form, category: event.target.value as CaseCategory })
                }
              >
                {categories.map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </select>
            </label>
            <div className="form-row">
              <label>
                Место
                <input
                  required
                  value={form.place}
                  onChange={(event) => setForm({ ...form, place: event.target.value })}
                  placeholder="Лестничная клетка"
                />
              </label>
              <label>
                Подъезд
                <input
                  value={form.entrance || ''}
                  onChange={(event) => setForm({ ...form, entrance: event.target.value })}
                  placeholder="2"
                />
              </label>
            </div>
            <label>
              Описание
              <textarea
                required
                minLength={10}
                maxLength={2000}
                value={form.description}
                onChange={(event) => setForm({ ...form, description: event.target.value })}
                placeholder="Что именно произошло? Как давно это заметили?"
                rows={5}
              />
            </label>
            {duplicates.isError ? <p className="form-error">{duplicates.error.message}</p> : null}
            <button className="button button--primary button--wide" disabled={duplicates.isPending}>
              {duplicates.isPending ? 'Ищем похожие дела…' : 'Проверить и продолжить'}
            </button>
          </form>
        ) : (
          <div className="duplicate-step">
            {duplicates.data && duplicates.data.length > 0 ? (
              <>
                <p>Выберите совпадение — мы добавим ваше подтверждение вместо новой заявки.</p>
                <div className="case-list">
                  {duplicates.data.map((item) => <CaseCard key={item.id} item={item} />)}
                </div>
                <div className="duplicate-actions">
                  {duplicates.data.map((item) => (
                    <button
                      key={item.id}
                      className="button button--primary button--wide"
                      onClick={() => submitNew(item.id)}
                      disabled={createCase.isPending}
                    >
                      Это та же проблема — дело №{item.number}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <div className="no-duplicates">
                <span>✓</span>
                <h2>Похожих открытых дел нет</h2>
                <p>Можно зарегистрировать новую проблему.</p>
              </div>
            )}
            {createCase.isError ? <p className="form-error">{createCase.error.message}</p> : null}
            <button
              className="button button--secondary button--wide"
              onClick={() => submitNew()}
              disabled={createCase.isPending}
            >
              {createCase.isPending ? 'Регистрируем…' : 'Создать новое дело'}
            </button>
            <button className="text-button" onClick={() => setStep('form')}>← Изменить описание</button>
          </div>
        )}
      </div>
    </main>
  );
}

