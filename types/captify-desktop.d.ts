export {};

declare global {
  interface Window {
    captifyDesktop?: {
      isDesktop: true;
      platform: string;
      getRuntime: () => Promise<{ isDesktop: true; platform: string; workerReady: boolean; workerUrl: string; version: string }>;
      workerRequest: (pathname: string, body?: Record<string, unknown>) => Promise<{ ok: boolean; status: number; data: Record<string, unknown> }>;
      uploadChunk: (payload: { pathname: string; contentRange: string; contentType: string; bytes: ArrayBuffer }) => Promise<{ ok: boolean; status: number; data: Record<string, unknown> }>;
      getJobStatus: (jobId: string) => Promise<{ ok: boolean; status: number; data: Record<string, unknown> }>;
      getSettingsStatus: () => Promise<{ hasGroqKey: boolean; hasGeminiKey: boolean }>;
      saveSettings: (settings: { groqApiKey: string; geminiApiKey?: string; geminiApiKey2?: string }) => Promise<{ ok: boolean }>;
      openSettings: () => Promise<{ ok: boolean }>;
      getFilePath: (file: File) => string;
    };
  }
}
