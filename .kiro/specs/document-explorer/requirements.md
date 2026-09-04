# Requirements Document

## Introduction

El módulo de Explorador de Documentos centraliza la visualización, navegación y descarga de todos los documentos generados por la plataforma (reportes, formularios, certificaciones, evidencias e incidentes). Organiza los documentos en una estructura jerárquica de carpetas que permite a los usuarios localizar rápidamente cualquier documento para facilitar procesos de auditoría y cumplimiento regulatorio.

## Glossary

- **Document_Explorer**: Módulo del admin portal que permite navegar, visualizar y descargar documentos organizados en una estructura de carpetas.
- **Document**: Archivo generado por la plataforma, incluyendo reportes PDF, formularios completados, certificaciones, evidencia fotográfica y reportes de incidentes.
- **Folder**: Contenedor virtual que agrupa documentos por categoría, sitio, fecha u otro criterio de organización.
- **Breadcrumb_Navigation**: Componente de navegación que muestra la ruta jerárquica desde la raíz hasta la carpeta actual.
- **Document_Preview**: Vista previa del contenido de un documento sin necesidad de descargarlo.
- **Audit_User**: Usuario con rol platform_admin, tenant_admin, site_admin o cso que accede al explorador para procesos de auditoría.
- **Download_Action**: Acción de obtener una copia local de uno o más documentos desde el almacenamiento de la plataforma.

## Requirements

### Requirement 1: Navegación por carpetas

**User Story:** Como Audit_User, quiero navegar por una estructura jerárquica de carpetas, para poder localizar documentos organizados por categoría y contexto.

#### Acceptance Criteria

1. WHEN the Audit_User accesses the Document_Explorer, THE Document_Explorer SHALL display the root-level folders representing document categories (Reports, Forms, Certifications, Incidents, Safety Evidence).
2. WHEN the Audit_User clicks on a Folder, THE Document_Explorer SHALL display the contents of that Folder, including sub-folders and documents contained within, sorted alphabetically by name, supporting a maximum nesting depth of 5 levels.
3. WHILE the Audit_User is navigating within a Folder, THE Document_Explorer SHALL display the Breadcrumb_Navigation showing the full path from root to the current Folder, with each ancestor folder represented as a clickable segment.
4. WHEN the Audit_User clicks on a breadcrumb segment, THE Document_Explorer SHALL navigate to the corresponding Folder level and display its contents.
5. WHEN a Folder contains no documents or sub-folders, THE Document_Explorer SHALL display an empty state message indicating that no documents are available in that location.
6. WHILE the Document_Explorer is retrieving folder contents, THE Document_Explorer SHALL display a loading indicator within 200 milliseconds of the request initiation and maintain it until content is rendered or an error occurs.
7. IF the Document_Explorer fails to retrieve folder contents due to a network or server error, THEN THE Document_Explorer SHALL display an error message indicating the failure reason and provide a retry option, without losing the user's current navigation context in the Breadcrumb_Navigation.

### Requirement 2: Listado y visualización de documentos

**User Story:** Como Audit_User, quiero ver los documentos disponibles en cada carpeta con información relevante, para poder identificar rápidamente el documento que necesito.

#### Acceptance Criteria

1. WHEN the Audit_User opens a Folder containing documents, THE Document_Explorer SHALL display each Document with its name, document type, creation date, associated site, and file size, showing a maximum of 50 documents per page with pagination controls to access additional pages.
2. THE Document_Explorer SHALL sort documents by creation date in descending order by default.
3. WHEN the Audit_User clicks on a Document with a previewable format (PDF or image files: JPEG, PNG), THE Document_Explorer SHALL display a Document_Preview in a side panel within 2 seconds of the click.
4. IF the Document format does not support preview (formats other than PDF, JPEG, or PNG), THEN THE Document_Explorer SHALL display a message indicating preview is unavailable for that format and offer the Download_Action.
5. IF the document list fails to load due to a network or server error, THEN THE Document_Explorer SHALL display an error message indicating the documents could not be retrieved and offer a retry option.

### Requirement 3: Descarga de documentos

**User Story:** Como Audit_User, quiero descargar documentos individuales o múltiples, para poder recopilar evidencia para procesos de auditoría externa.

#### Acceptance Criteria

1. WHEN the Audit_User selects a single Document and triggers the Download_Action, THE Document_Explorer SHALL initiate the download of that Document in its original format within 5 seconds of the action.
2. WHEN the Audit_User selects between 2 and 50 documents and triggers the Download_Action, THE Document_Explorer SHALL package the selected documents into a single ZIP file and initiate the download, provided the combined file size does not exceed 500 MB.
3. WHILE a download is in progress, THE Document_Explorer SHALL display a progress indicator showing the percentage of bytes downloaded and the estimated time remaining.
4. IF a download fails due to a network error, THEN THE Document_Explorer SHALL display an error message indicating the failure reason and offer a retry option that preserves the original document selection.
5. IF the combined size of the selected documents exceeds 500 MB, THEN THE Document_Explorer SHALL display an error message indicating the size limit and prevent the download from starting.
6. IF one or more documents in a batch download are inaccessible, THEN THE Document_Explorer SHALL complete the download with the accessible documents, and display a summary indicating which documents could not be included.
7. IF a download does not complete within 120 seconds, THEN THE Document_Explorer SHALL cancel the download, display a timeout error message, and offer a retry option.

### Requirement 4: Búsqueda y filtrado

