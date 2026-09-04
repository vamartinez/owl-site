# Requirements Document

## Introduction

El Agente de Cumplimiento PDF WorkSafeBC es un componente de la plataforma AI Construction Compliance que permite a los usuarios cargar documentos PDF (planes de seguridad, procedimientos de trabajo, evaluaciones de riesgo, etc.) y recibir un análisis automatizado de cumplimiento contra las regulaciones de WorkSafeBC. El agente extrae el contenido del PDF, lo evalúa contra la base de conocimiento regulatoria de WorkSafeBC, y genera un reporte de retroalimentación detallado identificando brechas de cumplimiento, secciones conformes, y recomendaciones de mejora.

## Glossary

- **Agente_PDF**: El servicio de IA que orquesta la carga, extracción, análisis y generación de reportes de cumplimiento para documentos PDF.
- **Documento_PDF**: Un archivo PDF cargado por el usuario que contiene contenido relacionado con seguridad en construcción (planes de seguridad, procedimientos, evaluaciones de riesgo, formularios de contratistas).
- **Base_Regulatoria_WorkSafeBC**: El conjunto estructurado de regulaciones, estándares y requisitos de WorkSafeBC (OHS Regulation, OHSR Parts) utilizado como referencia para el análisis de cumplimiento.
- **Reporte_Cumplimiento**: El documento generado por el Agente_PDF que contiene los hallazgos del análisis, incluyendo brechas, conformidades y recomendaciones.
- **Hallazgo_Cumplimiento**: Una observación individual dentro del Reporte_Cumplimiento que identifica una brecha, conformidad o área de mejora respecto a una regulación específica.
- **Sesion_Analisis**: El registro de una ejecución completa del análisis de un documento, incluyendo metadatos de entrada, resultados y estado.
- **Extractor_Texto**: El componente que convierte el contenido del PDF en texto estructurado procesable por el modelo de IA.
- **Categoria_Documento**: La clasificación del tipo de documento PDF cargado (plan de seguridad, procedimiento de trabajo seguro, evaluación de riesgo, formulario de contratista, otro).
- **Nivel_Cumplimiento**: La calificación general del documento analizado: conforme, parcialmente_conforme, no_conforme.
- **Admin_Portal**: La interfaz web de administración donde los usuarios con roles autorizados cargan documentos y consultan reportes de cumplimiento.
- **Backend_API**: La capa de servicios API que procesa las solicitudes del Agente_PDF, gestiona el almacenamiento y orquesta el pipeline de análisis.

## Requirements

### Requisito 1: Carga de Documentos PDF

**Historia de Usuario:** Como site_admin, quiero cargar documentos PDF de seguridad a la plataforma, para que el agente de IA los analice contra las regulaciones de WorkSafeBC.

#### Criterios de Aceptación

1. WHEN un usuario con rol platform_admin, site_admin, tenant_admin, supervisor o cso carga un documento PDF, THE Agente_PDF SHALL aceptar el archivo y registrar una Sesion_Analisis con estado "recibido" dentro de 3 segundos de la carga completada.
2. THE Agente_PDF SHALL aceptar documentos PDF con un tamaño máximo de 50 MB y un máximo de 500 páginas.
3. IF un usuario carga un archivo que no es formato PDF válido (archivo sin encabezado PDF válido o cuya estructura no puede ser parseada), THEN THE Agente_PDF SHALL rechazar el archivo y retornar un mensaje de error indicando que solo se aceptan archivos PDF válidos.
4. IF un usuario carga un archivo PDF que excede 50 MB de tamaño o 500 páginas, THEN THE Agente_PDF SHALL rechazar el archivo y retornar un mensaje de error indicando el límite excedido específico (tamaño o páginas).
5. WHEN un documento PDF es aceptado, THE Agente_PDF SHALL solicitar al usuario la selección de una Categoria_Documento de las opciones disponibles: plan de seguridad, procedimiento de trabajo seguro, evaluación de riesgo, formulario de contratista, u otro. La Sesion_Analisis SHALL permanecer en estado "recibido" hasta que el usuario seleccione una categoría, momento en el cual el estado SHALL cambiar a "categorizado".
6. WHEN un documento PDF es aceptado, THE Agente_PDF SHALL almacenar el archivo original en almacenamiento S3 con cifrado en reposo, registrando como metadatos: tenant_id, site_id, usuario que cargó, timestamp de carga, y referencia a la Sesion_Analisis.
7. IF un usuario con rol worker o gate_operator intenta cargar un documento, THEN THE Agente_PDF SHALL denegar la operación y retornar un error indicando permisos insuficientes.
8. IF el almacenamiento S3 no está disponible o la operación de escritura falla durante la carga, THEN THE Agente_PDF SHALL rechazar la carga, no registrar la Sesion_Analisis, y retornar un mensaje de error indicando que el almacenamiento no está disponible temporalmente.

