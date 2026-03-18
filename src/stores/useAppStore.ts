import { create } from 'zustand';
import { client, ConnectionState } from '../api/gateway';

interface AppState {
  token: string | null;
  connectionStatus: ConnectionState;
  agents: Record<string, any>;
  setToken: (token: string) => void;
  connect: () => Promise<void>;
  disconnect: () => void;
  fetchAgents: () => Promise<void>;
  deleteAgent: (id: string) => Promise<void>;
}

export const useAppStore = create<AppState>((set, get) => ({
  token: sessionStorage.getItem('gateway_token'),
  connectionStatus: 'disconnected',
  agents: {},
  
  setToken: (token: string) => {
    sessionStorage.setItem('gateway_token', token);
    set({ token });
  },
  
  connect: async () => {
    const { token } = get();
    if (!token) return;
    
    set({ connectionStatus: 'connecting' });
    
    // Subscribe to connection state changes
    client.onConnectionState((state) => {
      set({ connectionStatus: state });
      if (state === 'connected') {
        get().fetchAgents();
      }
    });
    
    try {
      await client.connect(token);
    } catch (err) {
      console.error('Connection failed:', err);
      throw err;
    }
  },
  
  disconnect: () => {
    client.disconnect();
    set({ connectionStatus: 'disconnected' });
  },
  
  fetchAgents: async () => {
    try {
      const res = await client.configGet();
      const list = res?.resolved?.agents?.list ?? [];

      const agentsMap: Record<string, any> = {};
      if (Array.isArray(list)) {
        list.forEach((agent: any) => {
          if (agent.id) {
            agentsMap[agent.id] = agent;
          }
        });
      }
      set({ agents: agentsMap });
    } catch (err) {
      console.error('Failed to fetch agents:', err);
    }
  },
  
  deleteAgent: async (id: string) => {
    try {
      // mergeObjectArraysById can only add/update, not remove array items.
      // Work around: clear the list first (null deletes the key), then set the filtered list.
      const cfg = await client.configGet();
      const baseHash: string = cfg?.hash;
      if (!baseHash) throw new Error('Could not get config hash');
      const currentList: any[] = cfg?.config?.agents?.list ?? [];
      const filteredList = currentList.filter((a: any) => a.id !== id);
      // Two-step: clear list (null removes the key), then set filtered list.
      // Step 2 does direct assignment (not mergeObjectArraysById) because list key is absent.
      await client.configPatchRaw({ agents: { list: null } }, baseHash);
      const cfg2 = await client.configGet();
      const baseHash2: string = cfg2?.hash;
      if (!baseHash2) throw new Error('Could not get config hash after clear');
      await client.configPatchRaw({ agents: { list: filteredList } }, baseHash2);
      await get().fetchAgents();
    } catch (err) {
      console.error('Failed to delete agent:', err);
      throw err;
    }
  }
}));
