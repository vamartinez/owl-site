# Manejo de Errores — Criterios de Aceptación

## Resumen

El sistema maneja errores en dos modos:
- **Debug mode** (desarrollo local): Muestra detalles técnicos completos (stack trace, código de error, request/response)
- **User mode** (producción): Muestra mensajes amigables para el usuario final

El modo se determina automáticamente por `import.meta.env.DEV` (true en local, false en build de producción).

---

## Criterios de Aceptación

### 1. Errores de red / API no disponible
- CUANDO una petición al API falla por error de red, ENTONCES se muestra "No se pudo conectar con el servidor. Verifica tu conexión."
- EN DEBUG: se muestra además el URL que falló y el error técnico

### 2. Errores de validación (400)
- CUANDO el servidor responde con 400, ENTONCES se muestran los campos con error resaltados en rojo con el mensaje específico de cada campo
- EN DEBUG: se muestra el body completo de la respuesta

### 3. Errores de autenticación (401)
- CUANDO el servidor responde con 401, ENTONCES se redirige al login con mensaje "Tu sesión ha expirado"
- EN DEBUG: se muestra el token expirado y el timestamp

### 4. Errores de permisos (403)
- CUANDO el servidor responde con 403, ENTONCES se muestra "No tienes permisos para realizar esta acción"
- EN DEBUG: se muestra el permiso requerido y el rol actual

### 5. Recurso no encontrado (404)
- CUANDO el servidor responde con 404, ENTONCES se muestra "El recurso solicitado no existe"
- EN DEBUG: se muestra el path completo

### 6. Errores del servidor (500)
- CUANDO el servidor responde con 500, ENTONCES se muestra "Error del servidor. Intenta de nuevo más tarde."
- EN DEBUG: se muestra el request_id, timestamp y error message del servidor

### 7. Errores de formulario
- CUANDO un campo requerido está vacío al enviar, ENTONCES se muestra "Este campo es requerido" debajo del campo
- CUANDO un campo tiene formato inválido, ENTONCES se muestra el formato esperado (ej: "Formato de email inválido")
- Los errores se limpian al corregir el campo

### 8. Errores en operaciones asíncronas (mutaciones)
- CUANDO una operación de crear/editar/eliminar falla, ENTONCES se muestra un toast/banner de error en la parte superior de la página
- El mensaje persiste hasta que el usuario lo cierre o pase la acción exitosamente
- EN DEBUG: el toast incluye un botón "Ver detalles" que expande la info técnica

### 9. Errores en carga de datos (queries)
- CUANDO una query falla, ENTONCES se muestra un estado de error en el componente con botón "Reintentar"
- No se muestra una página en blanco — siempre hay feedback visual

### 10. Rate limiting (429)
- CUANDO el servidor responde con 429, ENTONCES se muestra "Demasiadas solicitudes. Espera un momento."
