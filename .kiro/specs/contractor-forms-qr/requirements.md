# Requirements Document

## Introduction

Esta funcionalidad permite a las empresas usuarias de Sytedocs crear formularios digitales y generar códigos QR asociados, para que los contratistas puedan escanear el QR, abrir el formulario desde su dispositivo móvil o desktop, y completarlo de manera simple desde el navegador. El objetivo es reducir fricción en la captura de información en terreno, facilitar cumplimiento operativo y centralizar la recolección de datos mediante formularios accesibles por QR. La solución se integra con la arquitectura existente de TypeScript Lambda + DynamoDB en backend y React + TanStack Query en el portal administrativo.

## Glossary

- **Sistema_Formularios**: El módulo backend (Lambda + DynamoDB) responsable de la gestión del ciclo de vida de formularios, generación de URLs y códigos QR, y almacenamiento de respuestas
- **Portal_Admin**: La aplicación frontend React utilizada por administradores de empresa para crear, editar, publicar formularios, generar QR y consultar respuestas
- **Vista_Publica**: La interfaz web pública mobile-first que renderiza un formulario publicado para que el contratista lo complete
- **Generador_QR**: El componente del sistema responsable de crear códigos QR a partir de la URL pública de un formulario publicado
- **Formulario**: Una entidad que define una estructura de campos configurables para capturar información de contratistas
- **Formulario_Borrador**: Un formulario en estado de edición que no es accesible por contratistas
- **Formulario_Publicado**: Un formulario que ha pasado validaciones mínimas y está disponible para recibir respuestas mediante su URL pública
- **Version_Formulario**: Una instantánea inmutable del esquema de campos de un formulario en un momento dado, que preserva la integridad de respuestas históricas
- **Respuesta**: El conjunto de datos enviados por un contratista al completar un formulario publicado
- **Token_Publico**: Un identificador único no predecible (UUID v4) que forma parte de la URL pública del formulario
- **Administrador_Empresa**: Usuario con rol `tenant_admin` o `site_admin` que crea, edita, publica formularios y consulta respuestas
- **Contratista**: Usuario externo que accede al formulario mediante QR o URL directa y lo completa sin autenticación en el sistema
- **Supervisor**: Usuario con rol `supervisor` que consulta respuestas enviadas y monitorea cumplimiento operativo
- **Registro_Auditoria**: Entrada en el log de auditoría que registra acciones relevantes con actor, timestamp y metadatos

## Requirements

### Requirement 1: Crear formulario

**User Story:** Como Administrador_Empresa, quiero crear un formulario nuevo con nombre, descripción y campos configurables, para estandarizar la captura de datos de contratistas.

#### Acceptance Criteria

1. WHEN el Administrador_Empresa envía una solicitud de creación con nombre válido, THE Sistema_Formularios SHALL crear un Formulario con estado "borrador", asignar un identificador único, registrar fecha de creación (UTC) y asociar el autor y el tenant del solicitante
2. THE Sistema_Formularios SHALL requerir un nombre de formulario con longitud entre 3 y 200 caracteres, que contenga al menos un carácter no-espacio
3. IF el nombre del formulario no cumple las restricciones de longitud o contenido, THEN THE Sistema_Formularios SHALL rechazar la solicitud y devolver un mensaje de error indicando la restricción incumplida
4. WHERE el Administrador_Empresa proporciona una descripción, THE Sistema_Formularios SHALL almacenarla con un máximo de 1000 caracteres
5. IF el Administrador_Empresa no tiene rol `tenant_admin` ni `site_admin`, THEN THE Sistema_Formularios SHALL rechazar la solicitud con error de autorización
6. WHEN la creación es exitosa, THE Sistema_Formularios SHALL registrar un Registro_Auditoria con acción "formulario_creado"
7. IF ya existe un Formulario con el mismo nombre dentro del mismo tenant, THEN THE Sistema_Formularios SHALL rechazar la solicitud y devolver un mensaje de error indicando que el nombre ya está en uso

### Requirement 2: Configurar campos del formulario

**User Story:** Como Administrador_Empresa, quiero agregar y configurar campos dinámicos en un formulario, para definir exactamente qué información necesito capturar de los contratistas.

#### Acceptance Criteria

