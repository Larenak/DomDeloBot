import type { AddHouseInput } from '@domdelo/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';

import { houseApi } from '../api.js';

export function HouseAddressForm({ compact = false }: { compact?: boolean }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<AddHouseInput>({ city: '', street: '', building: '' });
  const mutation = useMutation({
    mutationFn: houseApi.add,
    onSuccess: async () => {
      setForm({ city: '', street: '', building: '' });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['house-context'] }),
        queryClient.invalidateQueries({ queryKey: ['cases'] }),
      ]);
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    mutation.mutate(form);
  };

  return (
    <form className={`house-form${compact ? ' house-form--compact' : ''}`} onSubmit={submit}>
      <label>
        Город
        <input
          required
          minLength={2}
          maxLength={100}
          value={form.city}
          onChange={(event) => setForm({ ...form, city: event.target.value })}
          placeholder="Например, Казань"
          autoComplete="address-level2"
        />
      </label>
      <label>
        Улица
        <input
          required
          minLength={2}
          maxLength={120}
          value={form.street}
          onChange={(event) => setForm({ ...form, street: event.target.value })}
          placeholder="Спортивная"
          autoComplete="street-address"
        />
      </label>
      <label>
        Дом
        <input
          required
          maxLength={30}
          value={form.building}
          onChange={(event) => setForm({ ...form, building: event.target.value })}
          placeholder="12"
        />
      </label>
      {mutation.isError ? <p className="form-error">{mutation.error.message}</p> : null}
      <button className="button button--primary button--wide" disabled={mutation.isPending}>
        {mutation.isPending ? 'Добавляем адрес…' : 'Добавить дом'}
      </button>
      <p className="form-hint">
        Пока адреса добавляются свободно. Позже можно включить приглашения или подтверждение жильца.
      </p>
    </form>
  );
}
