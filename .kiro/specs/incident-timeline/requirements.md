# Documento de Requisitos

## Introducción

Módulo de Línea de Tiempo de Incidentes para ClearSite que permite vincular formularios y documentos relacionados (investigaciones, acciones correctivas, inspecciones, etc.) a un incidente existente, y visualizar todas estas relaciones en una línea de tiempo cronológica. Esta funcionalidad extiende el módulo de incidentes existente, proporcionando trazabilidad completa del ciclo de vida de un incidente y todos los documentos generados a partir de este.

El módulo se integra con el sistema de formularios dinámicos existente (Forms) y con el módulo de reportes de incidentes, permitiendo que los usuarios vinculen respuestas de formularios ya completados o creen nuevas respuestas directamente desde el contexto de un incidente.

### Alcance de la Primera Versión

**Incluye:** Vinculación de respuestas de formularios a incidentes, visualización de documentos vinculados en línea de tiempo cronológica, creación de vínculos desde el detalle del incidente, desvinculación de documentos, filtrado de la línea de tiempo por tipo de documento, vista resumida de documentos vinculados.

**No incluye:** Vinculación automática basada en reglas, flujos de aprobación para vínculos, vinculación de documentos externos (fuera de ClearSite), notificaciones automáticas por nuevos vínculos, vinculación entre incidentes.

## Glosario

- **Incident_Timeline_System**: Subsistema del módulo de incidentes responsable de gestionar los vínculos entre incidentes y documentos relacionados, y de presentar la línea de tiempo de documentos vinculados
- **Linked_Document**: Registro que representa la relación entre un Incident_Report y una Form_Response, incluyendo metadatos del vínculo como fecha de vinculación, usuario que creó el vínculo, y categoría del documento
- **Form_Response**: Respuesta completada de un formulario dinámico en el sistema de formularios de ClearSite, identificada por un response_id y un folio único
- **Document_Category**: Clasificación del tipo de documento vinculado al incidente: investigación, acción correctiva, inspección, declaración de testigo, reporte de seguimiento, otro
- **Incident_Report**: Reporte digital de un evento de seguridad registrado en el módulo de incidentes existente
- **Timeline_Entry**: Elemento individual en la línea de tiempo que representa un documento vinculado o un evento del incidente, mostrado en orden cronológico
- **Safety_Supervisor**: Usuario con rol supervisor o cso que gestiona incidentes y vincula documentos de seguimiento
- **Company_Administrator**: Usuario con rol tenant_admin que configura permisos y administra la organización
- **Link_Audit_Record**: Registro inmutable en la línea de tiempo que documenta la creación o eliminación de un vínculo entre incidente y documento

## Requisitos

### Requisito 1: Vinculación de Formularios a Incidentes

**Historia de Usuario:** Como Safety_Supervisor, quiero vincular respuestas de formularios completados a un incidente existente, para que toda la documentación relacionada con un evento de seguridad esté centralizada y sea trazable.

#### Criterios de Aceptación

1. WHEN el Safety_Supervisor selecciona vincular un documento desde la vista de detalle del Incident_Report, THE Incident_Timeline_System SHALL presentar una lista de Form_Response disponibles filtradas por el tenant_id del usuario
2. WHEN el Safety_Supervisor confirma la vinculación de una Form_Response a un Incident_Report, THE Incident_Timeline_System SHALL crear un registro Linked_Document con: incident_id, response_id, form_id, document_category seleccionada, user_id del creador del vínculo, y timestamp de vinculación en formato UTC
3. WHEN el Incident_Timeline_System crea un Linked_Document, THE Incident_Timeline_System SHALL registrar un Link_Audit_Record con la acción "document_linked", el identificador del usuario, el response_id vinculado, y el timestamp en UTC
4. IF el Safety_Supervisor intenta vincular una Form_Response que ya está vinculada al mismo Incident_Report, THEN THE Incident_Timeline_System SHALL rechazar la operación y retornar un mensaje indicando que el documento ya está vinculado a este incidente
5. THE Incident_Timeline_System SHALL requerir la selección de una Document_Category al momento de crear el vínculo

