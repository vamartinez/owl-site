# Implementation Plan: contractor-forms-qr

## Overview

Implementación del módulo de formularios dinámicos con códigos QR para contratistas. Se construye un nuevo servicio Lambda (`forms-service`) con tablas DynamoDB dedicadas, endpoints autenticados y públicos, y componentes frontend tanto para administración como para la vista pública de formularios. La implementación sigue el patrón existente del proyecto: TypeScript, CDK para infraestructura, Lambda handlers con routing, y React + TanStack Query en el frontend.

## Tasks

- [x] 1. Infrastructure — CDK tables, Lambda, and API Gateway routes
  - [x] 1.1 Add DynamoDB table definitions to data-stack
    - Add `Forms` table with PK/SK and GSI1 (by token)
    - Add `FormVersions` table with PK/SK
    - Add `FormResponses` table with PK/SK and GSI1 (by date)
    - Add `FormAuditLog` table with PK/SK, GSI1, and TTL attribute `expiresAt`
    - Export table references for use in api-stack
    - _Requirements: 1.1, 11.1, 14.1, 16.1, 16.4_

  - [x] 1.2 Add Forms Service Lambda function to api-stack
    - Create `forms-service` Lambda (256 MB, 29s timeout)
    - Grant read/write permissions to all 4 new tables and existing RateLimits table
    - Grant S3 permissions for presigned URL generation on the media bucket
    - Pass table names and bucket name as environment variables
    - _Requirements: 1.1, 9.1_

  - [x] 1.3 Add API Gateway routes for Forms Service
    - Add 12 authenticated routes (POST/GET /forms, GET/PATCH /forms/{id}, publish, unpublish, duplicate, responses, responses/{responseId}, responses/export, audit, upload-url) with Cognito authorizer
    - Add 3 public routes (/public/forms/{token} GET, /public/forms/{token}/responses POST, /public/forms/{token}/upload-url POST) without authorizer
    - Wire all routes to the forms-service Lambda integration
    - _Requirements: 9.6, 14.1_

- [x] 2. Backend core — types, RBAC, handler routing, audit module
  - [x] 2.1 Create domain types and interfaces
    - Create `packages/backend/src/services/forms/types.ts`
    - Define `FormStatus`, `FieldType` enums, `FieldConfig`, `FieldOption`, `FieldValidation`, `Form`, `FormVersion`, `FormResponse`, `AuditEntry` interfaces
    - _Requirements: 2.1, 2.2, 2.6_

  - [x] 2.2 Add RBAC permissions for forms module
    - Add `forms:create`, `forms:read`, `forms:update`, `forms:publish`, `forms:read_responses`, `forms:export` permissions to the RBAC system
    - Assign all forms permissions to `platform_admin`, `tenant_admin`, `site_admin`
    - Assign `forms:read`, `forms:read_responses` to `supervisor`, `cso`
    - _Requirements: 1.5, 3.7, 4.4, 5.5, 6.7, 7.1, 12.4, 13.4_

  - [x] 2.3 Create handler router for forms-service
    - Create `packages/backend/src/services/forms/handler.ts`
    - Implement routing by `httpMethod` + `resource` path following identity-service pattern
    - Route authenticated endpoints through `authenticateRequest` → `enforcePermission`
    - Route public endpoints (`/public/forms/*`) without auth
    - Return structured responses with `createSuccessResponse` / `createErrorResponse`
    - _Requirements: 1.1, 9.6_

  - [x] 2.4 Implement audit module
    - Create `packages/backend/src/services/forms/audit.ts`
    - Implement `logAuditEntry(params)` that writes to FormAuditLog table
    - Include entity_type, entity_id, action, actor_id, timestamp (ISO 8601 UTC), ip_address, metadata, tenant_id
    - Set TTL (expiresAt) to 365 days from creation
    - If audit write fails, throw error to reject the parent operation
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5_

  - [x] 2.5 Write property test for audit module
    - **Property 2: Registro de auditoría completo**
    - **Property 3: Actor de auditoría para contratistas**
    - **Validates: Requirements 16.1, 16.2, 16.3**

