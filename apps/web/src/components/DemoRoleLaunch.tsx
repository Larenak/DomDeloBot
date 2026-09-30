import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useEffect, useRef } from 'react';
import { roleHomePath } from '../navigation.js';

import { houseApi, setDemoUser, setPublicDemoRole, type DemoUserKey, type PublicDemoRole } from '../api.js';

type DemoScenario = { role: PublicDemoRole; title: string; user: DemoUserKey };

const scenarios: DemoScenario[] = [
  { role: 'resident', title: 'Житель', user: 'resident-1' },
  { role: 'chair', title: 'Председатель', user: 'chair-1' },
  { role: 'dispatcher', title: 'Диспетчер УК', user: 'dispatcher-1' },
  { role: 'executor', title: 'Исполнитель', user: 'executor-1' },
  { role: 'authority', title: 'Госорганы', user: 'authority-1' },
];

export function DemoRoleLaunch({ demoMode, demoHouseAvailable }: { demoMode: boolean; demoHouseAvailable: boolean }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const requestedRole = new URLSearchParams(window.location.search).get('role');
  const requestedScenario = scenarios.find((item) => item.role === requestedRole);
  const autoStarted = useRef(false);
  const start = useMutation({
    mutationFn: async (scenario: DemoScenario) => {
      if (demoMode && !window.WebApp?.initData) setDemoUser(scenario.user);
      const context = await houseApi.joinDemo();
      if (!demoMode || window.WebApp?.initData) setPublicDemoRole(scenario.role);
      return { context, destination: roleHomePath(scenario.role) };
    },
    onSuccess: ({ context, destination }) => {
      queryClient.setQueryData(['house-context'], context);
      void queryClient.invalidateQueries({ queryKey: ['cases'] });
      void queryClient.invalidateQueries({ queryKey: ['polls'] });
      void queryClient.invalidateQueries({ queryKey: ['house-report'] });
      navigate(destination, { replace: true });
    },
  });

  const { mutate } = start;
  useEffect(() => {
    if (!requestedScenario || !demoHouseAvailable || autoStarted.current) return;
    autoStarted.current = true;
    mutate(requestedScenario);
  }, [requestedScenario, demoHouseAvailable, mutate]);

  if (!requestedScenario) {
    return <p className="muted-box">Выберите роль в чате с ботом и откройте мини-приложение оттуда.</p>;
  }
  return (
    <main className="page page--narrow">
      <h1>Открываем: {requestedScenario.title}</h1>
      {!demoHouseAvailable ? <p className="form-error">Демонстрационный дом ещё не настроен на сервере.</p>
        : start.isError ? (
          <>
            <p className="form-error" role="alert">{start.error.message}</p>
            <button className="button" onClick={() => start.mutate(requestedScenario)}>Повторить</button>
          </>
        ) : <p role="status">Подключаем дом…</p>}
    </main>
  );
}
