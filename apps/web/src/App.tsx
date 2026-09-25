import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';

import { getDemoUser, getSessionActor, setDemoUser, type DemoUserKey } from './api.js';
import { CaseDetailPage } from './pages/CaseDetailPage.js';
import { CasesPage } from './pages/CasesPage.js';
import { DispatcherPage } from './pages/DispatcherPage.js';
import { NewCasePage } from './pages/NewCasePage.js';

const demoUsers: Array<{ key: DemoUserKey; label: string }> = [
  { key: 'resident-1', label: 'Житель · Анна' },
  { key: 'resident-2', label: 'Житель · Михаил' },
  { key: 'dispatcher-1', label: 'Диспетчер · Елена' },
  { key: 'executor-1', label: 'Исполнитель · Илья' },
];

function AppShell({ demoMode }: { demoMode: boolean }) {
  const location = useLocation();
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
        <Route path="/cases/:caseId" element={<CaseDetailPage />} />
        <Route path="/dispatcher" element={<DispatcherPage />} />
        <Route path="*" element={<Navigate to={isWorkRole ? '/dispatcher' : '/'} replace />} />
      </Routes>

      <nav className="bottom-nav" aria-label="Основная навигация">
        <NavLink to="/" className={({ isActive }) => isActive && location.pathname === '/' ? 'active' : ''}>
          <span>⌂</span>Дела
        </NavLink>
        <NavLink to="/new"><span>＋</span>Создать</NavLink>
        {isWorkRole ? <NavLink to="/dispatcher"><span>▦</span>Диспетчер</NavLink> : null}
      </nav>
    </div>
  );
}

export default AppShell;
