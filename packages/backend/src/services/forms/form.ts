/**
 * Form CRUD operations for the Forms Service.
 * Handles creation, retrieval, update, and listing of forms.
 *
 * This file implements:
 * - POST /forms (task 3.1)
 * - PATCH /forms/{id} (task 3.3 — form save/edit)
 * - GET /forms/{id} (task 3.1)
 * - GET /forms (task 3.1)
 *
 * Requirements: 1.1-1.7, 2.1-2.9, 3.1, 3.3-3.5, 4.2-4.7
 */

import { GetCommand, PutCommand, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { docClient, getTableName } from '../../shared/dynamo-client.js';
import { createLogger } from '../../shared/logger.js';
import { logAuditEntry } from './audit.js';
import { createFormVersion } from './form-version.js';
import {
  FormStatus,
  FieldType,
  AuditEntityType,
  AuditAction,
  MAX_FIELDS_PER_FORM,
} from './types.js';
import type { Form, FieldConfig, FieldOption, FieldValidation } from './types.js';

const FORMS_TABLE = 'Forms';
const logger = createLogger('forms-crud');

// ─── Zod Schema for Form Creation (task 3.1) ─────────────────────────────────

export const createFormSchema = z.object({
  name: z
    .string()
    .min(3, 'El nombre debe tener al menos 3 caracteres')
    .max(200, 'El nombre no debe exceder 200 caracteres')
    .refine((val) => val.trim().length > 0, 'El nombre debe contener al menos un carácter no-espacio'),
  description: z
    .string()
    .max(1000, 'La descripción no debe exceder 1000 caracteres')
    .optional(),
});

// ─── Validation Types ─────────────────────────────────────────────────────────

export interface ValidationError {
  field: string;
  message: string;
}

export interface UpdateFormInput {
  name?: string;
  description?: string;
  fields?: FieldConfig[];
}

// ─── Valid Field Types ─────────────────────────────────────────────────────────

const VALID_FIELD_TYPES = new Set<string>(Object.values(FieldType));

const SELECTION_FIELD_TYPES = new Set<string>([
  FieldType.SELECCION_SIMPLE,
  FieldType.SELECCION_MULTIPLE,
]);

// ─── Validation Functions ─────────────────────────────────────────────────────

/**
 * Validates the form name.
 * Must be 3-200 characters and contain at least one non-space character.
 */
export function validateName(name: string): ValidationError[] {
  const errors: ValidationError[] = [];

  if (name.length < 3) {
    errors.push({
      field: 'name',
      message: 'El nombre debe tener al menos 3 caracteres',
    });
  } else if (name.length > 200) {
    errors.push({
      field: 'name',
      message: 'El nombre no debe exceder 200 caracteres',
    });
  }

  if (name.trim().length === 0) {
    errors.push({
      field: 'name',
      message: 'El nombre debe contener al menos un carácter no-espacio',
    });
  }

  return errors;
}

/**
 * Validates the form description.
 * Max 1000 characters.
 */
export function validateDescription(description: string): ValidationError[] {
  const errors: ValidationError[] = [];

  if (description.length > 1000) {
    errors.push({
      field: 'description',
      message: 'La descripción no debe exceder 1000 caracteres',
    });
  }

  return errors;
}

/**
 * Validates a single field's options (for selection fields).
 */
function validateFieldOptions(
  fieldIndex: number,
  fieldLabel: string,
  options: FieldOption[] | undefined,
  fieldType: FieldType
): ValidationError[] {
  const errors: ValidationError[] = [];
  const fieldRef = `fields[${fieldIndex}] (${fieldLabel || 'sin etiqueta'})`;

  if (!options || options.length < 2) {
    errors.push({
      field: fieldRef,
      message: `Los campos de tipo ${fieldType} requieren entre 2 y 50 opciones`,
    });
    return errors;
  }

  if (options.length > 50) {
    errors.push({
      field: fieldRef,
      message: `Los campos de tipo ${fieldType} no deben exceder 50 opciones`,
    });
  }

  options.forEach((option, optIndex) => {
    if (!option.label || option.label.length < 1) {
      errors.push({
        field: `${fieldRef}.options[${optIndex}]`,
        message: 'La etiqueta de la opción debe tener al menos 1 carácter',
      });
    } else if (option.label.length > 200) {
      errors.push({
        field: `${fieldRef}.options[${optIndex}]`,
        message: 'La etiqueta de la opción no debe exceder 200 caracteres',
      });
    }
  });

  return errors;
}

/**
 * Validates field validation rules (numeric range, text length).
 */
function validateFieldValidationRules(
  fieldIndex: number,
  fieldLabel: string,
  validation: FieldValidation | undefined,
  fieldType: FieldType
): ValidationError[] {
  const errors: ValidationError[] = [];
  const fieldRef = `fields[${fieldIndex}] (${fieldLabel || 'sin etiqueta'})`;

  if (!validation) return errors;

  const NUMERIC_LIMIT = 999999999;

  // Numeric validation
  if (fieldType === FieldType.NUMERO) {
    if (validation.min_value !== undefined) {
      if (validation.min_value < -NUMERIC_LIMIT || validation.min_value > NUMERIC_LIMIT) {
        errors.push({
          field: `${fieldRef}.validation.min_value`,
          message: `El valor mínimo debe estar entre -${NUMERIC_LIMIT} y ${NUMERIC_LIMIT}`,
        });
      }
    }
    if (validation.max_value !== undefined) {
      if (validation.max_value < -NUMERIC_LIMIT || validation.max_value > NUMERIC_LIMIT) {
        errors.push({
          field: `${fieldRef}.validation.max_value`,
          message: `El valor máximo debe estar entre -${NUMERIC_LIMIT} y ${NUMERIC_LIMIT}`,
        });
      }
    }
    if (
      validation.min_value !== undefined &&
      validation.max_value !== undefined &&
      validation.min_value > validation.max_value
    ) {
      errors.push({
        field: `${fieldRef}.validation`,
        message: 'El valor mínimo no puede ser mayor que el valor máximo',
      });
    }
  }

  // Text validation
  if (fieldType === FieldType.TEXTO_CORTO || fieldType === FieldType.TEXTO_LARGO) {
    if (validation.min_length !== undefined) {
      if (validation.min_length < 0) {
        errors.push({
          field: `${fieldRef}.validation.min_length`,
          message: 'La longitud mínima debe ser 0 o mayor',
        });
      }
    }
    if (validation.max_length !== undefined) {
      if (validation.max_length > 10000) {
        errors.push({
          field: `${fieldRef}.validation.max_length`,
          message: 'La longitud máxima no debe exceder 10000 caracteres',
        });
      }
    }
    if (
      validation.min_length !== undefined &&
      validation.max_length !== undefined &&
      validation.min_length > validation.max_length
    ) {
      errors.push({
        field: `${fieldRef}.validation`,
        message: 'La longitud mínima no puede ser mayor que la longitud máxima',
      });
    }
  }

  return errors;
}

/**
 * Validates a single field configuration.
 */
function validateSingleField(field: FieldConfig, fieldIndex: number): ValidationError[] {
  const errors: ValidationError[] = [];
  const fieldRef = `fields[${fieldIndex}]`;

  // Validate label: 1-200 chars
  if (!field.label || field.label.length < 1) {
    errors.push({
      field: fieldRef,
      message: 'La etiqueta del campo debe tener al menos 1 carácter',
    });
  } else if (field.label.length > 200) {
    errors.push({
      field: fieldRef,
      message: 'La etiqueta del campo no debe exceder 200 caracteres',
    });
  }

  // Validate field type
  if (!VALID_FIELD_TYPES.has(field.type)) {
    errors.push({
      field: fieldRef,
      message: `Tipo de campo inválido: ${field.type}. Tipos válidos: ${Array.from(VALID_FIELD_TYPES).join(', ')}`,
    });
  }

  // Validate options for selection fields
  if (SELECTION_FIELD_TYPES.has(field.type)) {
    errors.push(
      ...validateFieldOptions(fieldIndex, field.label, field.options, field.type as FieldType)
    );
  }

  // Validate placeholder (max 200 chars)
  if (field.placeholder !== undefined && field.placeholder.length > 200) {
    errors.push({
      field: `${fieldRef}.placeholder`,
      message: 'El placeholder no debe exceder 200 caracteres',
    });
  }

  // Validate help_text (max 500 chars)
  if (field.help_text !== undefined && field.help_text.length > 500) {
    errors.push({
      field: `${fieldRef}.help_text`,
      message: 'El texto de ayuda no debe exceder 500 caracteres',
    });
  }

  // Validate validation rules
  if (field.validation) {
    errors.push(
      ...validateFieldValidationRules(fieldIndex, field.label, field.validation, field.type as FieldType)
    );
  }

  return errors;
}

/**
 * Validates the fields array configuration.
 * Returns all validation errors simultaneously (not fail-fast).
 */
export function validateFields(fields: FieldConfig[]): ValidationError[] {
  const errors: ValidationError[] = [];

  // Max 50 fields
  if (fields.length > MAX_FIELDS_PER_FORM) {
    errors.push({
      field: 'fields',
      message: `Se alcanzó el límite máximo de ${MAX_FIELDS_PER_FORM} campos por formulario`,
    });
  }

  // Validate each field
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i]!;
    errors.push(...validateSingleField(field, i));
  }

  return errors;
}