1. THE Sistema_Formularios SHALL soportar los siguientes tipos de campo: texto_corto, texto_largo, numero, fecha, seleccion_simple, seleccion_multiple, checkbox_aceptacion y carga_archivo, con un máximo de 50 campos por formulario
2. WHEN el Administrador_Empresa agrega un campo, THE Sistema_Formularios SHALL requerir una etiqueta visible con longitud entre 1 y 200 caracteres
3. WHEN el Administrador_Empresa configura un campo como obligatorio, THE Sistema_Formularios SHALL almacenar el indicador de obligatoriedad en el esquema del campo
4. THE Sistema_Formularios SHALL permitir configurar texto de ayuda opcional (máximo 500 caracteres), placeholder (máximo 200 caracteres) y orden de visualización (valor entero desde 1 hasta el número total de campos) para cada campo
5. IF el tipo de campo es seleccion_simple o seleccion_multiple, THEN THE Sistema_Formularios SHALL requerir entre 2 y 50 opciones configuradas, cada opción con una etiqueta de entre 1 y 200 caracteres
6. WHEN el Administrador_Empresa configura reglas de validación para un campo numérico, THE Sistema_Formularios SHALL almacenar valores mínimo y máximo dentro del rango -999999999 a 999999999, y WHEN configura reglas para un campo de texto, THE Sistema_Formularios SHALL almacenar longitud mínima (0 o mayor), longitud máxima (hasta 10000 caracteres) y patrón de formato como expresión regular
7. WHEN el Administrador_Empresa reordena campos, THE Sistema_Formularios SHALL actualizar el orden de visualización de todos los campos afectados manteniendo valores consecutivos sin duplicados
8. IF el Administrador_Empresa intenta agregar un campo que excede el límite de 50 campos por formulario, THEN THE Sistema_Formularios SHALL rechazar la operación y mostrar un mensaje de error indicando que se alcanzó el límite máximo de campos
9. IF el Administrador_Empresa intenta guardar una configuración de campo con datos inválidos (etiqueta vacía, opciones insuficientes en campos de selección, o valores de validación fuera de rango), THEN THE Sistema_Formularios SHALL rechazar la operación e indicar cada campo con error y la razón específica de rechazo

### Requirement 3: Guardar formulario en borrador

**User Story:** Como Administrador_Empresa, quiero guardar formularios en estado borrador, para poder trabajar en ellos progresivamente sin exponerlos a contratistas.

#### Acceptance Criteria

1. WHEN el Administrador_Empresa guarda cambios en un Formulario_Borrador, THE Sistema_Formularios SHALL persistir los cambios incluyendo nombre, descripción y configuración de campos, y actualizar la fecha de última modificación dentro de los 5 segundos posteriores a la solicitud
2. WHILE un formulario está en estado "borrador", THE Vista_Publica SHALL rechazar cualquier intento de acceso con un mensaje indicando que el formulario no está disponible, sin revelar la existencia del contenido del formulario
3. THE Sistema_Formularios SHALL permitir guardar un formulario en borrador sin campos configurados
4. WHEN se guardan cambios en un borrador, THE Sistema_Formularios SHALL registrar un Registro_Auditoria con acción "formulario_editado"
5. IF el Administrador_Empresa intenta guardar cambios en un formulario que no está en estado "borrador", THEN THE Sistema_Formularios SHALL rechazar la operación con un mensaje de error indicando que solo formularios en estado borrador pueden ser guardados mediante esta operación
6. IF la operación de guardado falla por error del servidor o indisponibilidad del almacenamiento, THEN THE Sistema_Formularios SHALL retornar un error indicando que los cambios no fueron persistidos y no SHALL modificar la fecha de última modificación ni el contenido previo del formulario
7. IF el Administrador_Empresa no tiene rol `tenant_admin` ni `site_admin`, THEN THE Sistema_Formularios SHALL rechazar la solicitud de guardado con error de autorización

### Requirement 4: Editar formulario borrador

**User Story:** Como Administrador_Empresa, quiero editar un formulario en borrador antes de publicarlo, para corregir campos, textos y configuraciones.

#### Acceptance Criteria

