import type { CaseCategory, CreateCaseInput } from '@domdelo/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { caseApi } from '../api.js';

const categories: Array<{ value: CaseCategory; label: string }> = [
  { value: 'lighting', label: 'Освещение' },
  { value: 'entrance', label: 'Подъезд и двери' },
  { value: 'elevator', label: 'Лифт' },
  { value: 'water', label: 'Вода' },
  { value: 'heating', label: 'Отопление' },
  { value: 'yard', label: 'Двор' },
  { value: 'other', label: 'Другое' },
];

const initialForm: CreateCaseInput = {
  title: '',
  description: '',
  category: 'lighting',
  entrance: '',
  place: '',
};

export function NewCasePage({ isDemoHouse = false }: { isDemoHouse?: boolean }) {
  const [form, setForm] = useState(initialForm);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const createCase = useMutation({
    mutationFn: caseApi.create,
    onSuccess: (created) => {
      queryClient.setQueryData(['case', created.id], created);
      void queryClient.invalidateQueries({ queryKey: ['cases'] });
      navigate(`/cases/${created.id}?created=1`);
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    },
  });

  const submitNew = (event: FormEvent) => {
    event.preventDefault();
    if (createCase.isPending) return;
    createCase.mutate({
      title: form.title,
      description: form.description,
      category: form.category,
      ...(form.entrance ? { entrance: form.entrance } : {}),
      place: form.place,
    });
  };

  return (
    <main className="page page--narrow">
      <Link className="back-link" to="/">← Все дела</Link>
      <div className="form-card">
        <span className="eyebrow">Новое дело</span>
        <h1>Что случилось?</h1>
        {isDemoHouse ? <p className="demo-warning">Это открытый вымышленный дом. Дела видны другим участникам демонстрации. Не указывайте реальные имена, адреса квартир и контакты.</p> : null}
        <form onSubmit={submitNew} className="case-form">
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
          {createCase.isError ? <p className="form-error" role="alert">{createCase.error.message}</p> : null}
          <button type="submit" className="button button--primary button--wide" disabled={createCase.isPending}>
            {createCase.isPending ? 'Размещаем дело…' : 'Проверить и продолжить'}
          </button>
        </form>
      </div>
    </main>
  );
}