### Requisito 2: Extracción de Contenido del PDF

**Historia de Usuario:** Como tenant_admin, quiero que el sistema extraiga el texto y la estructura del PDF cargado, para que el contenido pueda ser analizado de forma precisa contra las regulaciones.

#### Criterios de Aceptación

1. WHEN una Sesion_Analisis es creada con estado "recibido", THE Extractor_Texto SHALL procesar el documento PDF y extraer el contenido textual dentro de 60 segundos para documentos de hasta 100 páginas, con un máximo de 180 segundos para documentos de 101 a 500 páginas.
2. THE Extractor_Texto SHALL preservar la estructura del documento identificando cada bloque de contenido con un tipo de elemento (título, sección, lista, tabla o párrafo) y manteniendo el orden secuencial de aparición en el documento original.
3. WHEN la extracción se completa exitosamente, THE Extractor_Texto SHALL actualizar la Sesion_Analisis a estado "texto_extraido" y almacenar el texto estructurado resultante.
4. IF el documento PDF contiene páginas escaneadas (imágenes sin texto seleccionable), THEN THE Extractor_Texto SHALL aplicar reconocimiento óptico de caracteres (OCR) para extraer el texto de dichas páginas, y SHALL considerar una página como no procesable si el porcentaje de confianza del OCR para esa página es inferior a 30%.
5. IF el Extractor_Texto no puede extraer texto de más del 50% de las páginas del documento, THEN THE Extractor_Texto SHALL marcar la Sesion_Analisis con estado "extraccion_fallida" y notificar al usuario que el documento no pudo ser procesado, indicando el porcentaje de páginas no procesables.
6. THE Extractor_Texto SHALL registrar métricas de extracción incluyendo: número de páginas procesadas, número de páginas con OCR aplicado, y porcentaje de confianza promedio del texto extraído (valor entre 0 y 100).
7. IF el documento PDF está protegido por contraseña o cifrado, THEN THE Extractor_Texto SHALL marcar la Sesion_Analisis con estado "extraccion_fallida" y notificar al usuario que el documento no pudo ser procesado por estar protegido.
8. IF el documento PDF excede las 500 páginas, THEN THE Extractor_Texto SHALL rechazar el procesamiento, marcar la Sesion_Analisis con estado "extraccion_fallida" y notificar al usuario que el documento excede el límite máximo de 500 páginas.

### Requisito 3: Análisis de Cumplimiento contra Regulaciones WorkSafeBC

**Historia de Usuario:** Como cso, quiero que el agente de IA analice el contenido del documento contra las regulaciones de WorkSafeBC, para identificar brechas de cumplimiento y áreas conformes.

#### Criterios de Aceptación