1. WHEN el Administrador_Empresa solicita editar un Formulario_Borrador, THE Portal_Admin SHALL cargar el formulario con todos sus campos y configuraciones actuales en un máximo de 3 segundos desde la solicitud
2. THE Sistema_Formularios SHALL permitir modificar nombre (máximo 200 caracteres), descripción (máximo 1000 caracteres) y configuración de campos (etiqueta, tipo de campo, obligatoriedad y orden) en un Formulario_Borrador
3. THE Sistema_Formularios SHALL permitir agregar, eliminar y reordenar campos en un Formulario_Borrador, hasta un máximo de 50 campos por formulario
4. IF el Administrador_Empresa no es propietario del formulario ni tiene rol `tenant_admin`, THEN THE Sistema_Formularios SHALL rechazar la edición y retornar un error de autorización
5. WHEN el Administrador_Empresa guarda los cambios de un Formulario_Borrador, THE Sistema_Formularios SHALL persistir todas las modificaciones y confirmar el guardado exitoso al usuario en un máximo de 3 segundos
6. IF el Administrador_Empresa intenta guardar un Formulario_Borrador que ya no se encuentra en estado borrador, THEN THE Sistema_Formularios SHALL rechazar el guardado y retornar un error indicando que el formulario ya no es editable
7. IF el nombre del formulario está vacío o excede 200 caracteres, o la descripción excede 1000 caracteres, THEN THE Sistema_Formularios SHALL rechazar el guardado e indicar los campos que no cumplen la validación

### Requirement 5: Duplicar formulario

**User Story:** Como Administrador_Empresa, quiero duplicar un formulario existente, para reutilizar estructuras similares sin recrear campos manualmente.

#### Acceptance Criteria

1. WHEN el Administrador_Empresa solicita duplicar un formulario, THE Sistema_Formularios SHALL crear un nuevo Formulario_Borrador copiando todos los campos con sus propiedades (tipo, etiqueta, obligatoriedad, texto de ayuda, placeholder, orden de visualización, opciones y reglas de validación) sin copiar Token_Publico, versiones, respuestas ni fechas del formulario original
2. THE Sistema_Formularios SHALL asignar al formulario duplicado un nombre compuesto por el nombre original con el sufijo " (copia)", truncando el nombre original si es necesario para que el nombre resultante no exceda 200 caracteres, y un identificador único nuevo
3. THE Sistema_Formularios SHALL establecer el estado del formulario duplicado como "borrador" independientemente del estado del formulario original
4. WHEN la duplicación es exitosa, THE Sistema_Formularios SHALL registrar un Registro_Auditoria con acción "formulario_duplicado" incluyendo el identificador del formulario original como metadato
5. WHEN el Administrador_Empresa no tiene rol `tenant_admin` ni `site_admin`, THE Sistema_Formularios SHALL rechazar la solicitud de duplicación con error de autorización
6. IF el formulario a duplicar no existe, THEN THE Sistema_Formularios SHALL rechazar la solicitud con un error indicando que el formulario no fue encontrado

### Requirement 6: Publicar formulario

**User Story:** Como Administrador_Empresa, quiero publicar un formulario validado, para que los contratistas puedan acceder a él y completarlo.

#### Acceptance Criteria

1. WHEN el Administrador_Empresa solicita publicar un formulario en estado "borrador", THE Sistema_Formularios SHALL validar que el formulario tiene nombre con longitud entre 3 y 200 caracteres, al menos un campo configurado, cada campo tiene una etiqueta de 1 a 200 caracteres, y los campos de tipo seleccion_simple o seleccion_multiple tienen al menos 2 opciones configuradas
2. IF el formulario no cumple las validaciones mínimas de publicación, THEN THE Sistema_Formularios SHALL rechazar la publicación y retornar una lista de errores donde cada error identifica el campo afectado y la regla de validación incumplida
3. IF el formulario no se encuentra en estado "borrador", THEN THE Sistema_Formularios SHALL rechazar la solicitud de publicación con un error indicando el estado actual del formulario
4. WHEN la publicación es exitosa, THE Sistema_Formularios SHALL cambiar el estado a "publicado", generar un Token_Publico único (UUID v4), crear una Version_Formulario inmutable que capture el esquema completo de campos y sus configuraciones vigentes al momento de la publicación, y registrar la fecha de publicación en formato ISO 8601
5. WHEN la publicación es exitosa, THE Sistema_Formularios SHALL registrar un Registro_Auditoria con acción "formulario_publicado"
6. THE Sistema_Formularios SHALL generar la URL pública con formato /forms/{token_publico} utilizando un UUID v4 como Token_Publico
7. IF el Administrador_Empresa no tiene rol `tenant_admin` ni `site_admin`, THEN THE Sistema_Formularios SHALL rechazar la solicitud de publicación con error de autorización

