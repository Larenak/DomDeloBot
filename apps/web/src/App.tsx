import type { UserRole } from '@domdelo/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';

import { getDemoUser, getPublicDemoRole, getSessionActor, houseApi } from './api.js';
import { roleHomePath } from './navigation.js';
import { ErrorState, LoadingState } from './components/StateViews.js';
import { CaseDetailPage } from './pages/CaseDetailPage.js';
import { ComplaintDraftPage } from './pages/ComplaintDraftPage.js';
import { CasesPage } from './pages/CasesPage.js';
import { DemoRoleLaunch } from './components/DemoRoleLaunch.js';
import { DispatcherPage } from './pages/DispatcherPage.js';
import { HouseOnboardingPage } from './pages/HouseOnboardingPage.js';
import { HousesPage } from './pages/HousesPage.js';
import { NewCasePage } from './pages/NewCasePage.js';
import { PollsPage } from './pages/PollsPage.js';
import { ReportsPage } from './pages/ReportsPage.js';
import { ServicesPage } from './pages/ServicesPage.js';

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
  const homePath = roleHomePath(role);

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
          <NavLink to={homePath}>{isAuthority ? 'Сводка' : isWorkRole ? 'Очередь' : 'Дела'}</NavLink>
          {isWorkRole ? <NavLink to="/">Дела</NavLink> : null}
          <NavLink to="/polls">Опросы</NavLink>
          <NavLink to="/services">О доме</NavLink>
          {canReport && !isAuthority ? <NavLink to="/reports">Сводка</NavLink> : null}

        </nav>
      </header>

      <Routes>
        <Route path="/" element={<CasesPage canCreate={canCreate} canWatch={canWatch} />} />
        <Route path="/new" element={canCreate ? <NewCasePage isDemoHouse={isDemoHouse} /> : <Navigate to={homePath} replace />} />
        <Route path="/cases/:caseId" element={<CaseDetailPage demoMode={demoMode} role={role} />} />
        <Route path="/cases/:caseId/complaint" element={<ComplaintDraftPage />} />
        <Route path="/dispatcher" element={<DispatcherPage role={role} />} />
        <Route path="/houses" element={<HousesPage />} />
        <Route path="/demo" element={<DemoRoleLaunch demoMode={demoMode} demoHouseAvailable={demoHouseAvailable} />} />
        <Route path="/polls" element={<PollsPage role={role} />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/services" element={<ServicesPage canCreate={canCreate} canManage={isWorkRole} />} />
        <Route path="*" element={<Navigate to={homePath} replace />} />
      </Routes>

      <nav className="bottom-nav" aria-label="Основная навигация">
        <NavLink to={homePath} className={({ isActive }) => isActive && location.pathname === homePath ? 'active' : ''}>
          <span>{isAuthority ? '▤' : isWorkRole ? '▦' : '⌂'}</span>{isAuthority ? 'Сводка' : isWorkRole ? 'Очередь' : 'Дела'}
        </NavLink>
        {isWorkRole ? <NavLink to="/"><span>⌂</span>Дела</NavLink> : null}
        {canCreate ? <NavLink to="/new"><span>＋</span>Создать</NavLink> : null}
        {!isWorkRole ? <NavLink to="/polls"><span>◉</span>Опросы</NavLink> : null}
        <NavLink to="/services"><span>▧</span>О доме</NavLink>
        {canReport && !isAuthority ? <NavLink to="/reports"><span>▤</span>Сводка</NavLink> : null}

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
      return <DemoRoleLaunch demoMode={demoMode} demoHouseAvailable={demoHouseAvailable} />;
    }
    return <HouseOnboardingPage />;
  }
  return <AppShell demoMode={demoMode} demoHouseAvailable={demoHouseAvailable} />;
}