- [x] 3. Backend CRUD — create, edit, save, duplicate, publish, unpublish
  - [x] 3.1 Implement form creation endpoint
    - Create `packages/backend/src/services/forms/form.ts`
    - Implement POST /forms: validate name (3-200 chars, at least one non-space), optional description (max 1000 chars)
    - Check for duplicate name within tenant
    - Create form with status "borrador", assign UUID, record created_at (UTC), author_id, tenant_id
    - Log audit entry "formulario_creado"
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.6, 1.7_

  - [x] 3.2 Write property tests for form creation
    - **Property 4: Validación de metadatos del formulario**
    - **Validates: Requirements 1.2, 1.3, 1.4**

  - [x] 3.3 Implement form save/edit endpoint
    - Implement PATCH /forms/{id}: validate form is in "borrador" state
    - Validate name, description, and field configurations
    - Validate field constraints: max 50 fields, label 1-200 chars, selection fields 2-50 options, numeric validation range, text validation range
    - Persist changes and update `updated_at`
    - Log audit entry "formulario_editado"
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 3.1, 3.3, 3.4, 3.5, 4.2, 4.3, 4.5, 4.6, 4.7_

  - [x] 3.4 Write property tests for field configuration validation
    - **Property 5: Validación de configuración de campos**
    - **Property 6: Orden de campos consecutivo sin duplicados**
    - **Validates: Requirements 2.2, 2.5, 2.6, 2.7, 2.9**

  - [x] 3.5 Implement form duplication endpoint
    - Implement POST /forms/{id}/duplicate
    - Copy all fields with properties (type, label, required, help_text, placeholder, order, options, validation)
    - Do NOT copy token_publico, versions, responses, or dates
    - Set name to "{original} (copia)" truncated to 200 chars
    - Set status to "borrador", assign new UUID
    - Log audit entry "formulario_duplicado" with original form ID in metadata
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.6_

  - [x] 3.6 Write property tests for form duplication
    - **Property 10: Duplicación preserva campos sin estado**
    - **Property 11: Nombre de formulario duplicado**
    - **Validates: Requirements 5.1, 5.2, 5.3**

  - [x] 3.7 Implement publish endpoint
    - Implement POST /forms/{id}/publish
    - Validate form is in "borrador" state
    - Validate minimum requirements: name 3-200 chars, at least 1 field, each field has label 1-200 chars, selection fields have ≥2 options
    - Generate token_publico (UUID v4), change status to "publicado"
    - Create FormVersion (immutable snapshot of fields), increment version number
    - Record published_at, log audit entry "formulario_publicado"
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

  - [x] 3.8 Implement unpublish endpoint
    - Implement POST /forms/{id}/unpublish
    - Validate form is in "publicado" state
    - Change status to "despublicado"
    - Log audit entry "formulario_despublicado" with actor ID and UTC timestamp
    - _Requirements: 7.1, 7.2, 7.4, 7.5_

  - [x] 3.9 Write property tests for state transitions and publishing
    - **Property 7: Restricción de operaciones por estado**
    - **Property 12: Publicación crea versión inmutable con token UUID v4**
    - **Validates: Requirements 3.5, 4.6, 6.3, 6.4, 6.6, 7.2**