### Requirement 7: Despublicar formulario

**User Story:** Como Administrador_Empresa, quiero despublicar un formulario, para controlar su disponibilidad y dejar de aceptar respuestas.

#### Acceptance Criteria

1. WHEN el Administrador_Empresa solicita despublicar un Formulario_Publicado, THE Sistema_Formularios SHALL cambiar el estado del formulario a "despublicado" y rechazar cualquier nueva respuesta recibida a partir de ese momento, dentro de los 5 segundos posteriores a la solicitud
2. IF el Administrador_Empresa solicita despublicar un formulario que no se encuentra en estado "publicado", THEN THE Sistema_Formularios SHALL rechazar la operación y mostrar un mensaje de error indicando el estado actual del formulario y que solo formularios publicados pueden ser despublicados
3. WHILE un formulario está en estado "despublicado", THE Vista_Publica SHALL mostrar un mensaje indicando que el formulario ya no está disponible y no SHALL presentar campos de entrada ni botón de envío
4. WHEN la despublicación es exitosa, THE Sistema_Formularios SHALL registrar un Registro_Auditoria con acción "formulario_despublicado", incluyendo el identificador del formulario, el identificador del Administrador_Empresa que ejecutó la acción, y la fecha y hora en formato UTC
5. THE Sistema_Formularios SHALL preservar todas las respuestas históricas asociadas al formulario despublicado, manteniéndolas accesibles para consulta por el Administrador_Empresa
6. IF existen respuestas en progreso al momento de la despublicación (enviadas pero no confirmadas), THEN THE Sistema_Formularios SHALL permitir completar las respuestas que fueron iniciadas antes del cambio de estado y rechazar únicamente los nuevos intentos de acceso al formulario

### Requirement 8: Generar código QR

**User Story:** Como Administrador_Empresa, quiero generar un código QR para un formulario publicado, para compartirlo fácilmente en sitio, correo o impresos.

#### Acceptance Criteria

1. WHEN un formulario se publica exitosamente, THE Generador_QR SHALL generar automáticamente un código QR que codifica la URL pública absoluta del formulario dentro de los 5 segundos posteriores a la publicación
2. WHILE un formulario tiene estado "publicado" o "despublicado" y posee un código QR generado, THE Portal_Admin SHALL mostrar el código QR en pantalla dentro de la vista de detalle del formulario
3. THE Portal_Admin SHALL permitir descargar el código QR como imagen en formato PNG con resolución mínima de 300x300 píxeles
4. WHEN la URL pública de un formulario cambia por republicación, THE Generador_QR SHALL regenerar el código QR con la nueva URL dentro de los 5 segundos posteriores a la republicación
5. WHEN el Administrador_Empresa descarga el QR, THE Sistema_Formularios SHALL registrar un Registro_Auditoria con acción "qr_descargado"
6. IF la generación del código QR falla por error interno del Generador_QR, THEN THE Sistema_Formularios SHALL completar la publicación del formulario, registrar el error y mostrar un mensaje al Administrador_Empresa indicando que el QR no pudo generarse y que puede reintentar la generación manualmente
7. WHILE un formulario está en estado "borrador", THE Portal_Admin SHALL no mostrar ni ofrecer descarga de código QR en la vista de detalle del formulario

### Requirement 9: Acceso al formulario por contratistas

**User Story:** Como Contratista, quiero escanear un QR o abrir una URL y ver el formulario inmediatamente en mi teléfono, para completarlo sin buscar enlaces manualmente.

#### Acceptance Criteria

1. WHEN el Contratista accede a la URL pública de un Formulario_Publicado, THE Vista_Publica SHALL renderizar el nombre del formulario, descripción (si existe), campos en el orden de visualización configurado y botón de envío
2. THE Vista_Publica SHALL renderizar con diseño mobile-first responsivo que funcione en iOS Safari (últimas 2 versiones), Android Chrome (últimas 2 versiones), y las últimas 2 versiones de Chrome, Firefox, Safari y Edge en desktop
3. THE Vista_Publica SHALL alcanzar Time to Interactive en menos de 3 segundos en una conexión de red móvil 3G o superior
4. WHEN el Contratista accede a una URL con Token_Publico inexistente, THE Vista_Publica SHALL mostrar un mensaje de error indicando que el formulario no fue encontrado
5. WHEN el Contratista intenta enviar el formulario o abandona un campo obligatorio sin completarlo, THE Vista_Publica SHALL mostrar un mensaje de validación en español junto a cada campo que no cumpla las reglas configuradas, indicando específicamente qué regla no se cumple
6. THE Vista_Publica SHALL no requerir autenticación ni registro para acceder al formulario
7. IF la Vista_Publica no puede obtener los datos del formulario del servidor dentro de 10 segundos o recibe un error de red, THEN THE Vista_Publica SHALL mostrar un mensaje de error indicando que no se pudo cargar el formulario y ofrecer la opción de reintentar la carga
8. THE Vista_Publica SHALL ser operativa sin scroll horizontal en viewports desde 320px de ancho en adelante