/**
 * Normalizes field order values to be consecutive from 1 to N.
 * Sorts fields by their current order value and reassigns consecutive values.
 */
export function normalizeFieldOrder(fields: FieldConfig[]): FieldConfig[] {
  // Sort by current order value
  const sorted = [...fields].sort((a, b) => a.order - b.order);

  // Reassign consecutive order values from 1 to N
  return sorted.map((field, index) => ({
    ...field,
    order: index + 1,
  }));
}

// ─── DynamoDB Operations ──────────────────────────────────────────────────────

/**
 * Retrieves a form by ID and tenant.
 */
export async function getFormByIdAndTenant(
  tenantId: string,
  formId: string
): Promise<Form | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: getTableName(FORMS_TABLE),
      Key: {
        PK: `TENANT#${tenantId}`,
        SK: `FORM#${formId}`,
      },
    })
  );

  if (!result.Item) {
    return null;
  }

  return result.Item as Form;
}

/**
 * Updates a form in DynamoDB.
 * Only updates provided fields and always updates updated_at.
 */
async function persistFormUpdate(
  tenantId: string,
  formId: string,
  updates: Partial<Pick<Form, 'name' | 'description' | 'fields'>>,
  updatedAt: string
): Promise<Form> {
  const updateExpressions: string[] = ['#updated_at = :updated_at'];
  const expressionAttributeNames: Record<string, string> = {
    '#updated_at': 'updated_at',
  };
  const expressionAttributeValues: Record<string, unknown> = {
    ':updated_at': updatedAt,
  };

  if (updates.name !== undefined) {
    updateExpressions.push('#name = :name');
    expressionAttributeNames['#name'] = 'name';
    expressionAttributeValues[':name'] = updates.name;
  }

  if (updates.description !== undefined) {
    updateExpressions.push('#description = :description');
    expressionAttributeNames['#description'] = 'description';
    expressionAttributeValues[':description'] = updates.description;
  }

  if (updates.fields !== undefined) {
    updateExpressions.push('#fields = :fields');
    expressionAttributeNames['#fields'] = 'fields';
    expressionAttributeValues[':fields'] = updates.fields;
  }

  const result = await docClient.send(
    new UpdateCommand({
      TableName: getTableName(FORMS_TABLE),
      Key: {
        PK: `TENANT#${tenantId}`,
        SK: `FORM#${formId}`,
      },
      UpdateExpression: `SET ${updateExpressions.join(', ')}`,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
      ReturnValues: 'ALL_NEW',
    })
  );

  return result.Attributes as Form;
}

