# Implementation Plan: Línea de Tiempo de Incidentes

## Overview

Implementar el módulo de vinculación de documentos (Form Responses) a incidentes existentes con visualización en línea de tiempo cronológica. El desarrollo extiende el servicio Lambda de incidentes existente (`src/services/incidents/handler.ts`) con nuevos endpoints REST, una nueva tabla DynamoDB `IncidentLinkedDocuments`, y nuevos componentes React en el admin portal para la gestión y visualización de vínculos.

La implementación usa TypeScript en ambos paquetes, Vitest + fast-check para testing, y sigue los patrones existentes del monorepo (Zod para validación backend, TanStack Query para data fetching frontend).

## Tasks

- [x] 1. Definir tipos, schemas de validación y repositorio de datos
  - [x] 1.1 Crear tipos e interfaces del backend (`packages/backend/src/services/incidents/types.ts`)
    - Extender el archivo existente con `DocumentCategory` type literal
    - Definir `LinkedDocumentInput`, `LinkedDocumentRecord`, `LinkableResponseResult` interfaces
    - Añadir `DOCUMENT_LINKED` y `DOCUMENT_UNLINKED` al enum `TimelineEventType`
    - Definir interfaces de request/response: `LinkedDocumentsResponse`, `LinkableResponsesResponse`
    - Añadir `linked_documents_count?: number` al tipo `IncidentRecord` existente
    - _Requirements: 1.2, 1.5, 2.1, 2.2, 2.3_

  - [x] 1.2 Crear schemas de validación Zod (`packages/backend/src/services/incidents/linked-documents-validators.ts`)
    - Implementar `documentCategorySchema` con las 6 categorías válidas
    - Implementar `createLinkSchema` con refinement para `custom_category_description` cuando categoría es "otro"
    - Implementar `unlinkSchema` con justificación mínima de 10 caracteres
    - Implementar `searchResponsesSchema` con search, date_from, date_to, page, page_size
    - Implementar `filterLinkedDocsSchema` con categorías separadas por coma
    - _Requirements: 1.5, 2.2, 2.3, 5.1, 6.1, 6.2, 6.4_

  - [x] 1.3 Crear repositorio de documentos vinculados (`packages/backend/src/services/incidents/linked-documents-repository.ts`)
    - Implementar `createLinkedDocument(input)`: PutItem en tabla IncidentLinkedDocuments, generar UUID para link_id
    - Implementar `getLinkedDocuments(incidentId, filters?)`: Query por PK con filtro de categorías y exclusión de soft-deleted
    - Implementar `unlinkDocument(incidentId, linkId, unlinkData)`: UpdateItem con unlinked_at, unlinked_by, unlink_justification
    - Implementar `isAlreadyLinked(incidentId, responseId)`: Check de duplicados excluyendo desvinculados
    - Implementar `getLinkableResponses(tenantId, search?, dateFrom?, dateTo?, page, pageSize)`: Query a FormResponses con filtros
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 5.2, 5.3, 5.4, 6.1, 6.2, 6.4_

  - [x] 1.4 Modificar incident-repository para conteo denormalizado (`packages/backend/src/services/incidents/incident-repository.ts`)
    - Añadir `incrementLinkedDocumentsCount(incidentId)`: UpdateExpression ADD linked_documents_count 1
    - Añadir `decrementLinkedDocumentsCount(incidentId)`: UpdateExpression ADD linked_documents_count -1 con condición >= 0
    - _Requirements: 9.1, 9.2, 9.3_

  - [x] 1.5 Escribir property tests para validación de schemas
    - **Property 2: Validación de creación de vínculo**
    - **Property 9: Justificación mínima para desvinculación**
    - **Validates: Requirements 1.5, 2.2, 2.3, 5.1**

  - [x] 1.6 Escribir property test para prevención de duplicados
    - **Property 3: Prevención de vínculos duplicados**
    - **Validates: Requirements 1.4**

