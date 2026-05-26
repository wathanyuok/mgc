import { type ReactNode } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, IconButton, Box,
} from '@mui/material';
import { X } from 'lucide-react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

const maxWidthMap: Record<NonNullable<ModalProps['size']>, 'sm' | 'md' | 'lg' | 'xl'> = {
  sm: 'sm', md: 'md', lg: 'lg', xl: 'xl',
};

export function Modal({ open, onClose, title, children, footer, size = 'md' }: ModalProps) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth={maxWidthMap[size]} fullWidth>
      {title && (
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', py: 1.5, px: 2.5, fontSize: '1rem', fontWeight: 600, borderBottom: 1, borderColor: 'divider' }}>
          <span>{title}</span>
          <IconButton onClick={onClose} size="small" aria-label="Close" sx={{ color: 'text.secondary' }}>
            <X size={16} />
          </IconButton>
        </DialogTitle>
      )}
      <DialogContent sx={{ p: 2.5, maxHeight: '70vh' }}>
        <Box sx={{ pt: 1 }}>{children}</Box>
      </DialogContent>
      {footer && (
        <DialogActions sx={{ px: 2.5, py: 1.5, borderTop: 1, borderColor: 'divider', gap: 1 }}>
          {footer}
        </DialogActions>
      )}
    </Dialog>
  );
}
