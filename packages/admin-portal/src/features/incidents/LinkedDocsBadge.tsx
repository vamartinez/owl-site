interface LinkedDocsBadgeProps {
  count?: number;
}

/**
 * Badge numérico que muestra el conteo de documentos vinculados a un incidente.
 * No renderiza nada cuando el conteo es 0 o undefined.
 *
 * Validates: Requirements 9.1, 9.2
 */
export function LinkedDocsBadge({ count }: LinkedDocsBadgeProps) {
  if (!count) return null;

  return (
    <span
      className="inline-flex items-center justify-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700"
      title={`${count} documento${count !== 1 ? 's' : ''} vinculado${count !== 1 ? 's' : ''}`}
    >
      {count}
    </span>
  );
}