// ─── Create Form (task 3.1) ───────────────────────────────────────────────────

/**
 * Creates a new form.
 */
export async function createForm(
  tenantId: string,
  userId: string,
  input: { name: string; description?: string },
  ipAddress: string
): Promise<Form> {
  const now = new Date().toISOString();
  const formId = uuidv4();

  // Check for duplicate name within tenant
  const existingForms = await docClient.send(
    new QueryCommand({
      TableName: getTableName(FORMS_TABLE),
      KeyConditionExpression: 'PK = :pk',
      FilterExpression: '#name = :name',
      ExpressionAttributeNames: { '#name': 'name' },
      ExpressionAttributeValues: {
        ':pk': `TENANT#${tenantId}`,
        ':name': input.name,
      },
    })
  );

  if (existingForms.Items && existingForms.Items.length > 0) {
    const error = new Error('Ya existe un formulario con ese nombre') as Error & { code: string };
    error.code = 'DUPLICATE_NAME';
    throw error;
  }

  const form: Form = {
    form_id: formId,
    tenant_id: tenantId,
    name: input.name,
    description: input.description,
    status: FormStatus.BORRADOR,
    fields: [],
    author_id: userId,
    created_at: now,
    updated_at: now,
  };

  await docClient.send(
    new PutCommand({
      TableName: getTableName(FORMS_TABLE),
      Item: {
        PK: `TENANT#${tenantId}`,
        SK: `FORM#${formId}`,
        ...form,
      },
    })
  );

  // Log audit entry
  await logAuditEntry({
    entity_type: AuditEntityType.FORMULARIO,
    entity_id: formId,
    action: AuditAction.FORMULARIO_CREADO,
    actor_id: userId,
    ip_address: ipAddress,
    metadata: { name: input.name },
    tenant_id: tenantId,
    form_id: formId,
  });

  logger.info('Form created', { form_id: formId, tenant_id: tenantId });

  return form;
}

