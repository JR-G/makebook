import { create } from "zustand";

interface AppState {
  /** Whether the WebSocket connection to the API is active. */
  connected: boolean;
  /** Set the WebSocket connection status. */
  setConnected: (connected: boolean) => void;
}

/** Global application state managed by Zustand. */
export const useAppStore = create<AppState>((set) => ({
  connected: false,
  setConnected: (connected) => { set({ connected }); },
}));
