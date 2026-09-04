import React, { useState } from 'react';

interface FormData {
  company_name: string;
  contact_name: string;
  email: string;
  phone: string;
  message: string;
}

interface FormErrors {
  company_name?: string;
  contact_name?: string;
  email?: string;
  message?: string;
}

type SubmitStatus = 'idle' | 'submitting' | 'success' | 'error';

export const ContactForm: React.FC = () => {
  const [formData, setFormData] = useState<FormData>({
    company_name: '',
    contact_name: '',
    email: '',
    phone: '',
    message: '',
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [status, setStatus] = useState<SubmitStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string>('');

  const validate = (): boolean => {
    const newErrors: FormErrors = {};

    if (!formData.company_name.trim()) {
      newErrors.company_name = 'Company name is required';
    } else if (formData.company_name.length > 200) {
      newErrors.company_name = 'Company name must be 200 characters or less';
    }

    if (!formData.contact_name.trim()) {
      newErrors.contact_name = 'Contact name is required';
    } else if (formData.contact_name.length > 150) {
      newErrors.contact_name = 'Contact name must be 150 characters or less';
    }

    if (!formData.email.trim()) {
      newErrors.email = 'Email is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = 'Please enter a valid email address';
    }

    if (!formData.message.trim()) {
      newErrors.message = 'Message is required';
    } else if (formData.message.length > 1000) {
      newErrors.message = 'Message must be 1000 characters or less';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validate()) return;

    setStatus('submitting');
    setErrorMessage('');

    // Default to relative `/api` so the CloudFront `/api/*` behavior can route
    // to the API Gateway when VITE_API_URL isn't baked in at build time.
    const apiUrl = import.meta.env.VITE_API_URL || '/api';

    try {
      const response = await fetch(`${apiUrl}/leads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      if (response.ok) {
        setStatus('success');
        setFormData({ company_name: '', contact_name: '', email: '', phone: '', message: '' });
        return;
      }

      // Distinguish "fix your input" (4xx) from "temporary, please retry" (5xx).
      if (response.status >= 400 && response.status < 500) {
        // Try to surface a specific validation message from the API if present.
        let apiMessage = '';
        try {
          const body = await response.json();
          apiMessage =
            (body?.error?.message as string) ||
            (body?.message as string) ||
            '';
        } catch {
          // Non-JSON body (e.g. HTML error page) — fall back to generic 4xx copy.
        }
        setErrorMessage(
          apiMessage ||
            'Please double-check your details — one or more fields look invalid.'
        );
      } else {
        setErrorMessage(
          'Our server is temporarily unavailable. Please try again in a few moments, or email us directly.'
        );
      }
      setStatus('error');
    } catch {
      // Network-level failure (DNS, connection refused, offline) — treat as retryable.
      setErrorMessage(
        'We couldn’t reach the server. Please check your connection and try again, or email us directly.'
      );
      setStatus('error');
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const target = e.target;
    const name = target.name;
    const value = target.value;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (errors[name as keyof FormErrors]) {
      setErrors((prev) => ({ ...prev, [name]: undefined }));
    }
  };

  return (
    <section id="contact" className="py-20 bg-primary-900">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-white">Get Started Today</h2>
          <p className="mt-4 text-lg text-primary-200">
            Tell us about your operation and we&apos;ll show you how SiteMacaron can streamline your compliance workflow.
          </p>
        </div>

        {status === 'success' ? (
          <div className="mt-12 p-8 bg-accent-50 rounded-xl text-center">
            <svg className="w-12 h-12 text-accent-500 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <h3 className="mt-4 text-xl font-semibold text-gray-900">Thank you!</h3>
            <p className="mt-2 text-gray-600">We&apos;ll be in touch within 24 hours.</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-12 space-y-6" noValidate>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div>
                <label htmlFor="company_name" className="block text-sm font-medium text-primary-100">
                  Company Name *
                </label>
                <input
                  type="text"
                  id="company_name"
                  name="company_name"
                  value={formData.company_name}
                  onChange={handleChange}
                  maxLength={200}
                  className={`mt-1 block w-full rounded-lg border px-4 py-3 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-accent-500 ${
                    errors.company_name ? 'border-red-500' : 'border-gray-300'
                  }`}
                  placeholder="Your company"
                />
                {errors.company_name && (
                  <p className="mt-1 text-sm text-red-300">{errors.company_name}</p>
                )}
              </div>

              <div>
                <label htmlFor="contact_name" className="block text-sm font-medium text-primary-100">
                  Contact Name *
                </label>
                <input
                  type="text"
                  id="contact_name"
                  name="contact_name"
                  value={formData.contact_name}
                  onChange={handleChange}
                  maxLength={150}
                  className={`mt-1 block w-full rounded-lg border px-4 py-3 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-accent-500 ${
                    errors.contact_name ? 'border-red-500' : 'border-gray-300'
                  }`}
                  placeholder="Your name"
                />
                {errors.contact_name && (
                  <p className="mt-1 text-sm text-red-300">{errors.contact_name}</p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-primary-100">
                  Email *
                </label>
                <input
                  type="email"
                  id="email"
                  name="email"
                  value={formData.email}
                  onChange={handleChange}
                  className={`mt-1 block w-full rounded-lg border px-4 py-3 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-accent-500 ${
                    errors.email ? 'border-red-500' : 'border-gray-300'
                  }`}
                  placeholder="you@company.com"
                />
                {errors.email && <p className="mt-1 text-sm text-red-300">{errors.email}</p>}
              </div>

              <div>
                <label htmlFor="phone" className="block text-sm font-medium text-primary-100">
                  Phone (optional)
                </label>
                <input
                  type="tel"
                  id="phone"
                  name="phone"
                  value={formData.phone}
                  onChange={handleChange}
                  className="mt-1 block w-full rounded-lg border border-gray-300 px-4 py-3 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-accent-500"
                  placeholder="+1 604 555 0123"
                />
              </div>
            </div>

            <div>
              <label htmlFor="message" className="block text-sm font-medium text-primary-100">
                Message *
              </label>
              <textarea
                id="message"
                name="message"
                value={formData.message}
                onChange={handleChange}
                rows={4}
                maxLength={1000}
                className={`mt-1 block w-full rounded-lg border px-4 py-3 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-accent-500 ${
                  errors.message ? 'border-red-500' : 'border-gray-300'
                }`}
                placeholder="Tell us about your sites, team size, and compliance challenges..."
              />
              {errors.message && <p className="mt-1 text-sm text-red-300">{errors.message}</p>}
            </div>

            {status === 'error' && (
              <div className="p-4 bg-red-50 rounded-lg" role="alert">
                <p className="text-sm text-red-700">
                  {errorMessage || 'Something went wrong. Please try again or email us directly.'}
                </p>
              </div>
            )}

            <button
              type="submit"
              disabled={status === 'submitting'}
              className="w-full px-8 py-4 text-base font-semibold rounded-lg text-primary-900 bg-accent-400 hover:bg-accent-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {status === 'submitting' ? 'Sending...' : 'Send Message'}
            </button>
          </form>
        )}
      </div>
    </section>
  );
};
