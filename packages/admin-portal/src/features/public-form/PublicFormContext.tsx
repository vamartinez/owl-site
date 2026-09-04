/**
 * Context for the public form that provides shared state to field components.
 * Primarily used to pass the form token to file upload fields without prop drilling.
 */

import { createContext, useContext } from 'react';

export interface PublicFormContextValue {
  /** The public form token from the URL */
  token: string;
  /** Register a file_key for a field (called after successful upload) */
  setFileKey: (fieldId: string, fileKey: string | null) => void;
  /** Get the file_key for a field */
  getFileKey: (fieldId: string) => string | null;
}

const PublicFormContext = createContext<PublicFormContextValue | null>(null);

export function PublicFormProvider({
  children,
  value,
}: {
  children: React.ReactNode;
  value: PublicFormContextValue;
}) {
  return (
    <PublicFormContext.Provider value={value}>
      {children}
    </PublicFormContext.Provider>
  );
}

export function usePublicFormContext(): PublicFormContextValue {
  const context = useContext(PublicFormContext);
  if (!context) {
    throw new Error('usePublicFormContext must be used within a PublicFormProvider');
  }
  return context;
}