- [x] 2. Implementar handlers de endpoints y lógica de negocio
  - [x] 2.1 Crear handler de vinculación POST (`packages/backend/src/services/incidents/handler.ts`)
    - Ruta: `POST /incidents/{id}/linked-documents`
    - Validar payload con `createLinkSchema`
    - Verificar que el incidente existe y el usuario tiene acceso
    - Verificar permisos de rol (tenant_admin, site_admin, supervisor, cso)
    - Verificar que no existe un vínculo activo duplicado (409 si duplicado)
    - Verificar que la Form_Response existe y pertenece al mismo tenant
    - Crear registro en IncidentLinkedDocuments con datos denormalizados del form response
    - Crear evento de audit trail en IncidentTimeline (document_linked)
    - Incrementar linked_documents_count en el incidente
    - Retornar el linked_document creado
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.2, 2.3, 8.1_

  - [x] 2.2 Crear handler de listado GET (`packages/backend/src/services/incidents/handler.ts`)
    - Ruta: `GET /incidents/{id}/linked-documents`
    - Validar query params con `filterLinkedDocsSchema`
    - Verificar acceso de lectura al incidente
    - Retornar documentos vinculados activos con filtro de categorías
    - _Requirements: 3.1, 3.2, 4.1, 4.2, 4.3, 4.4, 8.3_

  - [x] 2.3 Crear handler de desvinculación DELETE (`packages/backend/src/services/incidents/handler.ts`)
    - Ruta: `DELETE /incidents/{id}/linked-documents/{linkId}`
    - Validar body con `unlinkSchema`
    - Verificar permisos de rol (solo tenant_admin, cso)
    - Ejecutar soft delete (marcar unlinked_at, unlinked_by, unlink_justification)
    - Crear evento de audit trail en IncidentTimeline (document_unlinked)
    - Decrementar linked_documents_count en el incidente
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 8.2_

  - [x] 2.4 Crear handler de búsqueda de respuestas disponibles GET (`packages/backend/src/services/incidents/handler.ts`)
    - Ruta: `GET /incidents/{id}/linkable-responses`
    - Validar query params con `searchResponsesSchema`
    - Verificar permisos de rol (tenant_admin, site_admin, supervisor, cso)
    - Consultar FormResponses filtrando por tenant_id del usuario
    - Excluir respuestas ya vinculadas activamente al incidente
    - Aplicar búsqueda parcial case-insensitive en nombre de formulario, folio, y nombre de usuario
    - Aplicar filtro de rango de fechas si se proporcionan
    - Paginar resultados (máx 20 por página)
    - _Requirements: 1.1, 6.1, 6.2, 6.3, 6.4, 8.1_

  - [x] 2.5 Escribir property tests para aislamiento de tenant y búsqueda
    - **Property 1: Aislamiento de tenant en respuestas disponibles**
    - **Property 10: Búsqueda por coincidencia parcial**
    - **Property 11: Filtro por rango de fechas**
    - **Property 12: Paginación con máximo 20 elementos por página**
    - **Validates: Requirements 1.1, 6.1, 6.2, 6.4**

  - [x] 2.6 Escribir property tests para audit trail y completitud de registro
    - **Property 4: Completitud del registro de vínculo**
    - **Property 5: Creación de audit record para vinculación y desvinculación**
    - **Validates: Requirements 1.2, 1.3, 5.2**

  - [x] 2.7 Escribir property test para control de acceso
    - **Property 14: Control de acceso basado en roles**
    - **Validates: Requirements 8.1, 8.2, 8.4**

- [x] 3. Checkpoint - Backend funcional
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Implementar tipos y hooks del frontend
  - [x] 4.1 Crear tipos del frontend (`packages/admin-portal/src/features/incidents/types.ts`)
    - Extender archivo existente con `DocumentCategory`, `LinkedDocument`, `LinkableResponse`
    - Definir `CreateLinkRequest`, `UnlinkRequest`
    - Definir `LinkedDocumentsResponse`, `LinkableResponsesResponse`
    - Definir constantes `DOCUMENT_CATEGORY_LABELS` y `DOCUMENT_CATEGORY_COLORS`
    - _Requirements: 2.1, 3.2_

  - [x] 4.2 Crear hooks de datos (`packages/admin-portal/src/features/incidents/hooks/useLinkedDocuments.ts`)
    - Implementar `useLinkedDocuments(incidentId, categories?)`: TanStack Query GET con filtros
    - Implementar `useLinkDocument(incidentId)`: useMutation POST con invalidación de queries
    - Implementar `useUnlinkDocument(incidentId)`: useMutation DELETE con invalidación de queries
    - Implementar `useLinkableResponses(incidentId, search?, dateFrom?, dateTo?, page?)`: TanStack Query GET con paginación
    - Invalidar queries de linked documents y del incidente tras mutaciones exitosas
    - _Requirements: 1.2, 3.1, 5.3, 6.1, 6.2, 6.4, 9.3_

- [x] 5. Implementar componentes de visualización de timeline
  - [x] 5.1 Crear componente LinkedDocumentCard (`packages/admin-portal/src/features/incidents/LinkedDocumentCard.tsx`)
    - Renderizar card con: nombre del formulario, folio, categoría con badge de color, fecha de envío, usuario que completó, usuario que vinculó
    - Botón de navegación a la vista de detalle de la Form_Response
    - Botón de desvincular (visible solo para tenant_admin/cso)
    - Nota de contexto expandible si existe
    - _Requirements: 3.2, 3.3, 5.1, 8.2_

  - [x] 5.2 Crear componente CategoryFilter (`packages/admin-portal/src/features/incidents/CategoryFilter.tsx`)
    - Multi-select de categorías con checkboxes
    - Badge de conteo de resultados filtrados
    - Botón "Limpiar filtros" para resetear selección
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

  - [x] 5.3 Crear componente DocumentTimelineView (`packages/admin-portal/src/features/incidents/DocumentTimelineView.tsx`)
    - Integrar `CategoryFilter` y lista de `LinkedDocumentCard`
    - Ordenar documentos cronológicamente descendente por `response_submitted_at`
    - Mostrar estado vacío cuando no hay documentos vinculados
    - Mostrar conteo total de documentos
    - _Requirements: 3.1, 3.4, 4.1_

  - [x] 5.4 Escribir property tests para orden y filtrado del frontend
    - **Property 6: Orden cronológico descendente de la línea de tiempo**
    - **Property 7: Filtrado por categoría multi-select**
    - **Property 8: Documentos desvinculados excluidos de la vista activa**
    - **Validates: Requirements 3.1, 4.1, 4.2, 4.3, 4.4, 5.3**