// ─── Get Form (task 3.1) ──────────────────────────────────────────────────────

/**
 * Retrieves a form by ID.
 */
export async function getForm(
  tenantId: string,
  formId: string
): Promise<Form | null> {
  return getFormByIdAndTenant(tenantId, formId);
}

// ─── List Forms (task 3.1) ────────────────────────────────────────────────────

/**
 * Lists all forms for a tenant.
 */
export async function listForms(
  tenantId: string
): Promise<{ forms: Form[]; total: number }> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: getTableName(FORMS_TABLE),
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: {
        ':pk': `TENANT#${tenantId}`,
      },
    })
  );

  const forms = (result.Items ?? []) as Form[];
  return { forms, total: forms.length };
}

// ─── Update Form (task 3.3) ───────────────────────────────────────────────────

export interface UpdateFormResult {
  success: true;
  form: Form;
}

export interface UpdateFormError {
  success: false;
  statusCode: number;
  code: string;
  message: string;
  errors?: ValidationError[];
}

/**
 * Updates a form (PATCH /forms/{id}).
 *
 * Validates:
 * - Form exists and belongs to the tenant
 * - Form is in "borrador" state
 * - Name (if provided): 3-200 chars, at least one non-space
 * - Description (if provided): max 1000 chars
 * - Fields (if provided): max 50, valid types, labels, options, validation rules
 *
 * After validation:
 * - Normalizes field order to consecutive values 1..N
 * - Persists changes and updates updated_at
 * - Logs audit entry "formulario_editado"
 *
 * Returns all validation errors simultaneously.
 */
// ─── Duplicate Form (task 3.5) ────────────────────────────────────────────────

export interface DuplicateFormResult {
  success: true;
  form: Form;
}

export interface DuplicateFormError {
  success: false;
  statusCode: number;
  code: string;
  message: string;
}

