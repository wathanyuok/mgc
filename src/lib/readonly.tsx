import { createContext, useContext } from 'react';

// When true, shared form inputs (Input / Select / Textarea / NumInput) render
// disabled — used for the read-only "View" mode (?view=1). Provided at the
// layout level so no per-field wiring is needed.
export const ReadOnlyContext = createContext(false);
export const useReadOnly = () => useContext(ReadOnlyContext);
