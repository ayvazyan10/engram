import { create } from 'zustand';

export interface UITemplate {
  id: string;
  name: string;
  /** Header */
  headerBg: string;
  headerBorder: string;
  /** Sidebar + Inspector */
  panelBg: string;
  panelBorder: string;
  /** Root background */
  rootBg: string;
  /** Text colors */
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  /** Accent */
  accent: string;
  accentGlow: string;
  /** Input / card backgrounds */
  inputBg: string;
  cardBg: string;
  /** Status bar */
  statusBg: string;
}

export const TEMPLATES: UITemplate[] = [
  {
    id: 'neural',
    name: 'Neural',
    headerBg: '#040d1e',
    headerBorder: '#0f2040',
    panelBg: '#060e1e',
    panelBorder: '#0f2040',
    rootBg: '#020817',
    textPrimary: '#e2e8f0',
    textSecondary: '#94a3b8',
    textMuted: '#334155',
    accent: '#6366f1',
    accentGlow: 'rgba(99,102,241,0.35)',
    inputBg: '#07101f',
    cardBg: '#0a1628',
    statusBg: '#030810',
  },
  {
    id: 'vercel',
    name: 'Vercel',
    headerBg: '#000000',
    headerBorder: '#1a1a1a',
    panelBg: '#0a0a0a',
    panelBorder: '#1a1a1a',
    rootBg: '#000000',
    textPrimary: '#ededed',
    textSecondary: '#888888',
    textMuted: '#444444',
    accent: '#ffffff',
    accentGlow: 'rgba(255,255,255,0.15)',
    inputBg: '#111111',
    cardBg: '#171717',
    statusBg: '#000000',
  },
  {
    id: 'midnight',
    name: 'Midnight',
    headerBg: '#0c0014',
    headerBorder: '#1a0a30',
    panelBg: '#0e0018',
    panelBorder: '#1a0a30',
    rootBg: '#080010',
    textPrimary: '#e0d4f5',
    textSecondary: '#9b8ab8',
    textMuted: '#3d2d5c',
    accent: '#a855f7',
    accentGlow: 'rgba(168,85,247,0.35)',
    inputBg: '#110020',
    cardBg: '#150028',
    statusBg: '#060010',
  },
];

interface TemplateState {
  activeTemplate: UITemplate;
  setTemplate: (id: string) => void;
}

export const useTemplateStore = create<TemplateState>((set) => ({
  activeTemplate: TEMPLATES[0]!,
  setTemplate: (id) => {
    const t = TEMPLATES.find((t) => t.id === id);
    if (t) set({ activeTemplate: t });
  },
}));