/**
 * Generates the duplicated form name.
 * Appends " (copia)" to the original name, truncating the original if necessary
 * so the total does not exceed 200 characters.
 */
export function generateDuplicateName(originalName: string): string {
  const suffix = ' (copia)';
  const maxOriginalLength = 200 - suffix.length; // 192 chars max for original

  const truncatedOriginal =
    originalName.length > maxOriginalLength
      ? originalName.substring(0, maxOriginalLength)
      : originalName;

  return `${truncatedOriginal}${suffix}`;
}

/**
 * Duplicates an existing form.
 *
 * - Retrieves the original form
 * - Copies all fields with properties (type, label, required, help_text, placeholder, order, options, validation)
 * - Does NOT copy token_publico, versions, responses, or dates
 * - Sets name to "{original} (copia)" truncated to 200 chars
 * - Sets status to "borrador", assigns new UUID
 * - Logs audit entry "formulario_duplicado" with original form ID in metadata
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.6
 */
export async function duplicateForm(
  tenantId: string,
  formId: string,
  actorId: string,
  ipAddress: string
): Promise<DuplicateFormResult | DuplicateFormError> {
  // 1. Retrieve the original form
  const originalForm = await getFormByIdAndTenant(tenantId, formId);

  if (!originalForm) {
    return {
      success: false,
      statusCode: 404,
      code: 'NOT_FOUND',
      message: 'Formulario no encontrado',
    };
  }

  // 2. Generate the duplicate name
  const duplicateName = generateDuplicateName(originalForm.name);

  // 3. Copy fields with all properties (deep copy to avoid shared references)
  const duplicatedFields: FieldConfig[] = originalForm.fields.map((field) => ({
    field_id: uuidv4(), // New field IDs for the duplicate
    type: field.type,
    label: field.label,
    required: field.required,
    order: field.order,
    ...(field.placeholder !== undefined && { placeholder: field.placeholder }),
    ...(field.help_text !== undefined && { help_text: field.help_text }),
    ...(field.options !== undefined && {
      options: field.options.map((opt) => ({
        option_id: uuidv4(), // New option IDs
        label: opt.label,
      })),
    }),
    ...(field.validation !== undefined && {
      validation: { ...field.validation },
    }),
  }));

  // 4. Create the new form (no token_publico, no versions, no responses, no original dates)
  const now = new Date().toISOString();
  const newFormId = uuidv4();

  const newForm: Form = {
    form_id: newFormId,
    tenant_id: tenantId,
    name: duplicateName,
    description: originalForm.description,
    status: FormStatus.BORRADOR,
    fields: duplicatedFields,
    author_id: actorId,
    created_at: now,
    updated_at: now,
    // Explicitly NOT copying: token_publico, current_version, published_at
  };

  // 5. Persist the new form
  await docClient.send(
    new PutCommand({
      TableName: getTableName(FORMS_TABLE),
      Item: {
        PK: `TENANT#${tenantId}`,
        SK: `FORM#${newFormId}`,
        ...newForm,
      },
    })
  );

  // 6. Log audit entry "formulario_duplicado" with original form ID in metadata
  await logAuditEntry({
    entity_type: AuditEntityType.FORMULARIO,
    entity_id: newFormId,
    action: AuditAction.FORMULARIO_DUPLICADO,
    actor_id: actorId,
    ip_address: ipAddress,
    metadata: {
      original_form_id: formId,
      original_form_name: originalForm.name,
    },
    tenant_id: tenantId,
    form_id: newFormId,
  });

  logger.info('Form duplicated', {
    original_form_id: formId,
    new_form_id: newFormId,
    tenant_id: tenantId,
    actor_id: actorId,
  });

  return {
    success: true,
    form: newForm,
  };
}

// ─── Update Form (task 3.3) ───────────────────────────────────────────────────