- [x] 4. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Backend public endpoints — get form by token, submit response, upload URL
  - [x] 5.1 Implement GET /public/forms/{token}
    - Create `packages/backend/src/services/forms/form-response.ts`
    - Query Forms table GSI1 by token
    - Return 404 if token not found or form not in "publicado" state
    - Return 410 if form is "despublicado" with message "formulario no disponible"
    - Return form schema: name, description, fields in order with rendering properties
    - _Requirements: 3.2, 7.3, 9.1, 9.4_

  - [x] 5.2 Write property tests for public form access
    - **Property 9: Acceso público denegado para formularios no publicados**
    - **Property 13: Acceso público retorna esquema completo**
    - **Property 14: Endpoints públicos no requieren autenticación**
    - **Validates: Requirements 3.2, 7.3, 9.1, 9.6**

  - [x] 5.3 Implement form validation module
    - Create `packages/backend/src/services/forms/form-validation.ts`
    - Implement validation for all 8 field types: required check, text length, numeric range, date range, file type/size, selection options
    - Return all validation errors simultaneously (not fail-fast)
    - Module must be usable both server-side and extractable for client-side logic
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.7_

  - [x] 5.4 Write property tests for validation module
    - **Property 15: Validación muestra todos los errores simultáneamente**
    - **Property 16: Validación numérica reporta límites**
    - **Property 17: Validación de texto reporta longitud**
    - **Property 18: Validación servidor consistente con cliente**
    - **Validates: Requirements 10.1, 10.2, 10.3, 10.7**

  - [x] 5.5 Implement POST /public/forms/{token}/responses
    - Validate form is still "publicado" (reject if despublicado after page load)
    - Run server-side validation using form-validation module
    - Create FormResponse with UUID, form_id, version_number, folio (8 alphanumeric chars), submitted_at (ISO 8601 UTC), answers, metadata (origin_type, user_agent, ip_address)
    - Log audit entry "respuesta_enviada" with response_id as actor
    - Return confirmation with folio
    - _Requirements: 11.1, 11.2, 11.3, 11.6, 11.8, 11.9_

  - [x] 5.6 Write property tests for response submission
    - **Property 19: Folio de respuesta alfanumérico de 8 caracteres**
    - **Validates: Requirements 11.3**

  - [x] 5.7 Implement POST /public/forms/{token}/upload-url
    - Validate file type (PDF, JPEG, PNG) and size (max 10 MB)
    - Generate S3 presigned URL with 15-minute expiration
    - Return upload_url, fields, and file_key
    - S3 key structure: `forms/{tenant_id}/{form_id}/responses/{response_id}/{field_id}/{filename}`
    - _Requirements: 11.5, 15.4_

  - [x] 5.8 Write property tests for file validation
    - **Property 28: Validación de archivos**
    - **Validates: Requirements 10.4, 11.5, 15.4**

- [x] 6. Backend utilities — rate limiter, sanitizer, CSV export, list/detail endpoints
  - [x] 6.1 Implement rate limiter module
    - Create `packages/backend/src/services/forms/rate-limiter.ts`
    - Use existing RateLimits table with atomic DynamoDB operations
    - Implement sliding window: 10 requests per IP per form per 5-minute window
    - Return 429 with retry_after_seconds when limit exceeded
    - TTL auto-cleans expired records
    - _Requirements: 15.1, 15.2_

  - [x] 6.2 Write property test for rate limiter
    - **Property 27: Rate limiting por IP y formulario**
    - **Validates: Requirements 15.1**

  - [x] 6.3 Implement input sanitizer module
    - Create `packages/backend/src/services/forms/sanitizer.ts`
    - Remove HTML tags, escape SQL special characters, remove control sequences, normalize whitespace
    - Do not reject submissions — sanitize and store
    - Implement bot detection: validate headers (User-Agent, Origin, Referer), detect rapid submissions (<2s from page load), honeypot field check
    - _Requirements: 11.7, 15.3, 15.5_

  - [x] 6.4 Write property test for sanitizer
    - **Property 20: Sanitización preserva contenido seguro**
    - **Validates: Requirements 11.7, 15.3**

  - [x] 6.5 Implement responses list and detail endpoints
    - Implement GET /forms/{id}/responses: paginated (25 per page), filterable by date range (max 365 days), status, contractor
    - Query using GSI1 for date ordering
    - Implement GET /forms/{id}/responses/{responseId}: return full response detail with field values and version schema
    - _Requirements: 12.1, 12.2, 12.3, 12.5, 12.6_

  - [x] 6.6 Write property tests for response filtering and pagination
    - **Property 21: Filtros de respuestas retornan solo coincidencias**
    - **Property 22: Paginación respeta límite máximo**
    - **Validates: Requirements 12.2, 12.5**

  - [x] 6.7 Implement CSV export endpoint
    - Create `packages/backend/src/services/forms/form-export.ts`
    - Implement GET /forms/{id}/responses/export
    - Generate UTF-8 with BOM CSV file
    - Columns: folio, fecha_envio (ISO 8601), one column per field
    - Multi-version: unify columns from all versions, empty cells for missing fields
    - Multiple selection values separated by semicolons
    - Return headers-only CSV if no responses exist
    - 30-second timeout, no partial files on failure
    - _Requirements: 13.1, 13.2, 13.3, 13.5, 13.6_

  - [x] 6.8 Write property tests for CSV export
    - **Property 23: Exportación CSV estructura correcta**
    - **Property 24: CSV multi-versión unifica columnas**
    - **Validates: Requirements 13.1, 13.2, 13.3**

  - [x] 6.9 Implement form versioning logic
    - Create `packages/backend/src/services/forms/form-version.ts`
    - Implement version creation on publish (sequential numbering from 1)
    - Associate responses with version at time of submission
    - Reject modification/deletion of versions with existing responses
    - _Requirements: 14.1, 14.2, 14.3, 14.6_

  - [x] 6.10 Write property tests for versioning
    - **Property 25: Versionado secuencial e inmutable**
    - **Property 26: Versiones con respuestas son inmutables**
    - **Validates: Requirements 14.1, 14.2, 14.3, 14.6**

  - [x] 6.11 Implement audit query endpoint
    - Implement GET /forms/{id}/audit
    - Return audit entries ordered by timestamp descending, max 50 per page
    - _Requirements: 16.6_

