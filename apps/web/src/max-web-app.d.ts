interface MaxWebApp {
  initData: string;
  initDataUnsafe?: { start_param?: string };
  platform?: string;
  version?: string;
  deviceName?: string;
  ready?: () => void;
  expand?: () => void;
  openMaxLink?: (url: string) => void;
}

interface Window {
  WebApp?: MaxWebApp;
}