### Requirement 10: Validación de campos en formulario público

**User Story:** Como Contratista, quiero recibir validaciones claras cuando falten campos requeridos o los datos sean inválidos, para corregir antes de enviar.

#### Acceptance Criteria

1. WHEN el Contratista intenta enviar el formulario con campos obligatorios vacíos, THE Vista_Publica SHALL mostrar un mensaje de error junto a cada campo obligatorio faltante indicando el nombre del campo y que es requerido, mostrando todos los errores de validación simultáneamente
2. WHEN un campo numérico tiene valor fuera del rango configurado (mínimo/máximo), THE Vista_Publica SHALL mostrar un mensaje junto al campo indicando los valores mínimo y máximo permitidos según la configuración del campo
3. WHEN un campo de texto excede la longitud máxima configurada, THE Vista_Publica SHALL mostrar un mensaje junto al campo indicando la longitud máxima permitida y la longitud actual ingresada
4. WHEN un campo de carga_archivo recibe un archivo que excede 10 MB o no es de tipo permitido (PDF, JPEG, PNG), THE Vista_Publica SHALL mostrar un mensaje de error junto al campo indicando el tamaño máximo de 10 MB y los tipos de archivo permitidos
5. WHEN un campo de tipo fecha contiene un valor con formato inválido o una fecha fuera del rango configurado, THE Vista_Publica SHALL mostrar un mensaje junto al campo indicando el formato esperado o el rango de fechas permitido
6. WHEN el Contratista interactúa con un campo y el valor ingresado no cumple las reglas de validación configuradas, THE Vista_Publica SHALL mostrar el mensaje de error correspondiente en no más de 500 milisegundos sin requerir envío del formulario
7. THE Sistema_Formularios SHALL ejecutar validaciones en el servidor independientemente de las validaciones del cliente, aplicando las mismas reglas definidas en el esquema del formulario
8. IF la validación del servidor detecta errores en los datos enviados, THEN THE Sistema_Formularios SHALL rechazar el envío, retornar la lista de campos inválidos con sus mensajes de error, y THE Vista_Publica SHALL mostrar los errores retornados junto a cada campo correspondiente preservando todos los datos ingresados por el Contratista

### Requirement 11: Envío de respuestas

**User Story:** Como Contratista, quiero enviar mis respuestas y recibir confirmación, para saber que mi información fue registrada correctamente.

#### Acceptance Criteria

1. WHEN el Contratista envía un formulario con datos válidos, THE Sistema_Formularios SHALL crear una Respuesta con identificador único, formulario asociado, versión del formulario, fecha y hora de envío (UTC, formato ISO 8601), y datos capturados por campo, y SHALL retornar confirmación al cliente en no más de 5 segundos desde la recepción de la solicitud
2. WHEN el Sistema_Formularios crea una Respuesta, THE Sistema_Formularios SHALL registrar metadatos de la respuesta incluyendo tipo de origen (QR o URL directa) y user_agent del navegador (máximo 500 caracteres)
3. WHEN el envío es exitoso, THE Vista_Publica SHALL mostrar una pantalla de confirmación con mensaje de éxito y un folio de referencia único alfanumérico de 8 caracteres
4. IF el envío falla por error del servidor o el servidor no responde dentro de 10 segundos, THEN THE Vista_Publica SHALL mostrar un mensaje de error indicando que el envío no pudo completarse y SHALL permitir reintentar hasta 3 veces sin perder los datos ingresados en el formulario
5. WHEN el formulario incluye campo de carga_archivo con archivo adjunto, THE Sistema_Formularios SHALL validar que el archivo no exceda 10 MB y sea de tipo PDF, JPEG o PNG, almacenar el archivo y asociarlo a la Respuesta
6. WHEN el envío es exitoso, THE Sistema_Formularios SHALL registrar un Registro_Auditoria con acción "respuesta_enviada"
7. IF la entrada recibida contiene caracteres o patrones potencialmente peligrosos (HTML, scripts, inyección SQL), THEN THE Sistema_Formularios SHALL sanitizar la entrada removiendo o escapando dichos patrones antes de almacenarla, sin rechazar la solicitud si los datos restantes son válidos
8. IF el Contratista envía una respuesta a un formulario cuyo estado cambió a "despublicado" después de que el Contratista cargó la página, THEN THE Sistema_Formularios SHALL rechazar el envío y THE Vista_Publica SHALL mostrar un mensaje indicando que el formulario ya no está disponible para recibir respuestas
9. IF la validación del servidor detecta datos inválidos según las reglas configuradas del formulario, THEN THE Sistema_Formularios SHALL rechazar el envío y retornar los errores específicos por campo para que THE Vista_Publica los muestre al Contratista sin perder los datos ingresados