export async function updateForm(
  tenantId: string,
  formId: string,
  input: UpdateFormInput,
  actorId: string,
  ipAddress: string
): Promise<UpdateFormResult | UpdateFormError> {
  // 1. Retrieve the form
  const form = await getFormByIdAndTenant(tenantId, formId);

  if (!form) {
    return {
      success: false,
      statusCode: 404,
      code: 'NOT_FOUND',
      message: 'Formulario no encontrado',
    };
  }

  // 2. Validate form is in "borrador" state
  if (form.status !== FormStatus.BORRADOR) {
    return {
      success: false,
      statusCode: 422,
      code: 'UNPROCESSABLE_ENTITY',
      message: 'Solo formularios en estado borrador pueden ser editados',
    };
  }

  // 3. Collect all validation errors simultaneously
  const validationErrors: ValidationError[] = [];

  if (input.name !== undefined) {
    validationErrors.push(...validateName(input.name));
  }

  if (input.description !== undefined) {
    validationErrors.push(...validateDescription(input.description));
  }

  if (input.fields !== undefined) {
    validationErrors.push(...validateFields(input.fields));
  }

  // Return all errors at once if any
  if (validationErrors.length > 0) {
    return {
      success: false,
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'Datos inválidos',
      errors: validationErrors,
    };
  }

  // 4. Normalize field order if fields are provided
  const updates: Partial<Pick<Form, 'name' | 'description' | 'fields'>> = {};

  if (input.name !== undefined) {
    updates.name = input.name;
  }

  if (input.description !== undefined) {
    updates.description = input.description;
  }

  if (input.fields !== undefined) {
    updates.fields = normalizeFieldOrder(input.fields);
  }

  // 5. Persist changes
  const updatedAt = new Date().toISOString();
  const updatedForm = await persistFormUpdate(tenantId, formId, updates, updatedAt);

  // 6. Log audit entry
  await logAuditEntry({
    entity_type: AuditEntityType.FORMULARIO,
    entity_id: formId,
    action: AuditAction.FORMULARIO_EDITADO,
    actor_id: actorId,
    ip_address: ipAddress,
    metadata: {
      updated_fields: Object.keys(updates),
    },
    tenant_id: tenantId,
    form_id: formId,
  });

  logger.info('Form updated successfully', {
    form_id: formId,
    tenant_id: tenantId,
    actor_id: actorId,
    updated_fields: Object.keys(updates),
  });

  return {
    success: true,
    form: updatedForm,
  };
}

// ─── Unpublish Form (task 3.8) ────────────────────────────────────────────────

export interface UnpublishFormResult {
  success: true;
  form: Form;
}

export interface UnpublishFormError {
  success: false;
  statusCode: number;
  code: string;
  message: string;
}

/**
 * Unpublishes a form (POST /forms/{id}/unpublish).
 *
 * Validates:
 * - Form exists and belongs to the tenant
 * - Form is in "publicado" state
 *
 * Actions:
 * - Changes status to "despublicado"
 * - Logs audit entry "formulario_despublicado" with actor ID and UTC timestamp
 * - Preserves all historical responses (no deletion)
 *
 * Requirements: 7.1, 7.2, 7.4, 7.5
 */