### Requisito 2: Categorías de Documentos Vinculados

**Historia de Usuario:** Como Safety_Supervisor, quiero clasificar cada documento vinculado por categoría, para que la organización pueda identificar rápidamente el tipo de documentación asociada a cada incidente.

#### Criterios de Aceptación

1. THE Incident_Timeline_System SHALL soportar las siguientes Document_Category: investigación, acción correctiva, inspección, declaración de testigo, reporte de seguimiento, otro
2. WHEN el Safety_Supervisor selecciona la categoría "otro", THE Incident_Timeline_System SHALL requerir una descripción textual de la categoría personalizada con una longitud mínima de 5 caracteres y máxima de 100 caracteres
3. WHEN el Safety_Supervisor vincula un documento, THE Incident_Timeline_System SHALL permitir agregar una nota opcional de contexto con longitud máxima de 500 caracteres que describa la relevancia del documento para el incidente

### Requisito 3: Línea de Tiempo de Documentos Vinculados

**Historia de Usuario:** Como Safety_Supervisor, quiero visualizar todos los documentos vinculados a un incidente en una línea de tiempo cronológica, para que pueda entender la secuencia completa de documentación generada a partir del evento.

#### Criterios de Aceptación

1. WHEN el Safety_Supervisor accede a la vista de línea de tiempo de un Incident_Report, THE Incident_Timeline_System SHALL presentar todos los Linked_Document en orden cronológico descendente basado en la fecha de envío de la Form_Response (submitted_at)
2. THE Incident_Timeline_System SHALL mostrar para cada Timeline_Entry: nombre del formulario origen, folio de la respuesta, Document_Category con indicador visual de color, fecha de envío de la respuesta, usuario que completó la respuesta, y usuario que creó el vínculo
3. WHEN el Safety_Supervisor selecciona un Timeline_Entry, THE Incident_Timeline_System SHALL navegar a la vista de detalle de la Form_Response correspondiente
4. THE Incident_Timeline_System SHALL mostrar la cantidad total de documentos vinculados como indicador numérico en la pestaña de línea de tiempo del Incident_Report

### Requisito 4: Filtrado de la Línea de Tiempo

**Historia de Usuario:** Como Safety_Supervisor, quiero filtrar la línea de tiempo por categoría de documento, para que pueda encontrar rápidamente documentación específica cuando un incidente tiene múltiples documentos vinculados.

#### Criterios de Aceptación

1. WHEN el Safety_Supervisor aplica un filtro de Document_Category en la línea de tiempo, THE Incident_Timeline_System SHALL mostrar únicamente los Timeline_Entry que correspondan a la categoría seleccionada
2. THE Incident_Timeline_System SHALL permitir seleccionar múltiples Document_Category como filtro simultáneo
3. WHEN el Safety_Supervisor limpia los filtros, THE Incident_Timeline_System SHALL mostrar todos los Timeline_Entry sin restricción de categoría
4. THE Incident_Timeline_System SHALL mostrar el conteo de resultados filtrados cuando un filtro está activo

### Requisito 5: Desvinculación de Documentos

**Historia de Usuario:** Como Safety_Supervisor, quiero desvincular un documento de un incidente cuando fue asociado por error, para que la línea de tiempo refleje únicamente la documentación relevante.

#### Criterios de Aceptación

1. WHEN el Safety_Supervisor solicita desvincular un Linked_Document de un Incident_Report, THE Incident_Timeline_System SHALL requerir una justificación textual con longitud mínima de 10 caracteres
2. WHEN el Incident_Timeline_System elimina un vínculo, THE Incident_Timeline_System SHALL registrar un Link_Audit_Record con la acción "document_unlinked", el identificador del usuario, el response_id desvinculado, la justificación proporcionada, y el timestamp en UTC
3. WHEN un Linked_Document es desvinculado, THE Incident_Timeline_System SHALL remover el Timeline_Entry de la vista de línea de tiempo
4. THE Incident_Timeline_System SHALL preservar el Link_Audit_Record de la vinculación original como registro histórico inmutable