1. WHEN la Sesion_Analisis alcanza estado "texto_extraido", THE Agente_PDF SHALL iniciar el análisis de cumplimiento evaluando el contenido contra la Base_Regulatoria_WorkSafeBC dentro de 120 segundos para documentos de hasta 100 páginas, escalando linealmente hasta un máximo de 300 segundos para documentos de hasta 250 páginas.
2. THE Agente_PDF SHALL evaluar el contenido del documento contra las secciones aplicables del OHS Regulation de WorkSafeBC, seleccionando las partes regulatorias relevantes según la Categoria_Documento y el contenido detectado.
3. WHEN el análisis identifica una brecha de cumplimiento, THE Agente_PDF SHALL generar un Hallazgo_Cumplimiento con: tipo "brecha", referencia regulatoria específica (parte, sección y cláusula del OHS Regulation), descripción de la brecha (máximo 500 caracteres), sección del documento donde se detectó, y severidad (crítica, alta, media, baja).
4. WHEN el análisis identifica una sección conforme, THE Agente_PDF SHALL generar un Hallazgo_Cumplimiento con: tipo "conforme", referencia regulatoria específica, y sección del documento que satisface el requisito.
5. THE Agente_PDF SHALL clasificar la severidad de cada brecha según el potencial de daño: crítica (riesgo inminente de fatalidad o lesión permanente), alta (riesgo de lesión grave), media (incumplimiento regulatorio sin riesgo inmediato de lesión), baja (desviación procedimental sin riesgo directo).
6. WHEN el análisis se completa exitosamente, THE Agente_PDF SHALL asignar un Nivel_Cumplimiento general al documento: conforme (sin brechas de severidad crítica o alta), parcialmente_conforme (al menos una brecha alta pero ninguna crítica), no_conforme (al menos una brecha crítica), y SHALL actualizar la Sesion_Analisis al estado "analisis_completado".
7. IF la Base_Regulatoria_WorkSafeBC no está disponible o no contiene regulaciones aplicables a la Categoria_Documento, THEN THE Agente_PDF SHALL marcar la Sesion_Analisis con estado "analisis_fallido" y retornar un error indicando que no se encontraron regulaciones aplicables.
8. THE Agente_PDF SHALL registrar la versión del modelo de IA utilizado y la versión de la Base_Regulatoria_WorkSafeBC consultada para cada Sesion_Analisis.
9. IF el análisis excede el tiempo máximo permitido o falla durante el procesamiento por un error interno, THEN THE Agente_PDF SHALL marcar la Sesion_Analisis con estado "analisis_fallido", descartar cualquier hallazgo parcial generado, y retornar un error indicando la causa de la falla (timeout o error de procesamiento).
10. IF el documento no contiene contenido evaluable contra ninguna regulación de la Base_Regulatoria_WorkSafeBC según su Categoria_Documento, THEN THE Agente_PDF SHALL asignar Nivel_Cumplimiento "no_evaluable", registrar cero Hallazgo_Cumplimiento, y actualizar la Sesion_Analisis al estado "analisis_completado" con una indicación de que el contenido no es evaluable contra las regulaciones disponibles.

### Requisito 4: Generación del Reporte de Cumplimiento

**Historia de Usuario:** Como site_admin, quiero recibir un reporte estructurado con los hallazgos del análisis, para tomar acciones correctivas basadas en referencias regulatorias específicas.

#### Criterios de Aceptación