**User Story:** Como Audit_User, quiero buscar y filtrar documentos por diferentes criterios, para poder encontrar documentos específicos sin navegar manualmente toda la estructura.

#### Acceptance Criteria

1. THE Document_Explorer SHALL provide a search input that filters documents by name using case-insensitive partial matching across all folders.
2. WHEN the Audit_User enters a search term of at least 2 characters, THE Document_Explorer SHALL display matching documents with their folder path within 500ms of the last keystroke.
3. THE Document_Explorer SHALL provide filter options for document type (Reports, Forms, Certifications, Incidents, Safety Evidence), date range (start date and end date), and associated site.
4. WHEN the Audit_User applies one or more filters, THE Document_Explorer SHALL display only documents matching all active filter criteria, combining with the active search term if present.
5. WHEN the Audit_User clears all filters and the search term, THE Document_Explorer SHALL restore the full folder view showing the folder the user was navigating before searching.
6. IF a search or filter combination yields no matching documents, THEN THE Document_Explorer SHALL display an empty state message indicating no documents match the current criteria and show options to clear the search term or active filters.
7. WHEN the Audit_User enters a search term of fewer than 2 characters, THE Document_Explorer SHALL not trigger a search and SHALL retain the current view.

### Requirement 5: Control de acceso

**User Story:** Como tenant_admin, quiero que solo los usuarios autorizados puedan acceder al explorador de documentos, para asegurar la confidencialidad de la información.

#### Acceptance Criteria

1. THE Document_Explorer SHALL be accessible only to users with roles platform_admin, tenant_admin, site_admin, supervisor, or cso, returning an unauthorized response within 2 seconds of the access attempt for any other role.
2. WHILE a user with role site_admin or supervisor is using the Document_Explorer, THE Document_Explorer SHALL display only documents associated with the sites listed in that user's assigned_sites attribute, and SHALL display no documents if assigned_sites is empty.
3. WHEN a user with role gate_operator or worker attempts to access the Document_Explorer, THE Document_Explorer SHALL redirect the user to the dashboard without displaying any document content.
4. THE Document_Explorer SHALL enforce tenant isolation, displaying only documents belonging to the current user's tenant_id, so that no user can view documents from a different tenant.
5. WHILE a user with role platform_admin is using the Document_Explorer, THE Document_Explorer SHALL display documents from all tenants without tenant filtering restrictions.
6. IF an unauthenticated user or a user with an expired session attempts to access the Document_Explorer, THEN THE Document_Explorer SHALL redirect the user to the login page without displaying any document content.
7. WHILE a user with role tenant_admin or cso is using the Document_Explorer, THE Document_Explorer SHALL display all documents within that user's tenant regardless of site assignment.

### Requirement 6: Agregación automática de documentos

**User Story:** Como Audit_User, quiero que todos los documentos generados por la plataforma aparezcan automáticamente en el explorador, para no tener que subir o vincular documentos manualmente.

#### Acceptance Criteria

1. WHEN a new report is generated in the platform, THE Document_Explorer SHALL include that report in the Reports folder within 30 seconds.
2. WHEN a form response is submitted, THE Document_Explorer SHALL include the form submission in the Forms folder within 30 seconds.
3. WHEN a certification document is uploaded, THE Document_Explorer SHALL include that document in the Certifications folder within 30 seconds.
4. WHEN an incident report is created, THE Document_Explorer SHALL include that report in the Incidents folder within 30 seconds.
5. WHEN safety evidence is uploaded, THE Document_Explorer SHALL include that evidence in the Safety Evidence folder within 30 seconds.
6. THE Document_Explorer SHALL allow the Audit_User to select a folder organization mode: either `{Category}/{Site Name}/{Year}/{Month}` or `{Category}/{Year}/{Month}/{Site Name}`, where Year and Month correspond to the document creation date.
9. WHEN the Audit_User changes the folder organization mode, THE Document_Explorer SHALL reorganize the folder view according to the selected mode and persist the preference for future sessions.
7. IF the automatic aggregation of a Document fails, THEN THE Document_Explorer SHALL retry the aggregation up to 3 times with a 10-second interval between attempts and, if all retries fail, log the failure with the document identifier and error reason.
8. IF a Document with the same identifier already exists in the target folder, THEN THE Document_Explorer SHALL skip the duplicate insertion and preserve the existing document.

### Requirement 7: Metadata y trazabilidad para auditoría

**User Story:** Como Audit_User, quiero ver metadata detallada de cada documento, para poder demostrar la integridad y trazabilidad durante auditorías.

#### Acceptance Criteria

1. WHEN the Audit_User views the details of a Document, THE Document_Explorer SHALL display the creation timestamp in ISO 8601 format with timezone, the creator user, the associated site, the document type, and the file hash computed using SHA-256.
2. THE Document_Explorer SHALL display the total document count and last-updated timestamp in ISO 8601 format with timezone for each Folder.
3. WHEN the Audit_User downloads a Document, THE Document_Explorer SHALL log the download event with the user identity, timestamp in ISO 8601 format with timezone, and document identifier, and SHALL retain the log entry for a minimum of 365 days.
4. IF the Document_Explorer cannot retrieve or compute the metadata for a Document, THEN THE Document_Explorer SHALL display an indication that the metadata is unavailable for each missing field while still displaying any metadata fields that are available.
5. WHEN the Audit_User requests integrity verification of a Document, THE Document_Explorer SHALL compute the current SHA-256 hash of the stored file and display whether it matches the hash recorded at upload time.
