import { useMutation } from '@tanstack/react-query';

import { getPublicDemoRole, houseApi, setDemoUser, setPublicDemoRole, type DemoUserKey, type PublicDemoRole } from '../api.js';

type DemoScenario = { role: PublicDemoRole; title: string; description: string; destination: string; user: DemoUserKey };

const scenarios: DemoScenario[] = [
  { role: 'resident', title: 'Житель', description: 'Создать дело, подтвердить проблему соседа и следить за результатом.', destination: '/', user: 'resident-1' },
  { role: 'chair', title: 'Председатель', description: 'Создать опрос для дома и посмотреть ответы жителей.', destination: '/polls', user: 'chair-1' },
  { role: 'dispatcher', title: 'Диспетчер УК', description: 'Принять дело, назначить исполнителя и вести статусы.', destination: '/dispatcher', user: 'dispatcher-1' },
  { role: 'executor', title: 'Исполнитель', description: 'Открыть очередь работ и показать ход выполнения.', destination: '/dispatcher', user: 'executor-1' },
  { role: 'authority', title: 'Представитель муниципалитета', description: 'Посмотреть сводку по обращениям без доступа к личным делам.', destination: '/reports', user: 'authority-1' },
];

export function DemoPage({ demoMode, demoHouseAvailable }: { demoMode: boolean; demoHouseAvailable: boolean }) {
  const requestedRole = new URLSearchParams(window.location.search).get('role');
  const selectedRole = scenarios.find((item) => item.role === requestedRole)?.role || getPublicDemoRole();
  const start = useMutation({
    mutationFn: async (scenario: DemoScenario) => {
      if (demoMode && !window.WebApp?.initData) setDemoUser(scenario.user);
      await houseApi.joinDemo();
      if (!demoMode || window.WebApp?.initData) setPublicDemoRole(scenario.role);
      return scenario.destination;
    },
    onSuccess: (destination) => window.location.assign(destination),
  });

  return (
    <main className="page page--narrow">
      <section className="hero hero--demo">
        <div>
          <span className="eyebrow">Режим для показа комиссии</span>
          <h1>Выберите роль</h1>
          <p>Все сценарии проходят в отдельном вымышленном доме. Роль действует только там и не даёт полномочий в настоящих домах.</p>
        </div>
      </section>
      <p className="demo-warning">Дела и опросы демодома видны другим участникам показа. Не вводите настоящие имена, контакты, номера квартир и личные документы.</p>
      {!demoHouseAvailable ? <p className="form-error">Демонстрационный дом ещё не настроен на сервере.</p> : null}
      <section className="demo-role-grid" aria-label="Демонстрационные роли">
        {scenarios.map((scenario) => (
          <article className={`demo-role-card${scenario.role === selectedRole ? ' demo-role-card--selected' : ''}`} key={scenario.role}>
            <div>
              <h2>{scenario.title}</h2>
              <p>{scenario.description}</p>
            </div>
            <button className="button button--secondary" type="button" disabled={!demoHouseAvailable || start.isPending}
              onClick={() => start.mutate(scenario)}>
              {start.isPending && start.variables?.role === scenario.role ? 'Открываем…' : 'Показать сценарий'}
            </button>
          </article>
        ))}
      </section>
      {start.isError ? <p className="form-error" role="alert">{start.error.message}</p> : null}
      <section className="content-card">
        <h2>Маршрут показа</h2>
        <ol className="demo-steps">
          <li>Житель создаёт дело, подтверждает чужое и добавляет его в отслеживаемые. В карточке можно развернуть учебное изображение.</li>
          <li>Диспетчер УК видит очередь и меняет статус; исполнитель показывает ход работы. Житель проверяет результат.</li>
          <li>Председатель создаёт опрос, житель голосует, представитель муниципалитета смотрит сводку.</li>
          <li>В разделе «О доме» показаны отдельно помеченные учебные сведения об УК и капремонте.</li>
        </ol>
      </section>
      <p className="muted-box">Вернуться к настоящему дому можно в разделе «Мои дома» или через переключатель адреса сверху.</p>
    </main>
  );
}
