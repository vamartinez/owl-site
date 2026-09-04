// @vitest-environment jsdom
/**
 * Preservation Property Tests for Modal Component - Backdrop Close Behavior
 *
 * These tests capture the BASELINE behavior of the Modal's click-to-close mechanism
 * on UNFIXED code. They verify behaviors that MUST be preserved after the bugfix.
 *
 * **Validates: Requirements 3.2, 3.3, 3.4**
 */
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { createElement } from 'react';
import fc from 'fast-check';
import { Modal } from '../Modal';

// ─── Mock HTMLDialogElement API ──────────────────────────────────────────────

beforeEach(() => {
  // Mock showModal and close methods on HTMLDialogElement prototype
  HTMLDialogElement.prototype.showModal = vi.fn();
  HTMLDialogElement.prototype.close = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/**
 * Generates a dialog bounding rect representing a centered modal.
 * The dialog is positioned somewhere in the viewport with reasonable dimensions.
 */
const arbDialogRect = fc.record({
  left: fc.integer({ min: 50, max: 300 }),
  top: fc.integer({ min: 50, max: 200 }),
  width: fc.integer({ min: 200, max: 600 }),
  height: fc.integer({ min: 150, max: 500 }),
}).map(({ left, top, width, height }) => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
  width,
  height,
  x: left,
  y: top,
  toJSON: () => ({}),
}));

/**
 * Generates click coordinates that are OUTSIDE a given bounding rect.
 * This simulates actual backdrop clicks.
 */
function arbCoordsOutsideRect(rect: { left: number; top: number; right: number; bottom: number }) {
  return fc.oneof(
    // Above the dialog
    fc.record({
      clientX: fc.integer({ min: 0, max: 1920 }),
      clientY: fc.integer({ min: 0, max: Math.max(0, rect.top - 1) }),
    }),
    // Below the dialog
    fc.record({
      clientX: fc.integer({ min: 0, max: 1920 }),
      clientY: fc.integer({ min: rect.bottom + 1, max: 1080 }),
    }),
    // Left of the dialog
    fc.record({
      clientX: fc.integer({ min: 0, max: Math.max(0, rect.left - 1) }),
      clientY: fc.integer({ min: 0, max: 1080 }),
    }),
    // Right of the dialog
    fc.record({
      clientX: fc.integer({ min: rect.right + 1, max: 1920 }),
      clientY: fc.integer({ min: 0, max: 1080 }),
    })
  );
}

/**
 * Generates click coordinates that are INSIDE a given bounding rect.
 * This simulates clicks on dialog content (inner elements).
 */
