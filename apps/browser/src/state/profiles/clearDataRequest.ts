import { create } from "zustand";

export const useClearDataRequest = create<{ windowId: string | null; request(windowId: string | null): void }>((set) => ({
  windowId: null,
  request: (windowId) => set({ windowId }),
}));
