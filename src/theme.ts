import { createTheme } from '@mui/material/styles';

declare module '@mui/material/styles' {
  interface Palette { brandDark: Palette['primary']; ink: Palette['primary']; muted: Palette['primary']; line: Palette['primary']; soft: Palette['primary']; }
  interface PaletteOptions { brandDark?: PaletteOptions['primary']; ink?: PaletteOptions['primary']; muted?: PaletteOptions['primary']; line?: PaletteOptions['primary']; soft?: PaletteOptions['primary']; }
}

export const theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: '#0a5dc2', dark: '#084e9e', light: '#e9f2fb', contrastText: '#ffffff' },
    success: { main: '#10b981', contrastText: '#ffffff' },
    warning: { main: '#f59e0b', contrastText: '#ffffff' },
    error: { main: '#ef4444', contrastText: '#ffffff' },
    background: { default: '#f7f8fa', paper: '#ffffff' },
    text: { primary: '#1c1c1c', secondary: '#6b7280' },
    divider: '#e5e7eb',
    brandDark: { main: '#084e9e' } as any,
    ink: { main: '#1c1c1c' } as any,
    muted: { main: '#6b7280' } as any,
    line: { main: '#d1d5db' } as any,
    soft: { main: '#f7f8fa' } as any,
  },
  typography: {
    fontFamily: '"Sarabun","system-ui","-apple-system","Segoe UI",sans-serif',
    fontSize: 14,
    button: { textTransform: 'none', fontWeight: 500, letterSpacing: 0 },
    h1: { fontSize: '1.75rem', fontWeight: 700 },
    h2: { fontSize: '1.375rem', fontWeight: 600 },
    h3: { fontSize: '1.125rem', fontWeight: 600 },
    body1: { fontSize: '0.875rem' },
    body2: { fontSize: '0.8125rem' },
  },
  shape: { borderRadius: 10 },
  spacing: 4,
  components: {
    MuiButton: {
      defaultProps: { disableElevation: true, disableRipple: false, size: 'small' },
      styleOverrides: {
        root: { textTransform: 'none', borderRadius: 8, fontWeight: 500, boxShadow: 'none', '&:hover': { boxShadow: '0 1px 2px rgba(0,0,0,0.08)' } },
        sizeSmall: { padding: '6px 12px', fontSize: '0.875rem' },
      },
    },
    MuiTextField: {
      defaultProps: { size: 'small', variant: 'outlined', fullWidth: true },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: { borderRadius: 8, fontSize: '0.875rem', backgroundColor: '#fff', '& .MuiOutlinedInput-notchedOutline': { borderColor: '#e5e7eb' }, '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: '#d1d5db' } },
        input: { padding: '8px 12px' },
      },
    },
    MuiInputLabel: { styleOverrides: { root: { fontSize: '0.8125rem' } } },
    MuiSelect: { defaultProps: { size: 'small' } },
    MuiChip: {
      styleOverrides: {
        root: { borderRadius: 999, fontWeight: 500 },
        sizeSmall: { height: 22, fontSize: '0.75rem' },
      },
    },
    MuiTab: {
      styleOverrides: {
        root: { textTransform: 'none', fontSize: '0.875rem', fontWeight: 500, minHeight: 40, padding: '8px 16px' },
      },
    },
    MuiTabs: {
      styleOverrides: { root: { minHeight: 40 }, indicator: { height: 2 } },
    },
    MuiPaper: {
      defaultProps: { elevation: 0 },
      styleOverrides: { root: { border: '1px solid #eceef1' } },
    },
    MuiCard: {
      defaultProps: { elevation: 0 },
      styleOverrides: { root: { border: '1px solid #eceef1', borderRadius: 12, boxShadow: '0 1px 2px rgba(16,24,40,0.04)' } },
    },
    MuiTableCell: {
      styleOverrides: {
        root: { padding: '8px 12px', fontSize: '0.8125rem', borderBottom: '1px solid #e5e7eb' },
        head: { fontWeight: 600, backgroundColor: '#f9fafb', color: '#4b5563', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.04em' },
      },
    },
    MuiAppBar: {
      defaultProps: { color: 'default', elevation: 0 },
      styleOverrides: { root: { backgroundColor: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(8px)', borderBottom: '1px solid #eceef1', color: '#1c1c1c' } },
    },
    MuiToolbar: { styleOverrides: { root: { minHeight: 52 } } },
    MuiDivider: { styleOverrides: { root: { borderColor: '#eef0f3' } } },
    MuiCssBaseline: {
      styleOverrides: {
        body: { fontFamily: '"Sarabun","system-ui","-apple-system","Segoe UI",sans-serif', backgroundColor: '#f7f8fa', color: '#1c1c1c' },
      },
    },
  },
});