1. WHEN el análisis de cumplimiento se completa exitosamente, THE Agente_PDF SHALL generar un Reporte_Cumplimiento dentro de 30 segundos de la finalización del análisis.
2. THE Reporte_Cumplimiento SHALL contener: resumen ejecutivo (máximo 1000 caracteres), Nivel_Cumplimiento general (uno de: conforme, parcialmente_conforme, no_conforme), conteo de hallazgos por tipo (brecha, observación, recomendación) y severidad (crítica, alta, media, baja), lista detallada de Hallazgos_Cumplimiento (máximo 200 hallazgos) ordenados por severidad descendente, y recomendaciones de mejora (máximo 50 recomendaciones totales).
3. THE Agente_PDF SHALL generar al menos una y no más de 3 recomendaciones de mejora (máximo 500 caracteres cada una) por cada Hallazgo_Cumplimiento de tipo "brecha" con severidad crítica o alta, referenciando la acción correctiva sugerida y la regulación aplicable.
4. THE Reporte_Cumplimiento SHALL incluir metadatos de trazabilidad: identificador de Sesion_Analisis, nombre del documento original, Categoria_Documento, fecha y hora del análisis (formato UTC ISO 8601), versión del modelo de IA, y versión de la Base_Regulatoria_WorkSafeBC.
5. THE Agente_PDF SHALL soportar la exportación del Reporte_Cumplimiento en formato PDF y formato JSON estructurado, completando la exportación dentro de 30 segundos de la solicitud.
6. WHEN un usuario solicita el Reporte_Cumplimiento, THE Admin_Portal SHALL presentar los hallazgos con navegación por severidad y tipo, permitiendo filtrar y ordenar los resultados, y SHALL mostrar los resultados dentro de 5 segundos para reportes con hasta 200 hallazgos.
7. IF el análisis no produce hallazgos de ningún tipo, THEN THE Agente_PDF SHALL generar el Reporte_Cumplimiento con Nivel_Cumplimiento "conforme" y una indicación de que no se identificaron brechas regulatorias.
8. IF la generación del Reporte_Cumplimiento falla por indisponibilidad de datos del análisis o error interno del servicio, THEN THE Agente_PDF SHALL registrar el error con el identificador de Sesion_Analisis y SHALL notificar al usuario con un mensaje indicando que el reporte no pudo ser generado y la razón de la falla.
9. THE Agente_PDF SHALL asignar el Nivel_Cumplimiento general según las siguientes reglas: "no_conforme" si existe al menos un hallazgo de tipo brecha con severidad crítica o alta, "parcialmente_conforme" si existen hallazgos de tipo brecha con severidad media o baja sin hallazgos de severidad crítica o alta, y "conforme" si no existen hallazgos de tipo brecha.

### Requisito 5: Gestión del Historial de Análisis

**Historia de Usuario:** Como tenant_admin, quiero consultar el historial de análisis de documentos, para rastrear la evolución del cumplimiento de mi organización a lo largo del tiempo.

#### Criterios de Aceptación

1. THE Agente_PDF SHALL almacenar cada Sesion_Analisis con: identificador único, referencia al documento original, Categoria_Documento, usuario que inició el análisis, tenant, sitio asociado, timestamp de inicio, timestamp de finalización, estado final, y referencia al Reporte_Cumplimiento generado.
2. WHEN un usuario con rol tenant_admin o platform_admin consulta el historial, THE Admin_Portal SHALL presentar las sesiones de análisis del tenant con paginación de 20 elementos por página por defecto (configurable hasta un máximo de 100 por página), ordenadas por timestamp de inicio descendente, con filtros por sitio, categoría de documento, Nivel_Cumplimiento, y rango de fechas, y SHALL retornar los resultados dentro de 5 segundos de la solicitud.
3. WHEN un usuario con rol site_admin, supervisor o cso consulta el historial, THE Admin_Portal SHALL presentar únicamente las sesiones de análisis asociadas a los sitios asignados al usuario, con la misma paginación, ordenamiento y filtros disponibles que para tenant_admin.
4. THE Agente_PDF SHALL retener las Sesiones_Analisis y sus Reportes_Cumplimiento asociados por un mínimo de 7 años o la duración requerida por los requisitos de retención regulatoria de WorkSafeBC, lo que sea mayor.
5. WHEN un usuario solicita re-analizar un documento previamente cargado, THE Agente_PDF SHALL crear una nueva Sesion_Analisis referenciando el documento original y la Sesion_Analisis previa sin modificar sesiones anteriores, y THE Admin_Portal SHALL presentar todas las sesiones vinculadas al mismo documento agrupadas cronológicamente con su respectivo Nivel_Cumplimiento para permitir comparación visual.
6. IF un usuario intenta acceder a una Sesion_Analisis de un tenant diferente, THEN THE Agente_PDF SHALL denegar el acceso y retornar un error indicando acceso prohibido sin revelar la existencia del recurso.
7. IF los filtros aplicados por el usuario no producen resultados, THEN THE Admin_Portal SHALL presentar un estado vacío indicando que no se encontraron sesiones de análisis para los criterios seleccionados y SHALL mantener los filtros activos visibles para que el usuario pueda modificarlos.

