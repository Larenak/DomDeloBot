import { MaxUI } from '@maxhub/max-ui';
import '@maxhub/max-ui/dist/styles.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import App from './App.js';
import { getPublicConfig, initializeMaxSession } from './api.js';
import { pathFromMaxStartParam } from './max-launch.js';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 10_000, refetchOnWindowFocus: true },
    mutations: { retry: 0 },
  },
});

async function bootstrap() {
  const publicConfig = await getPublicConfig().catch(() => ({ demoMode: false }));
  window.WebApp?.ready?.();
  window.WebApp?.expand?.();
  const launchPath = pathFromMaxStartParam(window.WebApp?.initDataUnsafe?.start_param);
  if (launchPath && window.location.pathname === '/') {
    window.history.replaceState(null, '', launchPath);
  }
  await initializeMaxSession().catch(() => undefined);
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <MaxUI>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <App demoMode={publicConfig.demoMode} />
          </BrowserRouter>
        </QueryClientProvider>
      </MaxUI>
    </StrictMode>,
  );
}

void bootstrap();
