interface MaxWebApp {
  initData: string;
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