### Requirement 12: Consulta de respuestas

**User Story:** Como Supervisor, quiero consultar respuestas filtradas por formulario, fecha y estado, para revisar cumplimiento operativo de contratistas.

#### Acceptance Criteria

1. WHEN el Supervisor accede al módulo de respuestas, THE Portal_Admin SHALL mostrar la lista de respuestas con formulario asociado, fecha de envío, folio de referencia y estado de la respuesta, cargando los resultados dentro de 3 segundos desde la solicitud
2. THE Portal_Admin SHALL permitir filtrar respuestas por formulario, rango de fechas (con un rango máximo de 365 días), estado de la respuesta y contratista
3. WHEN el Supervisor selecciona una respuesta, THE Portal_Admin SHALL mostrar el detalle con todos los campos del formulario y sus valores enviados, la fecha de envío, el contratista asociado y el estado, cargando el detalle dentro de 3 segundos desde la selección
4. IF el usuario no tiene rol `platform_admin`, `tenant_admin`, `site_admin`, `cso` ni `supervisor`, THEN THE Sistema_Formularios SHALL rechazar la consulta y retornar un error indicando que el usuario no tiene permisos suficientes para consultar respuestas
5. THE Portal_Admin SHALL paginar los resultados mostrando un máximo de 25 respuestas por página
6. IF los filtros aplicados no retornan resultados, THEN THE Portal_Admin SHALL mostrar un mensaje indicando que no se encontraron respuestas para los criterios seleccionados y mantener los filtros activos para que el usuario pueda ajustarlos

### Requirement 13: Exportar respuestas a CSV

**User Story:** Como Administrador_Empresa, quiero exportar respuestas a formato CSV, para analizar datos en herramientas externas como hojas de cálculo.

#### Acceptance Criteria

1. WHEN el Administrador_Empresa solicita exportar respuestas de un formulario, THE Sistema_Formularios SHALL generar un archivo CSV codificado en UTF-8 con BOM, con una fila por respuesta y una columna por campo del formulario, y entregar el archivo para descarga dentro de los 30 segundos posteriores a la solicitud
2. THE Sistema_Formularios SHALL incluir en el CSV las columnas: folio, fecha_envio (en formato ISO 8601), y cada campo del formulario como columna separada, donde los campos de selección múltiple se representan con valores separados por punto y coma dentro de la misma celda
3. WHEN el formulario tiene múltiples versiones, THE Sistema_Formularios SHALL unificar las columnas de todas las versiones en un solo CSV, incluyendo todas las columnas de todas las versiones y dejando las celdas vacías para las respuestas donde el campo no existía en la versión correspondiente
4. IF el Administrador_Empresa no tiene rol `tenant_admin` ni `site_admin`, THEN THE Sistema_Formularios SHALL rechazar la exportación con un mensaje de error indicando autorización insuficiente
5. IF el formulario solicitado no tiene respuestas registradas, THEN THE Sistema_Formularios SHALL generar un archivo CSV que contenga únicamente la fila de encabezados con los nombres de las columnas y ninguna fila de datos
6. IF la generación del archivo CSV falla por un error interno o por tiempo de espera excedido, THEN THE Sistema_Formularios SHALL notificar al Administrador_Empresa con un mensaje de error indicando que la exportación no pudo completarse y no entregar ningún archivo parcial

### Requirement 14: Versionado de formularios

