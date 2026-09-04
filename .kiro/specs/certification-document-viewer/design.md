# Technical Design: Certification Document Viewer

## Overview

This feature adds inline document preview capabilities to the admin portal's certification management table. Administrators can view uploaded certification documents (PDFs and images) directly within a modal overlay, eliminating the need to download files or navigate away from the certifications list.

The implementation spans two layers:
1. **Backend**: A new GET endpoint in the Identity Service that generates a time-limited S3 signed URL for reading a stored document.
2. **Frontend**: A "View" button in the CertificationList actions column that opens a Document Viewer Modal rendering the document inline via the signed URL.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Admin Portal (React)                                           │
│                                                                 │
│  CertificationList                                              │
│    ├── View Button (visible when document_key is truthy)        │
│    └── DocumentViewerModal                                      │
│          ├── useDocumentUrl hook (fetches signed URL)            │
│          ├── Loading state (spinner)                             │
│          ├── Error state (message + retry)                      │
│          └── Document renderer                                  │
│                ├── <iframe> for application/pdf                  │
│                └── <img> for image/jpeg, image/png              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ GET /workers/{id}/certifications/{certId}/document-url
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Identity Service (Lambda)                                      │
│                                                                 │
│  handler.ts                                                     │
│    └── handleGetDocumentUrl                                     │
│          ├── authenticateRequest + enforcePermission             │
│          ├── getCertification (DynamoDB lookup)                  │
│          └── generateReadUrl (S3 GetObject signed URL)          │
│                                                                 │
│  certification.ts                                               │
│    └── generateReadUrl (new function)                           │
│          ├── S3Client.GetObjectCommand                          │
│          └── getSignedUrl with SIGNED_URL_EXPIRY_SECONDS        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  AWS S3 (compliance-media-assets bucket)                        │
│    └── certifications/{tenantId}/{workerId}/{certId}/{filename} │
└─────────────────────────────────────────────────────────────────┘
```

## Components

### Backend Components

#### 1. `generateReadUrl` function (certification.ts)

New function added alongside the existing `generateUploadUrl`. Generates a signed URL for reading (GET) a document from S3.

```typescript
import { GetObjectCommand } from '@aws-sdk/client-s3';

/**
 * Generates an S3 signed URL for reading a certification document.
 */
export async function generateReadUrl(
  documentKey: string
): Promise<{ read_url: string; content_type: string }> {
  const bucketName = process.env['MEDIA_BUCKET_NAME'] ?? 'compliance-media-assets';

  // Infer content type from the document key extension
  const contentType = inferContentType(documentKey);

  const command = new GetObjectCommand({
    Bucket: bucketName,
    Key: documentKey,
    ResponseContentType: contentType,
  });

  const readUrl = await getSignedUrl(s3Client, command, {
    expiresIn: SIGNED_URL_EXPIRY_SECONDS,
  });

  return { read_url: readUrl, content_type: contentType };
}

/**
 * Infers the MIME content type from a document key's file extension.
 */
export function inferContentType(documentKey: string): string {
  const extension = documentKey.split('.').pop()?.toLowerCase();
  switch (extension) {
    case 'pdf':
      return 'application/pdf';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    default:
      return 'application/octet-stream';
  }
}
```

#### 2. `handleGetDocumentUrl` route handler (handler.ts)

New route: `GET /workers/{id}/certifications/{certId}/document-url`

```typescript
async function handleGetDocumentUrl(
  workerId: string,
  certId: string,
  user: { user_id: string; tenant_id: string; role: string }
): Promise<ApiGatewayResponse> {
  const permError = enforcePermission(
    user as Parameters<typeof enforcePermission>[0],
    'certifications:read'
  );
  if (permError) return permError;

  const certification = await getCertification(user.tenant_id, workerId, certId);
  if (!certification) {
    return notFound('Certification not found');
  }

  if (!certification.document_key) {
    return notFound('No document is associated with this certification');
  }

  const { read_url, content_type } = await generateReadUrl(certification.document_key);

  return createSuccessResponse(200, { url: read_url, content_type });
}
```

### Frontend Components

#### 3. `useDocumentUrl` hook

A React Query hook that fetches the signed URL on demand (enabled only when the modal is open).

```typescript
import { useQuery } from '@tanstack/react-query';
import { apiClient, type ApiClientError } from '@/services/api-client';

