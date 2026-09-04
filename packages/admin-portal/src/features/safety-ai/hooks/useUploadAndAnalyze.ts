import { useState, useCallback } from 'react';
import { apiClient } from '@/services/api-client';

/**
 * Orchestrates the real Safety AI detection pipeline from the Admin Portal.
 *
 * The backend detection/scene-understanding pipeline is triggered by the
 * AI Orchestration service via three sequential, already-deployed endpoints
 * (confirmed in docs/API-ROUTES.md):
 *
 *   1. POST /inspections                 → create an inspection (needs site context)
 *   2. POST /inspections/{id}/media      → validate metadata + get a pre-signed S3 PUT URL
 *      PUT <pre-signed url>              → upload the raw image bytes directly to S3
 *   3. POST /inspections/{id}/analyze    → publishes InspectionUploaded → SQS → detection
 *
 * Once analysis is triggered the pipeline runs asynchronously; findings surface
 * in GET /safety-ai/findings when detection completes. This hook exposes the
 * step-by-step status so the UI can show progress and then poll for the result.
 */

export type UploadStage =
  | 'idle'
  | 'creating_inspection'
  | 'uploading_media'
  | 'triggering_analysis'
  | 'analyzing'
  | 'error';

export interface CreateInspectionResponse {
  inspection: {
    inspection_id: string;
    site_id: string;
    status: string;
  };
}

export interface UploadMediaResponse {
  asset_id: string;
  upload_url: string;
  s3_key: string;
  expires_in: number;
}

export interface TriggerAnalysisResponse {
  message: string;
  inspection_id: string;
  event_id: string;
  status: string;
}

export interface UploadAndAnalyzeInput {
  siteId: string;
  trade: string;
  projectPhase: string;
  file: File;
  notes?: string;
}

export interface UploadAndAnalyzeResult {
  inspectionId: string;
  eventId: string;
  requestedAt: string;
}

/**
 * Reads an image file's natural pixel dimensions in the browser.
 * The media metadata endpoint requires width/height to enforce the
 * 640×480 minimum resolution rule (backend Requirement 6.6).
 */
function readImageDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read the image. Please choose a valid JPEG or PNG file.'));
    };
    img.src = url;
  });
}

/**
 * Uploads raw image bytes to a pre-signed S3 URL. This is a direct PUT to S3,
 * NOT an API Gateway call, so it does not go through apiClient (no auth headers).
 */
async function putToS3(uploadUrl: string, file: File): Promise<void> {
  const response = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': file.type },
    body: file,
  });
  if (!response.ok) {
    throw new Error(`Failed to upload the image to storage (HTTP ${response.status}).`);
  }
}

export function useUploadAndAnalyze() {
  const [stage, setStage] = useState<UploadStage>('idle');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<UploadAndAnalyzeResult | null>(null);

  const reset = useCallback(() => {
    setStage('idle');
    setError(null);
    setResult(null);
  }, []);

  const run = useCallback(async (input: UploadAndAnalyzeInput): Promise<UploadAndAnalyzeResult | null> => {
    setError(null);
    setResult(null);
    try {
      // Step 0: read dimensions client-side (required by the media endpoint)
      const { width, height } = await readImageDimensions(input.file);

      // Step 1: create the inspection (provides the site context the pipeline needs)
      setStage('creating_inspection');
      const created = await apiClient.post<CreateInspectionResponse>('/inspections', {
        site_id: input.siteId,
        trade: input.trade,
        project_phase: input.projectPhase,
        ...(input.notes ? { notes: input.notes } : {}),
      });
      const inspectionId = created.inspection.inspection_id;

      // Step 2: request a signed upload URL, then PUT the bytes to S3
      setStage('uploading_media');
      const media = await apiClient.post<UploadMediaResponse>(
        `/inspections/${inspectionId}/media`,
        {
          file_name: input.file.name,
          content_type: input.file.type,
          file_size: input.file.size,
          width,
          height,
        }
      );
      await putToS3(media.upload_url, input.file);

      // Step 3: trigger the AI analysis pipeline
      setStage('triggering_analysis');
      const analysis = await apiClient.post<TriggerAnalysisResponse>(
        `/inspections/${inspectionId}/analyze`,
        {}
      );

      const finalResult: UploadAndAnalyzeResult = {
        inspectionId,
        eventId: analysis.event_id,
        requestedAt: new Date().toISOString(),
      };
      setResult(finalResult);
      setStage('analyzing');
      return finalResult;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'The analysis could not be started. Please try again.';
      setError(message);
      setStage('error');
      return null;
    }
  }, []);

  return { stage, error, result, run, reset };
}