function arbCoordsInsideRect(rect: { left: number; top: number; right: number; bottom: number }) {
  return fc.record({
    clientX: fc.integer({ min: rect.left, max: rect.right }),
    clientY: fc.integer({ min: rect.top, max: rect.bottom }),
  });
}

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('Modal Preservation Property Tests — Backdrop Close Behavior', () => {
  /**
   * Property 1: For all click events where `e.target === dialog` AND coordinates
   * are OUTSIDE the dialog's bounding rect, `onClose` IS called.
   *
   * On UNFIXED code: The current handler calls onClose whenever e.target === dialog,
   * regardless of coordinates. So clicks outside bounds where target===dialog WILL
   * trigger onClose. This test PASSES on unfixed code.
   *
   * **Validates: Requirements 3.2**
   */
  describe('Property 1: Backdrop clicks (target===dialog, coords outside) call onClose', () => {
    it('onClose is called for all clicks where target is the dialog element (backdrop area)', () => {
      fc.assert(
        fc.property(arbDialogRect, (rect) => {
          cleanup();
          const onClose = vi.fn();

          render(
            createElement(Modal, {
              open: true,
              onClose,
              title: 'Test Modal',
              children: createElement('div', null, 'Content'),
            })
          );

          const dialog = document.querySelector('dialog');
          expect(dialog).not.toBeNull();

          // Mock getBoundingClientRect to return our generated rect
          vi.spyOn(dialog!, 'getBoundingClientRect').mockReturnValue(rect as DOMRect);

          // Generate a coordinate outside the rect for this specific test run
          // We deterministically pick a point above the dialog
          const outsideX = rect.left + Math.floor(rect.width / 2);
          const outsideY = Math.max(0, rect.top - 10);

          // Simulate a click where e.target is the dialog itself (backdrop click)
          // In the current code, e.target === dialogRef.current triggers onClose
          fireEvent.click(dialog!, {
            target: dialog,
            clientX: outsideX,
            clientY: outsideY,
          });

          // On UNFIXED code: onClose IS called because e.target === dialog
          expect(onClose).toHaveBeenCalled();
        }),
        { numRuns: 50 }
      );
    });

    it('generates many random outside-bounds coordinates and verifies onClose is called', () => {
      // Use a fixed rect for coordinate generation
      const fixedRect = {
        left: 200,
        top: 100,
        right: 700,
        bottom: 500,
        width: 500,
        height: 400,
        x: 200,
        y: 100,
        toJSON: () => ({}),
      };

      fc.assert(
        fc.property(arbCoordsOutsideRect(fixedRect), (coords) => {
          cleanup();
          const onClose = vi.fn();

          render(
            createElement(Modal, {
              open: true,
              onClose,
              title: 'Test Modal',
              children: createElement('div', null, 'Content'),
            })
          );

          const dialog = document.querySelector('dialog');
          expect(dialog).not.toBeNull();

          vi.spyOn(dialog!, 'getBoundingClientRect').mockReturnValue(fixedRect as DOMRect);

          // Fire click with target = dialog (simulating backdrop click)
          fireEvent.click(dialog!, {
            target: dialog,
            clientX: coords.clientX,
            clientY: coords.clientY,
          });

          // On UNFIXED code: onClose IS called because e.target === dialog regardless of coordinates
          expect(onClose).toHaveBeenCalled();
        }),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Property 2: For all click events where `e.target !== dialog` (clicks on inner elements),
   * `onClose` is NOT called.
   *
   * On UNFIXED code: The handler checks `if (e.target === dialogRef.current)` so clicks
   * on inner elements (where target is NOT the dialog) do NOT trigger onClose.
   * This test PASSES on unfixed code.
   *
   * **Validates: Requirements 3.4**
   */
  describe('Property 2: Clicks on inner elements (target !== dialog) do NOT call onClose', () => {
    it('onClose is NOT called when click target is a child element inside the modal', () => {
      fc.assert(
        fc.property(
          arbDialogRect,
          fc.constantFrom('button', 'input', 'div', 'span', 'select', 'textarea', 'label'),
          (rect, childTag) => {
            cleanup();
            const onClose = vi.fn();

            render(
              createElement(Modal, {
                open: true,
                onClose,
                title: 'Test Modal',
                children: createElement(childTag, {
                  'data-testid': 'inner-element',
                  ...(childTag === 'input' ? { type: 'text', defaultValue: '' } : {}),
                }),
              })
            );

            const dialog = document.querySelector('dialog');
            expect(dialog).not.toBeNull();

            vi.spyOn(dialog!, 'getBoundingClientRect').mockReturnValue(rect as DOMRect);

            // Find the inner element (or any child — the click target is what matters)
            const innerElement = screen.getByTestId('inner-element');

            // Generate coordinates inside the rect
            const insideX = rect.left + Math.floor(rect.width / 2);
            const insideY = rect.top + Math.floor(rect.height / 2);

            // Click the inner element — target will NOT be the dialog
            fireEvent.click(innerElement, {
              clientX: insideX,
              clientY: insideY,
            });

            // On UNFIXED code: onClose is NOT called because e.target !== dialogRef.current
            expect(onClose).not.toHaveBeenCalled();
          }
        ),
        { numRuns: 50 }
      );
    });

    it('interactions with form controls inside modal do not trigger close', () => {
      fc.assert(
        fc.property(
          fc.constantFrom('text', 'number', 'email', 'date', 'datetime-local', 'checkbox'),
          (inputType) => {
            cleanup();
            const onClose = vi.fn();

            render(
              createElement(Modal, {
                open: true,
                onClose,
                title: 'Form Modal',
                children: createElement('form', null,
                  createElement('input', {
                    type: inputType,
                    'data-testid': 'form-input',
                    defaultValue: inputType === 'checkbox' ? undefined : '',
                    defaultChecked: inputType === 'checkbox' ? false : undefined,
                  }),
                  createElement('select', { 'data-testid': 'form-select' },
                    createElement('option', { value: 'a' }, 'Option A'),
                    createElement('option', { value: 'b' }, 'Option B')
                  )
                ),
              })
            );

            const input = screen.getByTestId('form-input');
            const select = screen.getByTestId('form-select');

            // Click the input
            fireEvent.click(input);
            expect(onClose).not.toHaveBeenCalled();

            // Change the input value
            if (inputType === 'checkbox') {
              fireEvent.change(input, { target: { checked: true } });
            } else {
              fireEvent.change(input, { target: { value: 'test value' } });
            }
            expect(onClose).not.toHaveBeenCalled();

            // Click and change the select
            fireEvent.click(select);
            fireEvent.change(select, { target: { value: 'b' } });
            expect(onClose).not.toHaveBeenCalled();
          }
        ),
        { numRuns: 30 }
      );
    });
  });

  /**
   * Additional preservation test: X button and Escape key close behavior.
   *
   * **Validates: Requirements 3.3**
   */
  describe('X button closes modal', () => {
    it('clicking X button calls onClose', () => {
      const onClose = vi.fn();

      render(
        createElement(Modal, {
          open: true,
          onClose,
          title: 'Test Modal',
          children: createElement('div', null, 'Content'),
        })
      );

      const closeButton = screen.getByLabelText('Close');
      fireEvent.click(closeButton);

      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });
});