interface DocumentUrlResponse {
  url: string;
  content_type: string;
}

export function useDocumentUrl(
  workerId: string,
  certificationId: string,
  enabled: boolean
) {
  return useQuery<DocumentUrlResponse, ApiClientError>({
    queryKey: ['document-url', workerId, certificationId],
    queryFn: async () => {
      return apiClient.get<DocumentUrlResponse>(
        `/workers/${workerId}/certifications/${certificationId}/document-url`
      );
    },
    enabled,
    staleTime: 10 * 60 * 1000, // 10 minutes (less than URL expiry of 15 min)
    retry: (failureCount, error) => {
      if (error.status === 404) return false;
      return failureCount < 2;
    },
  });
}
```

#### 4. `DocumentViewerModal` component

A modal component that renders the document inline based on content type.

```typescript
import { Modal } from '@/components/ui/Modal';
import { useDocumentUrl } from './hooks/useDocumentUrl';
import type { Certification } from './types';

interface DocumentViewerModalProps {
  open: boolean;
  onClose: () => void;
  certification: Certification;
  workerId: string;
}

export function DocumentViewerModal({
  open,
  onClose,
  certification,
  workerId,
}: DocumentViewerModalProps) {
  const { data, isLoading, error, refetch } = useDocumentUrl(
    workerId,
    certification.certification_id,
    open
  );

  return (
    <Modal open={open} onClose={onClose} title="Certification Document" size="lg">
      {isLoading && <LoadingIndicator />}
      {error && <ErrorState error={error} onRetry={() => refetch()} />}
      {data && <DocumentRenderer url={data.url} contentType={data.content_type} certification={certification} />}
    </Modal>
  );
}
```

#### 5. `DocumentRenderer` component

Renders the document using the appropriate HTML element based on content type.

```typescript
interface DocumentRendererProps {
  url: string;
  contentType: string;
  certification: Certification;
}

export function DocumentRenderer({ url, contentType, certification }: DocumentRendererProps) {
  const [loadError, setLoadError] = useState(false);

  if (loadError) {
    return <div className="text-center text-red-600">The document could not be rendered.</div>;
  }

  if (contentType === 'application/pdf') {
    return (
      <iframe
        src={url}
        title={`${certification.certification_type} certification document`}
        className="w-full h-[70vh] border-0 rounded"
        onError={() => setLoadError(true)}
      />
    );
  }

  if (contentType === 'image/jpeg' || contentType === 'image/png') {
    return (
      <img
        src={url}
        alt={`${certification.certification_type} certification document from ${certification.issuer}`}
        className="max-w-full max-h-[70vh] mx-auto rounded"
        onError={() => setLoadError(true)}
      />
    );
  }

  return <div className="text-center text-gray-600">Unsupported document format.</div>;
}
```

#### 6. View Button integration in CertificationList

The "View" button is added to the existing actions column, rendered conditionally based on `document_key`.

```typescript
// Inside the actions column cell renderer:
{
  id: 'actions',
  header: 'Actions',
  cell: ({ row }) => {
    const cert = row.original;
    return (
      <div className="flex gap-2">
        {cert.document_key && (
          <Button variant="outline" size="sm" onClick={() => openViewer(cert)}>
            View
          </Button>
        )}
        {cert.validation_status === CertificationStatus.PENDING && (
          <ValidationPanel certification={cert} workerId={workerId} />
        )}
        {cert.validation_status === CertificationStatus.REJECTED && (
          <Button variant="outline" size="sm" onClick={() => onReupload?.(cert)}>
            Re-upload
          </Button>
        )}
      </div>
    );
  },
}
```

## Interfaces

### API Endpoint

| Method | Path | Auth | Permission |
|--------|------|------|------------|
| GET | `/workers/{id}/certifications/{certId}/document-url` | Required | `certifications:read` |

#### Success Response (200)

```json
{
  "url": "https://compliance-media-assets.s3.amazonaws.com/certifications/...",
  "content_type": "application/pdf"
}
```

#### Error Responses

| Status | Condition | Body |
|--------|-----------|------|
| 401 | Missing/invalid auth token | `{ "code": "UNAUTHORIZED", "message": "..." }` |
| 403 | Insufficient permissions | `{ "code": "FORBIDDEN", "message": "..." }` |
| 404 | Certification not found | `{ "code": "NOT_FOUND", "message": "Certification not found" }` |
| 404 | No document associated | `{ "code": "NOT_FOUND", "message": "No document is associated with this certification" }` |

### TypeScript Interfaces

```typescript
// New response type (frontend)
interface DocumentUrlResponse {
  url: string;
  content_type: string;
}

