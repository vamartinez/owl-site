# AI Construction Compliance Platform

Plataforma de cumplimiento regulatorio para operaciones de construcción en British Columbia. Unifica validación de identidad y acceso de trabajadores, gestión de certificaciones, análisis visual de seguridad con IA, y decisiones de cumplimiento con explicabilidad de grado auditoría.

## Requisitos Previos

- **Node.js** >= 20.0.0
- **pnpm** >= 9.0.0 (`npm install -g pnpm`)
- **AWS CLI** configurado con credenciales válidas (para despliegue)
- **AWS CDK CLI** (`npm install -g aws-cdk`)

## Instalación

```bash
# Clonar el repositorio
git clone https://github.com/victormartinez/site-macaron.git
cd site-macaron

# Instalar todas las dependencias
pnpm install
```

## Estructura del Proyecto

```
site-macaron/
├── packages/
│   ├── backend/          # Servicios Lambda + Infraestructura CDK
│   ├── admin-portal/     # SPA React (portal de administración)
│   └── landing-page/     # Sitio estático (página de marketing)
├── .github/workflows/    # CI/CD con GitHub Actions
└── package.json          # Configuración del workspace
```

---

## Ver el Sitio Funcionando (Desarrollo Local)

### Admin Portal (puerto 3000)

```bash
pnpm dev:portal
```

Abre http://localhost:3000 en tu navegador. Verás el portal de administración con:
- Dashboard ejecutivo
- Gestión de trabajadores y certificaciones
- Control de acceso a sitios
- Análisis de seguridad con IA
- Reportes y auditoría

### Landing Page (puerto 5173)

```bash
pnpm dev:landing
```

Abre http://localhost:5173 en tu navegador. Verás la página de marketing con:
- Hero section
- Features
- Pricing
- Testimonials
- Formulario de contacto (envía a POST /leads)

---

## Ejecutar Tests

```bash
# Todos los tests del proyecto
pnpm test

# Solo tests del backend (740 tests)
pnpm --filter backend test

# Tests en modo watch
pnpm --filter backend test:watch

# Tests de propiedades (fast-check)
pnpm test:properties
```

---

## Build de Producción

```bash
# Backend (bundles de Lambda con esbuild)
pnpm build:backend
pnpm deploy:dev
# Admin Portal (build estático optimizado)
pnpm build:portal

# Landing Page (build estático optimizado)
pnpm build:landing
```

Los archivos de producción se generan en:
- Backend: `packages/backend/dist/`
- Admin Portal: `packages/admin-portal/dist/`
- Landing Page: `packages/landing-page/dist/`

---

## Despliegue en AWS

### 1. Configurar AWS CLI

```bash
aws configure
# Ingresa tu Access Key ID, Secret Access Key, región (us-west-2), y formato (json)
```

### 2. Bootstrap CDK (solo la primera vez)

```bash
cd packages/backend
npx cdk bootstrap aws://699499736404/us-west-2
```

### 3. Sintetizar CloudFormation (verificar antes de desplegar)

```bash
pnpm --filter backend synth
```

Esto genera las plantillas en `packages/backend/cdk.out/`. Revisa que todo se vea correcto.

### 4. Desplegar al ambiente de desarrollo

```bash
pnpm deploy:dev
```

Esto despliega todos los stacks:
- **ComplianceDataStack** — Tablas DynamoDB (26 tablas)
- **ComplianceAuthStack** — Cognito User Pool + Authorizer
- **ComplianceEventsStack** — Colas SQS + Tópicos SNS
- **ComplianceStorageStack** — Buckets S3 (media + audit)
- **ComplianceApiStack** — API Gateway + Lambdas (11 servicios)
- **ComplianceMonitoringStack** — CloudWatch alarms + dashboards

### 5. Desplegar al ambiente de producción

```bash
pnpm deploy:prod
```

### 6. Desplegar el Admin Portal y Landing Page

Los sitios estáticos se despliegan automáticamente con el HostingStack (S3 + CloudFront):

```bash
# Build de producción primero
pnpm build:portal
pnpm build:landing

# Desplegar todo (incluye el HostingStack que sube los archivos)
pnpm deploy:dev
```

Al finalizar, CDK muestra las URLs en los outputs:

```
dev-ComplianceHostingStack.AdminPortalURL = https://d1234abcdef.cloudfront.net
dev-ComplianceHostingStack.LandingPageURL = https://d5678ghijkl.cloudfront.net
```

---

## Variables de Entorno

### Backend (configuradas automáticamente por CDK)

| Variable | Descripción |
|----------|-------------|
| `ENVIRONMENT` | `dev` o `prod` |
| `TABLE_PREFIX` | Prefijo para tablas DynamoDB (`dev-` o `prod-`) |
| `SNS_TOPIC_ARN` | ARN del tópico SNS principal |
| `SQS_QUEUE_URL` | URL de la cola SQS del pipeline AI |
| `MEDIA_BUCKET_NAME` | Nombre del bucket S3 para media |
| `AI_PIPELINE_QUEUE_URL` | URL de la cola SQS para análisis AI |

Todas las variables se inyectan automáticamente en las Lambdas por CDK. No necesitas configurar nada manualmente.

---

## Lint

```bash
pnpm lint
```

---

## Arquitectura

- **Compute**: AWS Lambda (Node.js 20)
- **API**: AWS API Gateway REST
- **Auth**: AWS Cognito (JWT, MFA)
- **Base de datos**: DynamoDB (26 tablas, on-demand)
- **Storage**: S3 (media + audit)
- **Eventos**: SNS + SQS (at-least-once delivery)
- **IA**: AWS Bedrock (Claude 3.5 Sonnet con visión)
- **Notificaciones**: SES (email) + SNS (SMS)
- **Frontend**: React 18 + Tailwind CSS + Vite
- **CI/CD**: GitHub Actions

---

## Comandos Útiles

| Comando | Descripción |
|---------|-------------|
| `pnpm dev:portal` | Inicia el Admin Portal en modo desarrollo |
| `pnpm dev:landing` | Inicia la Landing Page en modo desarrollo |
| `pnpm test` | Ejecuta todos los tests |
| `pnpm lint` | Ejecuta el linter en todo el proyecto |
| `pnpm build:backend` | Compila los handlers de Lambda |
| `pnpm build:portal` | Build de producción del Admin Portal |
| `pnpm build:landing` | Build de producción de la Landing Page |
| `pnpm deploy:dev` | Despliega infraestructura a ambiente dev |
| `pnpm deploy:prod` | Despliega infraestructura a ambiente prod |