export async function unpublishForm(
  tenantId: string,
  formId: string,
  actorId: string,
  ipAddress: string
): Promise<UnpublishFormResult | UnpublishFormError> {
  // 1. Retrieve the form
  const form = await getFormByIdAndTenant(tenantId, formId);

  if (!form) {
    return {
      success: false,
      statusCode: 404,
      code: 'NOT_FOUND',
      message: 'Formulario no encontrado',
    };
  }

  // 2. Validate form is in "publicado" state (Req 7.2)
  if (form.status !== FormStatus.PUBLICADO) {
    return {
      success: false,
      statusCode: 422,
      code: 'UNPROCESSABLE_ENTITY',
      message: `Solo formularios publicados pueden ser despublicados. Estado actual: ${form.status}`,
    };
  }

  // 3. Change status to "despublicado" (Req 7.1)
  const updatedAt = new Date().toISOString();

  const result = await docClient.send(
    new UpdateCommand({
      TableName: getTableName(FORMS_TABLE),
      Key: {
        PK: `TENANT#${tenantId}`,
        SK: `FORM#${formId}`,
      },
      UpdateExpression: 'SET #status = :status, #updated_at = :updated_at',
      ExpressionAttributeNames: {
        '#status': 'status',
        '#updated_at': 'updated_at',
      },
      ExpressionAttributeValues: {
        ':status': FormStatus.DESPUBLICADO,
        ':updated_at': updatedAt,
      },
      ReturnValues: 'ALL_NEW',
    })
  );

  const updatedForm = result.Attributes as Form;

  // 4. Log audit entry "formulario_despublicado" (Req 7.4)
  await logAuditEntry({
    entity_type: AuditEntityType.FORMULARIO,
    entity_id: formId,
    action: AuditAction.FORMULARIO_DESPUBLICADO,
    actor_id: actorId,
    ip_address: ipAddress,
    metadata: {
      previous_status: FormStatus.PUBLICADO,
    },
    tenant_id: tenantId,
    form_id: formId,
  });

  logger.info('Form unpublished', {
    form_id: formId,
    tenant_id: tenantId,
    actor_id: actorId,
  });

  // Note: Historical responses are preserved (Req 7.5) — no deletion occurs

  return {
    success: true,
    form: updatedForm,
  };
}

// ─── Publish Form (task 3.7) ──────────────────────────────────────────────────

export interface PublishFormResult {
  success: true;
  form: Form;
  token_publico: string;
  url_publica: string;
  version_number: number;
}

export interface PublishFormError {
  success: false;
  statusCode: number;
  code: string;
  message: string;
  errors?: ValidationError[];
}

/**
 * Validates minimum publication requirements for a form.
 *
 * Requirements (Req 6.1):
 * - Name must be 3-200 characters
 * - At least 1 field configured
 * - Each field must have a label of 1-200 characters
 * - Selection fields (seleccion_simple, seleccion_multiple) must have ≥2 options
 *
 * Returns all validation errors simultaneously.
 */
export function validatePublishRequirements(form: Form): ValidationError[] {
  const errors: ValidationError[] = [];

  // Validate name: 3-200 chars
  if (!form.name || form.name.length < 3 || form.name.length > 200) {
    errors.push({
      field: 'name',
      message: 'El nombre debe tener entre 3 y 200 caracteres para publicar',
    });
  }

  // At least 1 field
  if (!form.fields || form.fields.length === 0) {
    errors.push({
      field: 'fields',
      message: 'El formulario debe tener al menos un campo configurado para publicar',
    });
    return errors; // No point validating individual fields if none exist
  }

  // Validate each field
  for (let i = 0; i < form.fields.length; i++) {
    const field = form.fields[i]!;
    const fieldRef = `fields[${i}] (${field.label || 'sin etiqueta'})`;

    // Each field must have a label of 1-200 chars
    if (!field.label || field.label.length < 1 || field.label.length > 200) {
      errors.push({
        field: fieldRef,
        message: 'Cada campo debe tener una etiqueta de 1 a 200 caracteres',
      });
    }

    // Selection fields must have ≥2 options
    if (SELECTION_FIELD_TYPES.has(field.type)) {
      if (!field.options || field.options.length < 2) {
        errors.push({
          field: fieldRef,
          message: `Los campos de tipo ${field.type} deben tener al menos 2 opciones configuradas`,
        });
      }
    }
  }

  return errors;
}

/**
 * Publishes a form (POST /forms/{id}/publish).
 *
 * Validates:
 * - Form exists and belongs to the tenant
 * - Form is in "borrador" state (Req 6.3)
 * - Minimum publication requirements (Req 6.1)
 *
 * Actions:
 * - Generates token_publico (UUID v4) (Req 6.4, 6.6)
 * - Changes status to "publicado" (Req 6.4)
 * - Creates FormVersion (immutable snapshot of fields) (Req 6.4)
 * - Increments version number
 * - Records published_at (Req 6.4)
 * - Logs audit entry "formulario_publicado" (Req 6.5)
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6
 */