### Requisito 6: Procesamiento Asíncrono y Notificaciones

**Historia de Usuario:** Como supervisor, quiero recibir una notificación cuando el análisis de mi documento se complete, para no tener que esperar activamente mientras el agente procesa el PDF.

#### Criterios de Aceptación

1. WHEN un documento PDF es aceptado para análisis, THE Agente_PDF SHALL procesar el análisis de forma asíncrona y retornar al usuario un identificador de Sesion_Analisis con estado "recibido" dentro de 2 segundos desde la aceptación del documento.
2. WHEN la Sesion_Analisis cambia de estado (recibido, texto_extraido, analizando, completado, extraccion_fallida, analisis_fallido), THE Agente_PDF SHALL publicar un evento de cambio de estado en el Event_Bus dentro de 5 segundos del cambio.
3. WHEN la Sesion_Analisis alcanza estado "completado", THE Agente_PDF SHALL notificar al usuario que inició el análisis a través del canal de notificación configurado (email o notificación en la plataforma) dentro de 60 segundos de la finalización.
4. WHILE una Sesion_Analisis se encuentra en un estado de progreso (recibido, texto_extraido, o analizando), THE Admin_Portal SHALL mostrar el estado actual del análisis y una barra de progreso indicando la etapa del pipeline (carga, extracción, análisis, generación de reporte), actualizando la información desplegada dentro de 10 segundos de cada cambio de estado.
5. IF el análisis no se completa dentro de 10 minutos desde el inicio, THEN THE Agente_PDF SHALL marcar la Sesion_Analisis con estado "timeout" y notificar al usuario que el análisis excedió el tiempo máximo permitido.
6. WHEN una Sesion_Analisis falla en cualquier etapa, THE Agente_PDF SHALL notificar al usuario dentro de 60 segundos del fallo con un mensaje indicando la etapa donde ocurrió el fallo y la acción correctiva aplicable: re-intentar el análisis si el fallo fue en extracción o análisis, verificar formato del documento si el fallo fue en carga, o contactar soporte si el fallo persiste tras un re-intento.
7. IF la notificación al usuario no puede ser entregada a través del canal configurado tras 3 intentos con un intervalo de 30 segundos entre cada intento, THEN THE Agente_PDF SHALL registrar el fallo de entrega en el Event_Bus y marcar la notificación como no entregada en la Sesion_Analisis.

### Requisito 7: Base de Conocimiento Regulatoria

**Historia de Usuario:** Como platform_admin, quiero que la base de conocimiento regulatoria de WorkSafeBC sea versionada y actualizable, para que los análisis reflejen las regulaciones vigentes.

#### Criterios de Aceptación