**User Story:** Como Administrador_Empresa, quiero que el sistema preserve la integridad de respuestas históricas cuando edito un formulario publicado, para no corromper datos ya capturados.

#### Acceptance Criteria

1. WHEN el Administrador_Empresa edita un Formulario_Publicado, THE Sistema_Formularios SHALL crear una nueva Version_Formulario con el esquema actualizado y mantener la versión anterior inmutable dentro de los 5 segundos posteriores a la confirmación de la edición
2. THE Sistema_Formularios SHALL asociar cada Respuesta a la Version_Formulario vigente al momento del envío
3. WHEN se crea una nueva versión, THE Sistema_Formularios SHALL incrementar el número de versión secuencialmente comenzando en 1 para cada Formulario_Publicado
4. THE Sistema_Formularios SHALL permitir consultar respuestas históricas renderizadas con el esquema de la versión con la que fueron enviadas, retornando los resultados dentro de 10 segundos para conjuntos de hasta 10,000 respuestas
5. IF la URL pública del formulario cambia al publicar una nueva versión, THEN THE Generador_QR SHALL regenerar el código QR apuntando a la nueva URL dentro de los 5 segundos posteriores a la publicación
6. IF un usuario o proceso intenta modificar o eliminar una Version_Formulario que ya tiene Respuestas asociadas, THEN THE Sistema_Formularios SHALL rechazar la operación y retornar un mensaje de error indicando que la versión es inmutable debido a respuestas existentes
7. IF la creación de una nueva Version_Formulario falla, THEN THE Sistema_Formularios SHALL mantener la versión anterior activa sin modificaciones, no publicar la versión fallida, y notificar al Administrador_Empresa con un mensaje de error indicando la causa del fallo

### Requirement 15: Protección contra abuso

**User Story:** Como Administrador_Empresa, quiero que el sistema proteja los formularios públicos contra envíos abusivos, para mantener la integridad de los datos recolectados.

#### Acceptance Criteria

1. THE Sistema_Formularios SHALL aplicar rate limiting de máximo 10 envíos por dirección IP por formulario en un periodo de 5 minutos
2. IF un Contratista excede el límite de envíos, THEN THE Vista_Publica SHALL mostrar un mensaje indicando que debe esperar antes de enviar nuevamente, incluyendo el tiempo restante de espera en minutos
3. THE Sistema_Formularios SHALL validar y sanitizar toda entrada para prevenir inyección de código, XSS y SQL injection, removiendo o escapando patrones peligrosos antes del almacenamiento
4. THE Sistema_Formularios SHALL rechazar archivos adjuntos que excedan 10 MB por archivo y retornar un error indicando el tamaño máximo permitido
5. THE Sistema_Formularios SHALL implementar protección contra bots mediante validación de headers y detección de patrones de envío automatizado

### Requirement 16: Registro de auditoría

**User Story:** Como Administrador_Empresa, quiero que todas las acciones relevantes queden registradas con trazabilidad completa, para cumplir con políticas de auditoría y seguridad.

#### Acceptance Criteria

1. THE Sistema_Formularios SHALL registrar un Registro_Auditoria para cada una de las siguientes acciones: creación de formulario, edición de formulario, publicación, despublicación, generación de QR, descarga de QR y envío de respuesta
2. THE Sistema_Formularios SHALL incluir en cada Registro_Auditoria: tipo de entidad, identificador de entidad, acción realizada, identificador del actor, timestamp en formato ISO 8601 con zona horaria UTC, y metadatos de contexto que incluyan como mínimo la dirección IP de origen y el identificador del formulario afectado
3. WHEN la acción es realizada por un Contratista (envío de respuesta), THE Sistema_Formularios SHALL registrar como actor el identificador de la respuesta en lugar de un usuario autenticado
4. THE Sistema_Formularios SHALL almacenar los registros de auditoría de forma inmutable, no permitir su modificación ni eliminación por usuarios del sistema, y retenerlos por un mínimo de 365 días desde su fecha de creación
5. IF el Sistema_Formularios no puede persistir un Registro_Auditoria, THEN THE Sistema_Formularios SHALL rechazar la acción original que generó el registro y retornar un error indicando que la operación no pudo completarse
6. WHEN el Administrador_Empresa consulta el registro de auditoría de un formulario, THE Sistema_Formularios SHALL retornar los registros ordenados por timestamp descendente, filtrados por el identificador de entidad solicitado, con un máximo de 50 registros por página
