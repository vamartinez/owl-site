# Roles y Permisos

## Roles del Sistema

| Rol | Descripción |
|-----|-------------|
| `platform_admin` | Administrador de la plataforma. Acceso total a todas las funcionalidades y configuraciones. |
| `tenant_admin` | Administrador del tenant (empresa). Gestiona usuarios, sitios, políticas y reportes de su organización. |
| `site_admin` | Administrador de sitio. Gestiona trabajadores, acceso y cumplimiento de un sitio específico. |
| `supervisor` | Supervisor de obra. Revisa hallazgos de seguridad, sube evidencia y consulta reportes. |
| `cso` | Chief Safety Officer. Revisa hallazgos de seguridad, exporta reportes y monitorea cumplimiento. |
| `gate_operator` | Operador de puerta. Gestiona el acceso de trabajadores al sitio (check-in/check-out). |
| `worker` | Trabajador. Solo puede ver su propio dashboard con estado de elegibilidad. |

---

## Matriz de Permisos por Rol

### Dashboard

| Acción | platform_admin | tenant_admin | site_admin | supervisor | cso | gate_operator | worker |
|--------|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Ver dashboard | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

### Trabajadores

| Acción | platform_admin | tenant_admin | site_admin | supervisor | cso | gate_operator | worker |
|--------|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Ver trabajadores | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| Crear trabajadores | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Editar trabajadores | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Eliminar trabajadores | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

### Certificaciones

| Acción | platform_admin | tenant_admin | site_admin | supervisor | cso | gate_operator | worker |
|--------|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Ver certificaciones | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| Validar certificaciones | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |

### Sitios

| Acción | platform_admin | tenant_admin | site_admin | supervisor | cso | gate_operator | worker |
|--------|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Ver sitios | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| Crear sitios | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Editar sitios | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Eliminar sitios | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

### Control de Acceso al Sitio

| Acción | platform_admin | tenant_admin | site_admin | supervisor | cso | gate_operator | worker |
|--------|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Ver acceso | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| Gestionar acceso (check-in/out) | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ |

### Contratistas

| Acción | platform_admin | tenant_admin | site_admin | supervisor | cso | gate_operator | worker |
|--------|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Ver contratistas | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Crear contratistas | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Editar contratistas | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |

### Seguridad IA (Safety AI)

| Acción | platform_admin | tenant_admin | site_admin | supervisor | cso | gate_operator | worker |
|--------|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Ver hallazgos | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| Revisar hallazgos (confirmar/rechazar) | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| Subir evidencia (fotos) | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |

### Reportes

| Acción | platform_admin | tenant_admin | site_admin | supervisor | cso | gate_operator | worker |
|--------|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Ver reportes | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| Exportar reportes (PDF/CSV) | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ |

### Administración

| Acción | platform_admin | tenant_admin | site_admin | supervisor | cso | gate_operator | worker |
|--------|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Ver panel de admin | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Gestionar usuarios | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Asignar roles | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Configuración del tenant | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

---

## Visibilidad de Explicabilidad (Decisiones de Cumplimiento)

Cuando un usuario consulta una decisión de cumplimiento, la información visible depende de su rol:

| Rol | Información visible |
|-----|---------------------|
| `worker` / `gate_operator` | Solo razones y acciones requeridas |
| `supervisor` | Razones + referencias a reglas aplicadas |
| `platform_admin` / `tenant_admin` / `site_admin` / `cso` | Payload completo (razones, reglas, evidencia, versiones de política) |

---

## Cómo Asignar un Rol a un Usuario

### Vía AWS CLI (Cognito)

```bash
aws cognito-idp admin-update-user-attributes \
  --user-pool-id TU_USER_POOL_ID \
  --username usuario@email.com \
  --user-attributes Name=custom:role,Value=tenant_admin
```

### Roles válidos para `custom:role`:

- `platform_admin`
- `tenant_admin`
- `site_admin`
- `supervisor`
- `cso`
- `gate_operator`
- `worker`

### Atributos personalizados requeridos en Cognito:

| Atributo | Descripción | Ejemplo |
|----------|-------------|---------|
| `custom:role` | Rol del usuario | `tenant_admin` |
| `custom:tenant_id` | ID del tenant al que pertenece | `tenant-abc123` |
| `custom:assigned_sites` | Sitios asignados (separados por coma) | `site-1,site-2` |

---

## Crear un Usuario de Prueba

```bash
# Crear usuario
aws cognito-idp admin-create-user \
  --user-pool-id TU_USER_POOL_ID \
  --username admin@tuempresa.com \
  --user-attributes \
    Name=email,Value=admin@tuempresa.com \
    Name=email_verified,Value=true \
    Name=name,Value="Admin Principal" \
    Name=custom:role,Value=platform_admin \
    Name=custom:tenant_id,Value=tenant-001 \
    Name=custom:assigned_sites,Value=site-001

# Establecer contraseña permanente
aws cognito-idp admin-set-user-password \
  --user-pool-id TU_USER_POOL_ID \
  --username admin@tuempresa.com \
  --password "MiPassword123!" \
  --permanent
```
