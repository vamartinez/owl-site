// @vitest-environment jsdom
import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { UploadProgressBar } from '../UploadProgressBar';

afterEach(() => {
  cleanup();
});

describe('UploadProgressBar', () => {
  it('renders the progress bar with correct ARIA attributes', () => {
    render(<UploadProgressBar progress={45} />);

    const progressBar = screen.getByRole('progressbar');
    expect(progressBar).toBeInTheDocument();
    expect(progressBar).toHaveAttribute('aria-valuenow', '45');
    expect(progressBar).toHaveAttribute('aria-valuemin', '0');
    expect(progressBar).toHaveAttribute('aria-valuemax', '100');
    expect(progressBar).toHaveAttribute('aria-label', 'Upload progress');
  });

  it('displays the percentage text', () => {
    render(<UploadProgressBar progress={72} />);

    expect(screen.getByText('72%')).toBeInTheDocument();
  });

  it('clamps progress to 0 when given a negative value', () => {
    render(<UploadProgressBar progress={-10} />);

    const progressBar = screen.getByRole('progressbar');
    expect(progressBar).toHaveAttribute('aria-valuenow', '0');
    expect(screen.getByText('0%')).toBeInTheDocument();
  });

  it('clamps progress to 100 when given a value over 100', () => {
    render(<UploadProgressBar progress={150} />);

    const progressBar = screen.getByRole('progressbar');
    expect(progressBar).toHaveAttribute('aria-valuenow', '100');
    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  it('renders 0% at the start of upload', () => {
    render(<UploadProgressBar progress={0} />);

    const progressBar = screen.getByRole('progressbar');
    expect(progressBar).toHaveAttribute('aria-valuenow', '0');
    expect(screen.getByText('0%')).toBeInTheDocument();
  });

  it('renders 100% when upload is complete', () => {
    render(<UploadProgressBar progress={100} />);

    const progressBar = screen.getByRole('progressbar');
    expect(progressBar).toHaveAttribute('aria-valuenow', '100');
    expect(screen.getByText('100%')).toBeInTheDocument();
  });
});