- [x] 7. Checkpoint — Ensure all backend tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Frontend admin — form list, builder, detail with QR, responses
  - [x] 8.1 Create forms feature directory and API hooks
    - Create `packages/admin-portal/src/features/forms/` directory
    - Implement TanStack Query hooks: `useFormsQuery`, `useFormQuery`, `useCreateForm`, `useUpdateForm`, `usePublishForm`, `useUnpublishForm`, `useDuplicateForm`, `useFormResponses`, `useFormResponseDetail`, `useExportResponses`
    - Add API client functions for all 12 authenticated endpoints
    - _Requirements: 1.1, 4.1_

  - [x] 8.2 Implement FormList page
    - Create `packages/admin-portal/src/features/forms/FormList.tsx`
    - Display forms with name, status, creation date, response count
    - Add filters by status
    - Add "Create Form" and "Duplicate" actions
    - Wire to router
    - _Requirements: 1.1, 5.1_

  - [x] 8.3 Implement FormBuilder page
    - Create `packages/admin-portal/src/features/forms/FormBuilder.tsx`
    - Support adding/removing/reordering fields (up to 50)
    - Support all 8 field types with their configuration options
    - Inline validation for field configuration (label, options, validation rules)
    - Save as draft functionality
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 3.1, 3.3, 4.1, 4.2, 4.3, 4.5_

  - [x] 8.4 Implement FormDetail page with QR generation
    - Create `packages/admin-portal/src/features/forms/FormDetail.tsx`
    - Display form metadata, status, version info
    - Show QR code for published/unpublished forms using `qrcode` npm package (client-side generation)
    - QR encodes full public URL: `https://{domain}/forms/{token_publico}`
    - Provide PNG download (min 300x300px)
    - Hide QR section for draft forms
    - Add Publish/Unpublish action buttons
    - Log audit "qr_descargado" on download
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7_

  - [x] 8.5 Implement FormResponses page
    - Create `packages/admin-portal/src/features/forms/FormResponses.tsx`
    - Display responses list with folio, date, status
    - Filters: date range (max 365 days), status, contractor
    - Pagination: 25 per page
    - Export to CSV button
    - Empty state message when no results match filters
    - _Requirements: 12.1, 12.2, 12.5, 12.6, 13.1_

  - [x] 8.6 Implement ResponseDetail page
    - Create `packages/admin-portal/src/features/forms/ResponseDetail.tsx`
    - Display all field values rendered with the version schema used at submission time
    - Show metadata: date, folio, contractor, origin type
    - _Requirements: 12.3, 14.4_

  - [x] 8.7 Add forms routes to admin-portal router
    - Add routes: /forms, /forms/new, /forms/:id, /forms/:id/edit, /forms/:id/responses, /forms/:id/responses/:responseId
    - Add "Formularios" navigation item to sidebar
    - _Requirements: 1.1, 4.1_

