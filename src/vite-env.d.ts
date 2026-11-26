/// <reference types="vite/client" />

interface VeritasNativeBridge {
  platform: string;
  version?: string;
  httpPost(req: {
    url: string;
    headers: Record<string, string>;
    body: string;
    timeoutMs: number;
  }): Promise<{ status: number; text: string; error?: string }>;
}

interface Window {
  veritasNative?: VeritasNativeBridge;
  veritasAndroid?: {
    post(id: string, url: string, headerLines: string, body: string, timeoutMs: number): void;
  };
  Capacitor?: { Plugins?: Record<string, any> };
}

/** 构建时由 vite.config.ts 注入的版本号 */
declare const __APP_VERSION__: string;
