import { useMutation } from '@tanstack/react-query';
import type { ApiClientError } from '@/services/api-client';
import { exportResponses } from '../api';
import type { ExportResponsesResponse } from '../types';

/**
 * Mutation hook for exporting form responses as CSV.
 * Uses a mutation instead of a query because it triggers a download action.
 * On success, creates a Blob and triggers a file download in the browser.
 */
export function useExportResponses() {
  return useMutation<ExportResponsesResponse, ApiClientError, { formId: string }>({
    mutationFn: ({ formId }) => exportResponses(formId),
    onSuccess: (data) => {
      // Trigger browser download of the CSV file
      const blob = new Blob([data.csv_content], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = data.filename || 'export.csv';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    },
  });
}
