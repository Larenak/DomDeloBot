import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';

import { registrationApi } from '../api.js';

export function InviteRegistrationForm() {
  const queryClient = useQueryClient();
  const [code, setCode] = useState('');
  const identity = useQuery({ queryKey: ['registration-identity'], queryFn: registrationApi.identity });
  const redeem = useMutation({
    mutationFn: registrationApi.redeemHouseInvite,
    onSuccess: async ({ actor }) => {
      setCode('');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['house-context'] }),
        queryClient.invalidateQueries({ queryKey: ['cases'] }),
      ]);
      window.location.assign(actor.role === 'resident' ? '/' : '/dispatcher');
    },
  });

  if (!window.WebApp?.initData) return null;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    redeem.mutate(code.trim());
  };

  return <section className="form-card invite-registration">
    <h2>Личное приглашение</h2>
    <p>Для доступа жильца, диспетчера или исполнителя к рабочему дому нужен личный код. Администратор выдаёт его после проверки проживания или полномочий. Роль и дом уже привязаны к коду.</p>
    {identity.data?.actor.maxUserId ? <p className="form-hint">Ваш MAX ID для администратора: <strong>{identity.data.actor.maxUserId}</strong></p> : null}
    {identity.isError ? <p className="form-error">{identity.error.message}</p> : null}
    <form onSubmit={submit}>
      <label htmlFor="house-invite-code">Личный код приглашения</label>
      <input
        id="house-invite-code"
        value={code}
        onChange={(event) => setCode(event.target.value)}
        autoComplete="off"
        spellCheck={false}
        placeholder="Вставьте полученный код"
        maxLength={43}
      />
      <button className="button button--primary button--wide" disabled={redeem.isPending || code.trim().length !== 43}>
        {redeem.isPending ? 'Проверяем приглашение…' : 'Зарегистрироваться'}
      </button>
    </form>
    {redeem.isError ? <p className="form-error" role="alert">{redeem.error.message}</p> : null}
  </section>;
}