export async function publishForm(
  tenantId: string,
  formId: string,
  actorId: string,
  ipAddress: string
): Promise<PublishFormResult | PublishFormError> {
  // 1. Retrieve the form
  const form = await getFormByIdAndTenant(tenantId, formId);

  if (!form) {
    return {
      success: false,
      statusCode: 404,
      code: 'NOT_FOUND',
      message: 'Formulario no encontrado',
    };
  }

  // 2. Validate form is in "borrador" state (Req 6.3)
  if (form.status !== FormStatus.BORRADOR) {
    return {
      success: false,
      statusCode: 422,
      code: 'UNPROCESSABLE_ENTITY',
      message: `Solo formularios en estado borrador pueden ser publicados. Estado actual: ${form.status}`,
    };
  }

  // 3. Validate minimum publication requirements (Req 6.1, 6.2)
  const publishErrors = validatePublishRequirements(form);
  if (publishErrors.length > 0) {
    return {
      success: false,
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'El formulario no cumple los requisitos mínimos de publicación',
      errors: publishErrors,
    };
  }

  // 4. Generate token_publico (UUID v4) (Req 6.4, 6.6)
  const tokenPublico = uuidv4();

  // 5. Create FormVersion (immutable snapshot of fields) (Req 6.4)
  const formVersion = await createFormVersion(formId, form.fields, actorId);

  // 6. Update form: status → "publicado", set token_publico, current_version, published_at
  const now = new Date().toISOString();

  const result = await docClient.send(
    new UpdateCommand({
      TableName: getTableName(FORMS_TABLE),
      Key: {
        PK: `TENANT#${tenantId}`,
        SK: `FORM#${formId}`,
      },
      UpdateExpression:
        'SET #status = :status, #token_publico = :token_publico, #current_version = :current_version, #published_at = :published_at, #updated_at = :updated_at, #GSI1PK = :gsi1pk, #GSI1SK = :gsi1sk',
      ExpressionAttributeNames: {
        '#status': 'status',
        '#token_publico': 'token_publico',
        '#current_version': 'current_version',
        '#published_at': 'published_at',
        '#updated_at': 'updated_at',
        '#GSI1PK': 'GSI1PK',
        '#GSI1SK': 'GSI1SK',
      },
      ExpressionAttributeValues: {
        ':status': FormStatus.PUBLICADO,
        ':token_publico': tokenPublico,
        ':current_version': formVersion.version_number,
        ':published_at': now,
        ':updated_at': now,
        ':gsi1pk': `TOKEN#${tokenPublico}`,
        ':gsi1sk': `FORM#${formId}`,
      },
      ReturnValues: 'ALL_NEW',
    })
  );

  const updatedForm = result.Attributes as Form;

  // 7. Log audit entry "formulario_publicado" (Req 6.5)
  await logAuditEntry({
    entity_type: AuditEntityType.FORMULARIO,
    entity_id: formId,
    action: AuditAction.FORMULARIO_PUBLICADO,
    actor_id: actorId,
    ip_address: ipAddress,
    metadata: {
      token_publico: tokenPublico,
      version_number: formVersion.version_number,
    },
    tenant_id: tenantId,
    form_id: formId,
  });

  logger.info('Form published', {
    form_id: formId,
    tenant_id: tenantId,
    actor_id: actorId,
    token_publico: tokenPublico,
    version_number: formVersion.version_number,
  });

  // 8. Build public URL (Req 6.6)
  const domain = process.env['PUBLIC_DOMAIN'] ?? 'localhost';
  const urlPublica = `/forms/${tokenPublico}`;

  return {
    success: true,
    form: updatedForm,
    token_publico: tokenPublico,
    url_publica: urlPublica,
    version_number: formVersion.version_number,
  };
}
