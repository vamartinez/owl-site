import { type ReactNode } from 'react';

interface CardProps {
  className?: string;
  children: ReactNode;
}

interface CardHeaderProps {
  title: string;
  description?: string;
  action?: ReactNode;
}

export function Card({ className = '', children }: CardProps) {
  return (
    <div className={`bg-white rounded-lg border border-gray-200 shadow-sm ${className}`}>
      {children}
    </div>
  );
}

export function CardHeader({ title, description, action }: CardHeaderProps) {
  return (
    <div className="flex items-start justify-between px-6 py-4 border-b border-gray-100">
      <div>
        <h3 className="text-base font-semibold text-gray-900">{title}</h3>
        {description && (
          <p className="mt-0.5 text-sm text-gray-500">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}

export function CardContent({ className = '', children }: CardProps) {
  return <div className={`px-6 py-4 ${className}`}>{children}</div>;
}
