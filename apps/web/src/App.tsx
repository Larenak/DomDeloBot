import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';

import { getDemoUser, getSessionActor, houseApi, setDemoUser, type DemoUserKey } from './api.js';
import { ErrorState, LoadingState } from './components/StateViews.js';
import { CaseDetailPage } from './pages/CaseDetailPage.js';
import { CasesPage } from './pages/CasesPage.js';
import { DispatcherPage } from './pages/DispatcherPage.js';
import { HouseOnboardingPage } from './pages/HouseOnboardingPage.js';
import { HousesPage } from './pages/HousesPage.js';
import { NewCasePage } from './pages/NewCasePage.js';

const demoUsers: Array<{ key: DemoUserKey; label: string }> = [
  { key: 'resident-1', label: 'Житель · Анна' },
  { key: 'resident-2', label: 'Житель · Михаил' },
  { key: 'dispatcher-1', label: 'Диспетчер · Елена' },
  { key: 'executor-1', label: 'Исполнитель · Илья' },
];

function AppShell({ demoMode }: { demoMode: boolean }) {
  const location = useLocation();
  const queryClient = useQueryClient();
  const houses = useQuery({
    queryKey: ['house-context'],
    queryFn: houseApi.context,
    enabled: demoMode || Boolean(window.WebApp?.initData),
  });
  const selectHouse = useMutation({
    mutationFn: houseApi.select,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['house-context'] }),
        queryClient.invalidateQueries({ queryKey: ['cases'] }),
      ]);
    },
  });
  const selectedUser = getDemoUser();
  const actor = getSessionActor();
  const isWorkRole = actor
    ? ['dispatcher', 'executor', 'admin'].includes(actor.role)
    : demoMode && (selectedUser.startsWith('dispatcher') || selectedUser.startsWith('executor'));
  const switchUser = (value: DemoUserKey) => {
    setDemoUser(value);
    window.location.assign(value.startsWith('resident') ? '/' : '/dispatcher');
  };

  if (!demoMode && !window.WebApp?.initData) {
    return (
      <main className="page">
        <h1>Откройте ДомДело в MAX</h1>
        <p>Перейдите в чат с ботом и нажмите кнопку открытия мини-приложения.</p>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <NavLink className="brand" to={isWorkRole ? '/dispatcher' : '/'}>
          <span className="brand__mark">Д</span>
          <span><strong>ДомДело</strong><small>до подтверждённого результата</small></span>
        </NavLink>
        {houses.data ? (
          <label className="house-switcher">
            <span>Текущий дом</span>
            <select
              aria-label="Текущий дом"
              value={houses.data.activeHouseId || ''}
              disabled={selectHouse.isPending}
              onChange={(event) => selectHouse.mutate(event.target.value)}
            >
              {houses.data.houses.map((house) => (
                <option key={house.id} value={house.id}>{house.address}</option>
              ))}
            </select>
          </label>
        ) : null}
        {demoMode && !window.WebApp?.initData ? (
          <label className="demo-switcher">
            <span>Демо-роль</span>
            <select value={selectedUser} onChange={(event) => switchUser(event.target.value as DemoUserKey)}>
              {demoUsers.map((user) => <option key={user.key} value={user.key}>{user.label}</option>)}
            </select>
          </label>
        ) : null}
      </header>

      <Routes>
        <Route path="/" element={<CasesPage />} />
        <Route path="/new" element={<NewCasePage />} />
        <Route path="/cases/:caseId" element={<CaseDetailPage demoMode={demoMode} />} />
        <Route path="/dispatcher" element={<DispatcherPage />} />
        <Route path="/houses" element={<HousesPage />} />
        <Route path="*" element={<Navigate to={isWorkRole ? '/dispatcher' : '/'} replace />} />
      </Routes>

      <nav className="bottom-nav" aria-label="Основная навигация">
        <NavLink to="/" className={({ isActive }) => isActive && location.pathname === '/' ? 'active' : ''}>
          <span>⌂</span>Дела
        </NavLink>
        <NavLink to="/new"><span>＋</span>Создать</NavLink>
        {isWorkRole ? <NavLink to="/dispatcher"><span>▦</span>Диспетчер</NavLink> : null}
        <NavLink to="/houses"><span>⌂</span>Мои дома</NavLink>
      </nav>
    </div>
  );
}

export default function App({ demoMode }: { demoMode: boolean }) {
  const canUseApp = demoMode || Boolean(window.WebApp?.initData);
  const query = useQuery({
    queryKey: ['house-context'],
    queryFn: houseApi.context,
    retry: 1,
    enabled: canUseApp,
  });
  if (!canUseApp) return <AppShell demoMode={demoMode} />;
  if (query.isPending) {
    return <main className="address-onboarding"><LoadingState label="Проверяем адреса" /></main>;
  }
  if (query.isError) {
    return (
      <main className="address-onboarding">
        <ErrorState message={query.error.message} onRetry={() => void query.refetch()} />
      </main>
    );
  }
  if (query.data.onboardingRequired) return <HouseOnboardingPage />;
  return <AppShell demoMode={demoMode} />;
}