1. THE Base_Regulatoria_WorkSafeBC SHALL contener las regulaciones del Occupational Health and Safety Regulation (OHSR) de WorkSafeBC organizadas por partes, secciones y cláusulas.
2. THE Base_Regulatoria_WorkSafeBC SHALL incluir como mínimo las siguientes partes del OHSR relevantes para construcción: Part 4 (General Conditions), Part 11 (Fall Protection), Part 13 (Ladders, Scaffolds and Temporary Work Platforms), Part 18 (Traffic Control), Part 20 (Construction, Excavation and Demolition), y Part 21 (Blasting Operations).
3. WHEN la Base_Regulatoria_WorkSafeBC es actualizada, THE Platform SHALL crear una nueva versión con un identificador de versión secuencial incremental y una fecha efectiva especificada por el platform_admin, sin modificar versiones anteriores, y SHALL registrar el usuario que publicó la versión y un resumen de cambios de no más de 1000 caracteres.
4. THE Agente_PDF SHALL utilizar la versión más reciente de la Base_Regulatoria_WorkSafeBC cuya fecha efectiva sea igual o anterior a la fecha actual al momento de iniciar cada análisis, y SHALL registrar el identificador de versión utilizada en la Sesion_Analisis.
5. IF una nueva versión de la Base_Regulatoria_WorkSafeBC es publicada mientras un análisis está en progreso, THEN THE Agente_PDF SHALL completar el análisis en curso con la versión que estaba activa al momento de inicio.
6. THE Platform SHALL permitir a usuarios con rol platform_admin cargar actualizaciones a la Base_Regulatoria_WorkSafeBC especificando la fecha efectiva de la nueva versión, donde cada carga debe incluir al menos una cláusula con todos los campos requeridos definidos en el criterio 7, y el contenido total de la carga no debe exceder 50 MB.
7. THE Base_Regulatoria_WorkSafeBC SHALL almacenar para cada cláusula: identificador de parte, sección y cláusula, texto completo de la regulación (máximo 10000 caracteres por cláusula), categorías de aplicabilidad (tipos de trabajo, tipos de documento, máximo 20 categorías por cláusula), y fecha de última actualización.
8. IF un usuario con rol platform_admin intenta cargar una actualización con fecha efectiva anterior a la fecha efectiva de la versión más reciente existente, o con campos requeridos faltantes en alguna cláusula (identificador de parte, sección, cláusula, o texto de regulación), THEN THE Platform SHALL rechazar la carga y retornar un mensaje de error indicando la razón específica del rechazo.
9. IF no existe ninguna versión activa de la Base_Regulatoria_WorkSafeBC al momento de iniciar un análisis, THEN THE Agente_PDF SHALL rechazar el análisis y registrar un error indicando que no hay base regulatoria disponible.

### Requisito 8: Parseo y Serialización del Reporte de Cumplimiento

**Historia de Usuario:** Como desarrollador, quiero que el Reporte de Cumplimiento tenga un formato JSON estructurado con un parser y pretty-printer definidos, para que otros sistemas puedan consumir y generar reportes de forma confiable.

#### Criterios de Aceptación

1. THE Agente_PDF SHALL serializar cada Reporte_Cumplimiento en formato JSON codificado en UTF-8 siguiendo un esquema definido que incluya: metadatos (identificador de Sesion_Analisis, nombre del documento original, Categoria_Documento, fecha y hora del análisis, versión del modelo de IA, versión de la Base_Regulatoria_WorkSafeBC), resumen ejecutivo (string, máximo 1000 caracteres), Nivel_Cumplimiento (enum: conforme, parcialmente_conforme, no_conforme), hallazgos (array de Hallazgo_Cumplimiento, máximo 10000 elementos), y recomendaciones (array de strings, cada una máximo 500 caracteres, máximo 10000 elementos).
2. WHEN un sistema externo envía un documento JSON de hasta 10 MB de tamaño, THE Parser SHALL validar el documento contra el esquema del Reporte_Cumplimiento y retornar un objeto Reporte_Cumplimiento estructurado dentro de 5 segundos.
3. IF un documento JSON no cumple con el esquema del Reporte_Cumplimiento (campos faltantes, tipos incorrectos, valores fuera de rango), THEN THE Parser SHALL retornar un error indicando cada campo con violación, el tipo de error (campo faltante, tipo incorrecto, o valor fuera de rango), y el valor recibido cuando aplique.
4. IF el documento recibido no es JSON sintácticamente válido o excede 10 MB de tamaño, THEN THE Parser SHALL rechazar el documento y retornar un error indicando la causa del rechazo (sintaxis JSON inválida o tamaño excedido) sin intentar validación de esquema.
5. THE Pretty_Printer SHALL formatear objetos Reporte_Cumplimiento en documentos JSON válidos codificados en UTF-8 con indentación de 2 espacios por nivel y campos ordenados alfabéticamente dentro de cada objeto según el esquema definido.
6. THE Pretty_Printer SHALL garantizar que para todo objeto Reporte_Cumplimiento válido, parsear el resultado del Pretty_Printer y luego aplicar el Pretty_Printer nuevamente produce un documento JSON byte-a-byte idéntico al resultado intermedio (propiedad round-trip).
