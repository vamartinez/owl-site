// @vitest-environment jsdom
/**
 * Tests for honeypot bot protection on the public form.
 *
 * The honeypot field is hidden from real users but visible to bots.
 * If a bot fills the honeypot, the submission is silently rejected
 * (a fake success screen is shown without actually sending data).
 *
 * Requirements: 15.5
 */
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { createElement } from 'react';
import { PublicFormRenderer, useHoneypot } from '../PublicFormRenderer';
import type { PublicFormData } from '../PublicFormPage';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const simpleForm: PublicFormData = {
  name: 'Test Form',
  description: 'A form with honeypot protection',
  fields: [
    {
      field_id: 'f1',
      type: 'texto_corto',
      label: 'Nombre',
      required: true,
      order: 1,
    },
  ],
};

describe('Honeypot bot protection', () => {
  it('renders a hidden honeypot field in the form', () => {
    render(
      createElement(PublicFormRenderer, {
        form: simpleForm,
        values: {},
        errors: {},
        onFieldChange: vi.fn(),
        onFieldBlur: vi.fn(),
        onSubmit: vi.fn(),
        isSubmitting: false,
      })
    );

    // The honeypot field should exist in the DOM
    const honeypotInput = document.getElementById('website_url') as HTMLInputElement;
    expect(honeypotInput).toBeTruthy();
    expect(honeypotInput.name).toBe('website_url');
    expect(honeypotInput.type).toBe('text');
    expect(honeypotInput.tabIndex).toBe(-1);
    expect(honeypotInput.autocomplete).toBe('off');
  });

  it('honeypot field is visually hidden from users', () => {
    render(
      createElement(PublicFormRenderer, {
        form: simpleForm,
        values: {},
        errors: {},
        onFieldChange: vi.fn(),
        onFieldBlur: vi.fn(),
        onSubmit: vi.fn(),
        isSubmitting: false,
      })
    );

    const honeypotInput = document.getElementById('website_url') as HTMLInputElement;
    const container = honeypotInput.closest('[aria-hidden="true"]');
    expect(container).toBeTruthy();
    expect(container?.getAttribute('aria-hidden')).toBe('true');

    // Check that the container has styles that hide it
    const style = (container as HTMLElement).style;
    expect(style.position).toBe('absolute');
    expect(style.opacity).toBe('0');
    expect(style.pointerEvents).toBe('none');
  });

  it('honeypot field starts empty', () => {
    render(
      createElement(PublicFormRenderer, {
        form: simpleForm,
        values: {},
        errors: {},
        onFieldChange: vi.fn(),
        onFieldBlur: vi.fn(),
        onSubmit: vi.fn(),
        isSubmitting: false,
      })
    );

    const honeypotInput = document.getElementById('website_url') as HTMLInputElement;
    expect(honeypotInput.value).toBe('');
  });

  it('useHoneypot hook detects when honeypot is filled', () => {
    // Test the hook in isolation using a test component
    let hookResult: ReturnType<typeof useHoneypot>;

    function TestComponent() {
      hookResult = useHoneypot();
      return createElement('input', {
        ref: hookResult.honeypotRef,
        id: 'test-honeypot',
        defaultValue: '',
      });
    }

    render(createElement(TestComponent));

    // Initially not a bot
    expect(hookResult!.isBot()).toBe(false);
    expect(hookResult!.getHoneypotValue()).toBe('');

    // Simulate bot filling the field
    const input = document.getElementById('test-honeypot') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'spam-url.com' } });

    // Now it should detect as bot
    expect(hookResult!.isBot()).toBe(true);
    expect(hookResult!.getHoneypotValue()).toBe('spam-url.com');
  });

  it('useHoneypot hook does not flag empty honeypot as bot', () => {
    let hookResult: ReturnType<typeof useHoneypot>;

    function TestComponent() {
      hookResult = useHoneypot();
      return createElement('input', {
        ref: hookResult.honeypotRef,
        id: 'test-honeypot',
        defaultValue: '',
      });
    }

    render(createElement(TestComponent));

    expect(hookResult!.isBot()).toBe(false);
    expect(hookResult!.getHoneypotValue()).toBe('');
  });

  it('honeypot ref is passed to the renderer and connected', () => {
    let hookResult: ReturnType<typeof useHoneypot>;

    function TestWrapper() {
      hookResult = useHoneypot();
      return createElement(PublicFormRenderer, {
        form: simpleForm,
        values: {},
        errors: {},
        onFieldChange: vi.fn(),
        onFieldBlur: vi.fn(),
        onSubmit: vi.fn(),
        isSubmitting: false,
        honeypotRef: hookResult.honeypotRef,
      });
    }

    render(createElement(TestWrapper));

    // The ref should be connected to the honeypot input
    expect(hookResult!.honeypotRef.current).toBeTruthy();
    expect(hookResult!.honeypotRef.current?.id).toBe('website_url');
    expect(hookResult!.isBot()).toBe(false);

    // Simulate bot filling the field
    const honeypotInput = document.getElementById('website_url') as HTMLInputElement;
    fireEvent.change(honeypotInput, { target: { value: 'http://spam.com' } });

    expect(hookResult!.isBot()).toBe(true);
  });
});