- [x] 9. Frontend public form — renderer, validation, submission, confirmation
  - [x] 9.1 Create public form route and page structure
    - Create `packages/admin-portal/src/features/public-form/PublicFormPage.tsx`
    - Add route `/forms/:token` without authenticated layout (no AppLayout wrapper)
    - Implement data fetching with loading, error, and retry states
    - Show "formulario no encontrado" for 404, "formulario no disponible" for 410
    - _Requirements: 9.1, 9.4, 9.7_

  - [x] 9.2 Implement PublicFormRenderer component
    - Create `packages/admin-portal/src/features/public-form/PublicFormRenderer.tsx`
    - Create field components for all 8 types in `features/public-form/fields/`
    - Render fields in configured order with labels, help text, placeholders
    - Mobile-first responsive design (functional from 320px, no horizontal scroll)
    - _Requirements: 9.1, 9.2, 9.8_

  - [x] 9.3 Implement client-side validation
    - Implement real-time validation (<500ms) using the same logic as server-side `form-validation.ts`
    - Show validation errors in Spanish next to each field on blur and on submit
    - Show all errors simultaneously on submit attempt
    - Validate: required fields, numeric range, text length, date format/range, file type/size
    - _Requirements: 9.5, 10.1, 10.2, 10.3, 10.4, 10.5, 10.6_

  - [x] 9.4 Implement file upload with presigned URLs
    - Implement file selection, client-side validation (type + size), presigned URL request, direct S3 upload
    - Show upload progress indicator
    - Store file_key for inclusion in form submission
    - _Requirements: 11.5_

  - [x] 9.5 Implement form submission and confirmation
    - Create `packages/admin-portal/src/features/public-form/PublicFormSuccess.tsx`
    - Submit form data to POST /public/forms/{token}/responses
    - Handle server validation errors: display per-field errors preserving user input
    - Retry up to 3 times on network/server errors with exponential backoff
    - Show confirmation screen with success message and 8-char folio
    - Handle "formulario despublicado" error gracefully
    - _Requirements: 11.1, 11.3, 11.4, 11.8, 11.9_

  - [x] 9.6 Add honeypot field for bot protection
    - Add hidden honeypot field to public form
    - If honeypot is filled, silently reject submission
    - _Requirements: 15.5_

- [x] 10. Backend integration — wire rate limiter and sanitizer into response submission
  - [x] 10.1 Integrate rate limiter and sanitizer into public response endpoint
    - Call rate limiter before processing POST /public/forms/{token}/responses
    - Apply sanitizer to all text inputs before validation and storage
    - Apply bot detection checks (headers, timing, honeypot)
    - _Requirements: 15.1, 15.3, 15.5, 11.7_

  - [x] 10.2 Write property test for RBAC authorization
    - **Property 1: Autorización por rol**
    - **Validates: Requirements 1.5, 3.7, 4.4, 5.5, 6.7, 7.1, 12.4, 13.4**

  - [x] 10.3 Write property test for round-trip persistence
    - **Property 8: Round-trip de persistencia de formulario**
    - **Validates: Requirements 3.1, 4.2, 4.5**

- [x] 11. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document (28 properties total)
- Unit tests validate specific examples and edge cases
- The design specifies TypeScript throughout — backend Lambda, CDK infrastructure, and React frontend
- QR generation is client-side only (no backend QR service needed)
- File uploads use S3 presigned URLs (no file data passes through Lambda)
- Rate limiting reuses the existing RateLimits DynamoDB table

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "2.1"] },
    { "id": 2, "tasks": ["1.3", "2.2", "2.3", "2.4"] },
    { "id": 3, "tasks": ["2.5", "3.1", "3.3"] },
    { "id": 4, "tasks": ["3.2", "3.4", "3.5", "3.7", "3.8"] },
    { "id": 5, "tasks": ["3.6", "3.9", "5.1", "5.3", "6.1", "6.3", "6.9"] },
    { "id": 6, "tasks": ["5.2", "5.4", "5.5", "5.7", "6.2", "6.4", "6.5", "6.7", "6.10", "6.11"] },
    { "id": 7, "tasks": ["5.6", "5.8", "6.6", "6.8"] },
    { "id": 8, "tasks": ["8.1", "9.1"] },
    { "id": 9, "tasks": ["8.2", "8.3", "8.7", "9.2", "9.3"] },
    { "id": 10, "tasks": ["8.4", "8.5", "8.6", "9.4", "9.5", "9.6"] },
    { "id": 11, "tasks": ["10.1", "10.2", "10.3"] }
  ]
}
```
