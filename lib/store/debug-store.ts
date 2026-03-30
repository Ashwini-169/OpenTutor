import { create } from 'zustand';

export interface TokenUsageRecord {
  id: string;
  step: string;
  agentId?: string;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  timestamp: number;
}

interface DebugStore {
  isOpen: boolean;
  records: TokenUsageRecord[];
  
  // Actions
  toggleOpen: () => void;
  setOpen: (isOpen: boolean) => void;
  addRecord: (record: Omit<TokenUsageRecord, 'id' | 'timestamp'>) => void;
  clearRecords: () => void;
  
  // Computed
  getTotalTokens: () => { in: number; out: number };
}

export const useDebugStore = create<DebugStore>((set, get) => ({
  isOpen: false,
  records: [],
  
  toggleOpen: () => set((state) => ({ isOpen: !state.isOpen })),
  setOpen: (isOpen) => set({ isOpen }),
  
  addRecord: (record) => set((state) => ({
    records: [
      ...state.records, 
      { 
        ...record, 
        id: Math.random().toString(36).substring(2, 9),
        timestamp: Date.now() 
      }
    ]
  })),
  
  clearRecords: () => set({ records: [] }),
  
  getTotalTokens: () => {
    const { records } = get();
    return records.reduce(
      (acc, r) => ({ in: acc.in + r.tokensIn, out: acc.out + r.tokensOut }), 
      { in: 0, out: 0 }
    );
  }
}));