// DocumentViewerModal props
interface DocumentViewerModalProps {
  open: boolean;
  onClose: () => void;
  certification: Certification;
  workerId: string;
}

// DocumentRenderer props
interface DocumentRendererProps {
  url: string;
  contentType: string;
  certification: Certification;
}
```

## Data Models

No new database tables or schema changes are required. The feature reads the existing `document_key` field from the Certification record in DynamoDB.

**Existing DynamoDB access pattern used:**
- Table: `Certifications`
- Key: `PK: TENANT#{tenantId}#WORKER#{workerId}`, `SK: CERT#{certId}`
- Field read: `document_key` (string, S3 object key)

**S3 access pattern:**
- Bucket: `compliance-media-assets` (from `MEDIA_BUCKET_NAME` env var)
- Key: value of `document_key` field (e.g., `certifications/{tenantId}/{workerId}/{certId}/{filename}`)
- Operation: `GetObjectCommand` with pre-signed URL

## Error Handling

| Scenario | Layer | Behavior |
|----------|-------|----------|
| Certification not found | Backend | Returns 404 with "Certification not found" |
| No document_key on cert | Backend | Returns 404 with "No document is associated with this certification" |
| S3 signed URL generation fails | Backend | Caught by global error handler, returns 500 |
| Network error fetching URL | Frontend | Shows error message with retry button |
| 404 from endpoint | Frontend | Shows "Document not found" message (no retry) |
| Document fails to load (iframe/img onError) | Frontend | Shows "The document could not be rendered" message |
| Unsupported content type | Frontend | Shows "Unsupported document format" message |

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: View button visibility is determined by document_key

*For any* certification record, the "View" button is rendered in the actions column if and only if the certification's `document_key` field is a non-empty string. Certifications with undefined, null, or empty-string `document_key` must not render the View button.

**Validates: Requirements 1.1, 1.2**

### Property 2: Document rendering element matches content type

*For any* document URL response with a known content type, the DocumentRenderer component renders an `<iframe>` element when `content_type` is `"application/pdf"`, and an `<img>` element when `content_type` is `"image/jpeg"` or `"image/png"`. In both cases, the element's source attribute (`src`) is set to the signed URL value, and image elements include a non-empty `alt` attribute.

**Validates: Requirements 3.1, 3.2, 4.1, 4.2, 4.3**

### Property 3: Signed URL endpoint returns URL and content type for valid documents

*For any* authenticated request to the document-url endpoint where the certification exists and has a non-empty `document_key`, the endpoint returns a 200 response containing both a `url` string (the signed URL) and a `content_type` string matching the document's inferred MIME type.

**Validates: Requirements 5.2, 5.6**

### Property 4: Content type inference from document key

*For any* document key string, the `inferContentType` function returns `"application/pdf"` for keys ending in `.pdf`, `"image/jpeg"` for keys ending in `.jpg` or `.jpeg`, `"image/png"` for keys ending in `.png`, and `"application/octet-stream"` for all other extensions.

**Validates: Requirements 3.1, 4.1, 5.6**