### Requisito 6: Búsqueda de Formularios para Vincular

**Historia de Usuario:** Como Safety_Supervisor, quiero buscar formularios completados por nombre, folio, o fecha, para que pueda encontrar rápidamente el documento que necesito vincular al incidente.

#### Criterios de Aceptación

1. WHEN el Safety_Supervisor ingresa un término de búsqueda en el selector de formularios, THE Incident_Timeline_System SHALL filtrar las Form_Response disponibles por coincidencia parcial en: nombre del formulario, folio de la respuesta, o nombre del usuario que completó la respuesta
2. THE Incident_Timeline_System SHALL permitir filtrar las Form_Response disponibles por rango de fechas de envío
3. WHEN el Incident_Timeline_System presenta los resultados de búsqueda, THE Incident_Timeline_System SHALL mostrar para cada Form_Response: nombre del formulario, folio, fecha de envío, y nombre del usuario que la completó
4. THE Incident_Timeline_System SHALL paginar los resultados de búsqueda con un máximo de 20 elementos por página

### Requisito 7: Vista Combinada de Línea de Tiempo

**Historia de Usuario:** Como Safety_Supervisor, quiero ver los documentos vinculados integrados con los eventos existentes de la auditoría del incidente, para que tenga una vista completa y unificada de toda la actividad del caso.

#### Criterios de Aceptación

1. THE Incident_Timeline_System SHALL ofrecer un modo de vista combinada que integre los Timeline_Entry de documentos vinculados con los eventos existentes del audit trail del incidente (cambios de estado, comentarios, evidencia adjunta) en un único flujo cronológico
2. THE Incident_Timeline_System SHALL diferenciar visualmente los Timeline_Entry de documentos vinculados de los eventos del audit trail mediante íconos y colores distintos por tipo de entrada
3. WHEN el Safety_Supervisor alterna entre vista combinada y vista de solo documentos, THE Incident_Timeline_System SHALL preservar los filtros activos de Document_Category

### Requisito 8: Control de Acceso para Vínculos

**Historia de Usuario:** Como Company_Administrator, quiero que la vinculación y desvinculación de documentos respete los permisos existentes del módulo de incidentes, para que solo usuarios autorizados modifiquen las relaciones entre documentos e incidentes.

#### Criterios de Aceptación

1. THE Incident_Timeline_System SHALL permitir crear vínculos únicamente a usuarios con rol tenant_admin, site_admin, supervisor, o cso que tengan acceso al Incident_Report según las reglas del Requisito 21 del módulo de incidentes
2. THE Incident_Timeline_System SHALL permitir desvincular documentos únicamente a usuarios con rol tenant_admin o cso
3. THE Incident_Timeline_System SHALL permitir la visualización de la línea de tiempo de documentos a todos los usuarios que tengan acceso de lectura al Incident_Report
4. IF un usuario sin permisos suficientes intenta crear o eliminar un vínculo, THEN THE Incident_Timeline_System SHALL denegar la operación con código HTTP 403 y retornar un mensaje indicando permisos insuficientes

### Requisito 9: Indicador de Documentos en Vista de Lista

**Historia de Usuario:** Como Safety_Supervisor, quiero ver un indicador de documentos vinculados en la lista de incidentes, para que pueda identificar rápidamente qué incidentes tienen documentación asociada sin entrar al detalle.

#### Criterios de Aceptación

1. WHEN el Safety_Supervisor consulta la lista de incidentes, THE Incident_Timeline_System SHALL mostrar un indicador numérico junto a cada Incident_Report que indique la cantidad de Linked_Document activos
2. WHEN un Incident_Report no tiene documentos vinculados, THE Incident_Timeline_System SHALL omitir el indicador numérico para ese incidente
3. THE Incident_Timeline_System SHALL actualizar el indicador numérico cuando un documento es vinculado o desvinculado

