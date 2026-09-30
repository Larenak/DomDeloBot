import type { UserRole } from '@domdelo/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';

import { getDemoUser, getPublicDemoRole, getSessionActor, houseApi, setDemoUser, setPublicDemoRole, type DemoUserKey, type PublicDemoRole } from './api.js';
import { ErrorState, LoadingState } from './components/StateViews.js';
import { CaseDetailPage } from './pages/CaseDetailPage.js';
import { ComplaintDraftPage } from './pages/ComplaintDraftPage.js';
import { CasesPage } from './pages/CasesPage.js';
import { DemoPage } from './pages/DemoPage.js';
import { DispatcherPage } from './pages/DispatcherPage.js';
import { HouseOnboardingPage } from './pages/HouseOnboardingPage.js';
import { HousesPage } from './pages/HousesPage.js';
import { NewCasePage } from './pages/NewCasePage.js';
import { PollsPage } from './pages/PollsPage.js';
import { ReportsPage } from './pages/ReportsPage.js';
import { ServicesPage } from './pages/ServicesPage.js';

const demoUsers: Array<{ key: DemoUserKey; label: string }> = [
  { key: 'resident-1', label: 'Житель · Анна' },
  { key: 'resident-2', label: 'Житель · Михаил' },
  { key: 'chair-1', label: 'Председатель · Марина' },
  { key: 'authority-1', label: 'Муниципалитет · представитель' },
  { key: 'dispatcher-1', label: 'Диспетчер · Елена' },
  { key: 'executor-1', label: 'Исполнитель · Илья' },
];

const publicDemoRoles: Array<{ value: PublicDemoRole; label: string }> = [
  { value: 'resident', label: 'Житель' },
  { value: 'chair', label: 'Председатель' },
  { value: 'dispatcher', label: 'Диспетчер УК' }, { value: 'executor', label: 'Исполнитель' },
  { value: 'authority', label: 'Госорган' },
];

function AppShell({ demoMode, demoHouseAvailable }: { demoMode: boolean; demoHouseAvailable: boolean }) {
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
        queryClient.invalidateQueries({ queryKey: ['polls'] }),
        queryClient.invalidateQueries({ queryKey: ['house-report'] }),
      ]);
    },
  });
  const selectedUser = getDemoUser();
  const actor = getSessionActor();
  const isDemoHouse = Boolean(houses.data?.houses.find((house) => house.id === houses.data?.activeHouseId)?.isDemo);
  const role = (isDemoHouse && !demoMode ? getPublicDemoRole() : houses.data?.activeRole ?? actor?.role ?? selectedUser.split('-')[0] ?? 'resident') as UserRole;
  const isWorkRole = ['dispatcher', 'executor', 'admin'].includes(role);
  const isAuthority = role === 'authority';
  const canReport = ['dispatcher', 'authority', 'admin'].includes(role);
  const canCreate = ['resident', 'chair', 'admin'].includes(role);
  const canWatch = ['resident', 'chair'].includes(role);
  const homePath = isAuthority ? '/reports' : isWorkRole ? '/dispatcher' : '/';
  const switchUser = (value: DemoUserKey) => {
    setDemoUser(value);
    window.location.assign(value.startsWith('authority') ? '/reports'
      : ['dispatcher-1', 'executor-1'].includes(value) ? '/dispatcher' : '/');
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
        <NavLink className="brand" to={homePath}>
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
        <nav className="top-links" aria-label="Разделы">
          {!isAuthority ? <NavLink to="/">Дела</NavLink> : null}
          <NavLink to="/polls">Опросы</NavLink>
          <NavLink to="/services">Услуги</NavLink>
          {demoHouseAvailable ? <NavLink to="/demo">Демо</NavLink> : null}
          {canReport ? <NavLink to="/reports">Сводка</NavLink> : null}
          {isWorkRole ? <NavLink to="/dispatcher">Диспетчер</NavLink> : null}
        </nav>
        {demoMode && !window.WebApp?.initData ? (
          <label className="demo-switcher">
            <span>Демо-роль</span>
            <select value={selectedUser} onChange={(event) => switchUser(event.target.value as DemoUserKey)}>
              {demoUsers.map((user) => <option key={user.key} value={user.key}>{user.label}</option>)}
            </select>
          </label>
        ) : isDemoHouse ? (
          <label className="demo-switcher">
            <span>Демо-роль</span>
            <select value={getPublicDemoRole()} onChange={(event) => {
              setPublicDemoRole(event.target.value as PublicDemoRole);
              window.location.assign('/');
            }}>
              {publicDemoRoles.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </label>
        ) : null}
      </header>

      {isDemoHouse ? <div className="demo-mode-banner" role="status">
        Деморежим: дом и данные учебные. <NavLink to="/demo">Выбрать другую роль →</NavLink>
      </div> : null}

      <Routes>
        <Route path="/" element={<CasesPage canCreate={canCreate} canWatch={canWatch} />} />
        <Route path="/new" element={canCreate ? <NewCasePage isDemoHouse={isDemoHouse} /> : <Navigate to={homePath} replace />} />
        <Route path="/cases/:caseId" element={<CaseDetailPage demoMode={demoMode} role={role} />} />
        <Route path="/cases/:caseId/complaint" element={<ComplaintDraftPage />} />
        <Route path="/dispatcher" element={<DispatcherPage role={role} />} />
        <Route path="/houses" element={<HousesPage demoHouseAvailable={demoHouseAvailable} />} />
        <Route path="/demo" element={<DemoPage demoMode={demoMode} demoHouseAvailable={demoHouseAvailable} />} />
        <Route path="/polls" element={<PollsPage role={role} />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/services" element={<ServicesPage canCreate={canCreate} canManage={isWorkRole} />} />
        <Route path="*" element={<Navigate to={homePath} replace />} />
      </Routes>

      <nav className="bottom-nav" aria-label="Основная навигация">
        {!isAuthority ? <NavLink to="/" className={({ isActive }) => isActive && location.pathname === '/' ? 'active' : ''}>
          <span>⌂</span>Дела
        </NavLink> : null}
        {canCreate ? <NavLink to="/new"><span>＋</span>Создать</NavLink> : null}
        {!isWorkRole ? <NavLink to="/polls"><span>◉</span>Опросы</NavLink> : null}
        <NavLink to="/services"><span>▧</span>Услуги</NavLink>
        {canReport ? <NavLink to="/reports"><span>▤</span>Сводка</NavLink> : null}
        {isWorkRole ? <NavLink to="/dispatcher"><span>▦</span>Очередь</NavLink> : null}
        <NavLink to="/houses"><span>⌂</span>Мои дома</NavLink>
      </nav>
    </div>
  );
}

export default function App({ demoMode, demoHouseAvailable = false }: { demoMode: boolean; demoHouseAvailable?: boolean }) {
  const canUseApp = demoMode || Boolean(window.WebApp?.initData);
  const location = useLocation();
  const query = useQuery({
    queryKey: ['house-context'],
    queryFn: houseApi.context,
    retry: 1,
    enabled: canUseApp,
  });
  if (!canUseApp) return <AppShell demoMode={demoMode} demoHouseAvailable={demoHouseAvailable} />;
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
  if (query.data.onboardingRequired) {
    if (location.pathname === '/demo' && demoHouseAvailable) {
      return <DemoPage demoMode={demoMode} demoHouseAvailable={demoHouseAvailable} />;
    }
    return <HouseOnboardingPage demoHouseAvailable={demoHouseAvailable} />;
  }
  return <AppShell demoMode={demoMode} demoHouseAvailable={demoHouseAvailable} />;
}
