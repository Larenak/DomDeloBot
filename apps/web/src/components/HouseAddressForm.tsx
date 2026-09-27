import type { AddressSuggestionDto } from '@domdelo/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useEffect, useRef, useState } from 'react';

import { houseApi } from '../api.js';

export function HouseAddressForm({ compact = false }: { compact?: boolean }) {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [debounced, setDebounced] = useState('');
  const [selected, setSelected] = useState<AddressSuggestionDto | null>(null);

  useEffect(() => {
    const trimmed = text.trim();
    if (trimmed.length < 2 || selected) {
      setDebounced('');
      return;
    }
    const timer = window.setTimeout(() => setDebounced(trimmed), 300);
    return () => window.clearTimeout(timer);
  }, [text, selected]);

  const suggestions = useQuery({
    queryKey: ['address-suggestions', debounced],
    queryFn: ({ signal }) => houseApi.suggest(debounced, signal),
    enabled: debounced.length >= 2 && !selected,
    retry: false,
  });
  const mutation = useMutation({
    mutationFn: houseApi.add,
    onSuccess: async () => {
      setText('');
      setSelected(null);
      setDebounced('');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['house-context'] }),
        queryClient.invalidateQueries({ queryKey: ['cases'] }),
      ]);
    },
  });

  const choose = (item: AddressSuggestionDto) => {
    setText(item.isHouse ? item.value : `${item.value} `);
    setSelected(item.isHouse ? item : null);
    if (!item.isHouse) inputRef.current?.focus();
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (selected?.fiasId) mutation.mutate({ fiasId: selected.fiasId });
  };
  const showSuggestions = !selected && debounced === text.trim() && Boolean(suggestions.data?.length);

  return (
    <form className={`house-form${compact ? ' house-form--compact' : ''}`} onSubmit={submit}>
      <label htmlFor="house-address-input">Адрес дома</label>
      <input
        id="house-address-input"
        ref={inputRef}
        value={text}
        onChange={(event) => { setText(event.target.value); setSelected(null); }}
        placeholder="Начните вводить город, улицу и номер дома"
        autoComplete="off"
        maxLength={200}
        aria-controls="house-address-suggestions"
        aria-expanded={showSuggestions}
        aria-autocomplete="list"
        role="combobox"
      />
      {showSuggestions && suggestions.data ? (
        <ul id="house-address-suggestions" className="address-suggestions" role="listbox">
          {suggestions.data.map((item, index) => (
            <li key={`${item.value}-${index}`} role="option" aria-selected="false">
              <button type="button" onClick={() => choose(item)}>
                <span>{item.value}</span>
                <small>{item.isHouse ? 'Выбрать дом' : 'Продолжить ввод'}</small>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {!selected && suggestions.isFetching ? <p className="form-hint">Ищем адреса…</p> : null}
      {!selected && suggestions.data?.length === 0 && debounced === text.trim() ? (
        <p className="form-hint">Адрес не найден. Проверьте написание и номер дома.</p>
      ) : null}
      {selected ? <p className="address-selected">✓ Выбран дом: {selected.value}</p> : null}
      {suggestions.isError ? <p className="form-error">{suggestions.error.message}</p> : null}
      {mutation.isError ? <p className="form-error">{mutation.error.message}</p> : null}
      <button className="button button--primary button--wide" disabled={!selected?.fiasId || mutation.isPending}>
        {mutation.isPending ? 'Добавляем адрес…' : 'Добавить дом'}
      </button>
      <p className="form-hint">
        Выберите точный дом из списка. Адрес проверяется по государственному адресному реестру;
        свободно введённый адрес сохранить нельзя.
      </p>
    </form>
  );
}
