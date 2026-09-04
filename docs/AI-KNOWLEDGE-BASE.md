# Knowledge Base — Carga de Documentos para la AI

## Resumen

El módulo de AI Report Validation usa un **Knowledge Base** en AWS Bedrock para validar reportes de construcción contra regulaciones de BC. Para que la AI pueda evaluar cumplimiento, necesita documentos de referencia (leyes, códigos, estándares) cargados en el Knowledge Base.

## Acceso

- **URL**: `/knowledge-base` en el admin portal
- **Roles autorizados**: Solo `tenant_admin` y `platform_admin`
- **Endpoint API**: `POST /report-validation/kb/documents`

## Categorías de Documentos

| Categoría | Descripción | Prefijo S3 |
|-----------|-------------|------------|
| `worksafebc` | WorkSafeBC OHS Regulation | `worksafebc/` |
| `bc-building-code` | BC Building Code | `bc-building-code/` |
| `safety-standards` | Construction Safety Standards | `safety-standards/` |
| `canada-general` | Canada General | `canada-general/` |

## Restricciones de Archivo

| Parámetro | Valor |
|-----------|-------|
| Formatos aceptados | PDF (`.pdf`), Word (`.docx`) |
| Tamaño máximo | 50 MB |
| Tamaño mínimo | > 0 bytes |

## Cómo Cargar un Documento

### Desde el Admin Portal (UI)

1. Navegar a **Knowledge Base** en el sidebar (requiere rol `tenant_admin`)
2. Click en **"Upload Document"**
3. Seleccionar el archivo PDF o .docx
4. Elegir la **categoría** correspondiente
5. Click en **"Upload"**
6. Esperar a que el status cambie de `pending` → `indexed`

### Desde la API (programático)

```bash
# 1. Obtener presigned URL
curl -X POST https://<API_URL>/report-validation/kb/documents \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "file_name": "worksafebc-ohs-2024.pdf",
    "file_size": 2500000,
    "mime_type": "application/pdf",
    "category": "worksafebc"
  }'

# Response:
# {
#   "document_id": "01HWXYZ...",
#   "upload_url": "https://s3.amazonaws.com/...",
#   "s3_key": "worksafebc/01HWXYZ.../worksafebc-ohs-2024.pdf",
#   "sync_status": "pending"
# }

# 2. Subir el archivo al presigned URL
curl -X PUT "<upload_url>" \
  -H "Content-Type: application/pdf" \
  --data-binary @worksafebc-ohs-2024.pdf
```

## Flujo de Sincronización

```
Upload → S3 bucket (kb-context-documents) → StartIngestionJob → Bedrock KB indexa el documento
```

1. El archivo se sube a S3 con key: `{category}/{document_id}/{file_name}`
2. Se dispara un `StartIngestionJob` en Bedrock para sincronizar el Knowledge Base
3. El status del documento pasa por: `pending` → `indexed` (o `error`)

## Estados de Sincronización

| Status | Significado |
|--------|-------------|
| `pending` | Documento subido, esperando indexación por Bedrock |
| `indexed` | Documento indexado y disponible para consultas RAG |
| `error` | Error durante la sincronización (revisar logs) |

## Documentos Recomendados para Cargar

Para que la AI valide correctamente reportes de construcción en BC, cargar:

1. **WorkSafeBC OHS Regulation** (categoría: `worksafebc`)
   - Occupational Health and Safety Regulation
   - Workers Compensation Act (Part 3)
   - Políticas de WorkSafeBC relevantes

2. **BC Building Code** (categoría: `bc-building-code`)
   - BC Building Code 2024
   - BC Fire Code
   - Secciones específicas del proyecto

3. **Safety Standards** (categoría: `safety-standards`)
   - CSA Z462 (Electrical Safety)
   - CSA Z259 (Fall Protection)
   - ANSI/ASSP estándares aplicables

4. **Regulaciones Federales** (categoría: `canada-general`)
   - Canada Labour Code Part II
   - WHMIS 2015 requirements
   - Transportation of Dangerous Goods

## Eliminar un Documento

- Desde la UI: Click en el ícono de basura (🗑️) junto al documento → Confirmar
- Desde la API: `DELETE /report-validation/kb/documents/{document_id}`
- Al eliminar, se dispara un re-sync automático del Knowledge Base

## Listar Documentos

```bash
curl -X GET https://<API_URL>/report-validation/kb/documents \
  -H "Authorization: Bearer <TOKEN>"
```

## Troubleshooting

| Problema | Causa | Solución |
|----------|-------|----------|
| Status queda en `pending` | Ingestion job lento o sin iniciar | Esperar 5-10 min. Si persiste, verificar `KNOWLEDGE_BASE_ID` y `DATA_SOURCE_ID` en env vars |
| Status `error` | Fallo en indexación | Revisar CloudWatch logs del servicio. Verificar que el PDF no esté corrupto o protegido con password |
| 403 al cargar | Rol insuficiente | Solo `tenant_admin` puede gestionar KB. Verificar `custom:role` en Cognito |
| Archivo rechazado | Formato o tamaño inválido | Solo PDF/.docx, máximo 50 MB |

## Variables de Entorno Requeridas

```
KB_DOCUMENTS_BUCKET=<nombre-del-bucket-s3>
KNOWLEDGE_BASE_ID=<id-del-knowledge-base-bedrock>
DATA_SOURCE_ID=<id-del-data-source-bedrock>
```

## Arquitectura

```
Admin Portal (UI)
    ↓ POST /kb/documents
API Gateway + Cognito Auth
    ↓
report-validation-service Lambda
    ↓ presigned URL
S3 (kb-context-documents bucket)
    ↓ StartIngestionJob
Bedrock Knowledge Base (S3 Vectors)
    ↓ indexed
Available for RetrieveAndGenerate (RAG) queries
```