- [x] 6. Implementar componentes de vinculación y desvinculación
  - [x] 6.1 Crear componente LinkFormModal (`packages/admin-portal/src/features/incidents/LinkFormModal.tsx`)
    - Campo de búsqueda con debounce para nombre/folio/usuario
    - Filtros de rango de fechas (date_from, date_to)
    - Lista de resultados paginada con info de cada Form_Response
    - Selector de Document_Category obligatorio
    - Campo condicional de descripción personalizada cuando categoría es "otro" (5-100 chars)
    - Campo opcional de nota de contexto (max 500 chars)
    - Botón de confirmar vinculación
    - Manejo de errores: toast para 409 (duplicado), error inline para validaciones
    - _Requirements: 1.1, 1.5, 2.2, 2.3, 6.1, 6.2, 6.3, 6.4_

  - [x] 6.2 Crear componente UnlinkConfirmModal (`packages/admin-portal/src/features/incidents/UnlinkConfirmModal.tsx`)
    - Mostrar resumen del documento a desvincular
    - Campo de justificación obligatorio (min 10 caracteres)
    - Validación en tiempo real del mínimo de caracteres
    - Botón de confirmar desvinculación
    - Manejo de errores con toast
    - _Requirements: 5.1, 5.2_

  - [x] 6.3 Crear componente LinkedDocsBadge (`packages/admin-portal/src/features/incidents/LinkedDocsBadge.tsx`)
    - Badge numérico que muestra conteo de documentos vinculados
    - No renderizar cuando el conteo es 0 o undefined
    - _Requirements: 9.1, 9.2_

- [x] 7. Checkpoint - Componentes individuales listos
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Implementar vista combinada e integración
  - [x] 8.1 Crear componente CombinedTimelineView (`packages/admin-portal/src/features/incidents/CombinedTimelineView.tsx`)
    - Merge cronológico de eventos de audit trail existentes con documentos vinculados
    - Diferenciación visual con íconos y colores distintos por tipo de entrada
    - Orden descendente por timestamp
    - Preservar filtros de categoría activos al alternar vistas
    - _Requirements: 7.1, 7.2, 7.3_

  - [x] 8.2 Integrar tab de Documentos en IncidentDetailPage (`packages/admin-portal/src/features/incidents/IncidentDetailPage.tsx`)
    - Añadir nueva pestaña "Documentos" con conteo
    - Toggle entre vista combinada y vista de solo documentos
    - Botón "Vincular Documento" (visible según permisos de rol)
    - Conectar LinkFormModal y UnlinkConfirmModal
    - _Requirements: 3.4, 7.1, 7.3, 8.1, 8.3_

  - [x] 8.3 Integrar LinkedDocsBadge en IncidentListPage (`packages/admin-portal/src/features/incidents/IncidentListPage.tsx`)
    - Renderizar badge con `linked_documents_count` en cada fila de incidente
    - No mostrar badge cuando el conteo es 0
    - _Requirements: 9.1, 9.2_

  - [x] 8.4 Escribir property test para merge cronológico
    - **Property 13: Merge cronológico de vista combinada**
    - **Validates: Requirements 7.1**

- [x] 9. Final checkpoint - Build y tests completos
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- Backend files go in `packages/backend/src/services/incidents/`
- Property test files go in `packages/backend/tests/properties/incident-timeline/`
- Frontend files go in `packages/admin-portal/src/features/incidents/`
- La tabla `IncidentLinkedDocuments` debe ser creada manualmente o via IaC separado (fuera del alcance de estas tareas de código)
- Los hooks del frontend usan TanStack Query con invalidación automática post-mutación
- El audit trail se escribe en la tabla `IncidentTimeline` existente (append-only)

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["1.3", "1.4"] },
    { "id": 2, "tasks": ["1.5", "1.6", "2.1", "2.2", "2.3", "2.4"] },
    { "id": 3, "tasks": ["2.5", "2.6", "2.7"] },
    { "id": 4, "tasks": ["4.1"] },
    { "id": 5, "tasks": ["4.2"] },
    { "id": 6, "tasks": ["5.1", "5.2", "6.1", "6.2", "6.3"] },
    { "id": 7, "tasks": ["5.3", "5.4"] },
    { "id": 8, "tasks": ["8.1", "8.2", "8.3", "8.4"] }
  ]
}
```
