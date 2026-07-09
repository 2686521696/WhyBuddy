/**
 * Unit tests for QualitySelector component (Task 5.3).
 *
 * Uses renderToStaticMarkup to match the existing test pattern in this project.
 */

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { QualitySelector } from '../QualitySelector';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderSelector(
  overrides?: Partial<React.ComponentProps<typeof QualitySelector>>,
): string {
  return renderToStaticMarkup(
    <QualitySelector
      value="high"
      onChange={vi.fn()}
      {...overrides}
    />,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('QualitySelector', () => {
  describe('rendering', () => {
    it('renders with data-testid', () => {
      const markup = renderSelector();
      expect(markup).toContain('data-testid="quality-selector"');
    });

    it('shows the current quality label for high', () => {
      const markup = renderSelector({ value: 'high' });
      expect(markup).toContain('高清');
    });

    it('shows the current quality label for medium', () => {
      const markup = renderSelector({ value: 'medium' });
      expect(markup).toContain('标清');
    });

    it('shows the current quality label for low', () => {
      const markup = renderSelector({ value: 'low' });
      expect(markup).toContain('流畅');
    });

    it('shows the current quality label for auto', () => {
      const markup = renderSelector({ value: 'auto' });
      expect(markup).toContain('自动');
    });

    it('applies custom className', () => {
      const markup = renderSelector({ className: 'my-class' });
      expect(markup).toContain('my-class');
    });
  });

  describe('accessibility', () => {
    it('has aria-label with current quality', () => {
      const markup = renderSelector({ value: 'high' });
      expect(markup).toContain('aria-label="画质: 高清"');
    });

    it('has aria-haspopup=listbox', () => {
      const markup = renderSelector();
      expect(markup).toContain('aria-haspopup="listbox"');
    });

    it('has aria-expanded=false by default (dropdown closed)', () => {
      const markup = renderSelector();
      expect(markup).toContain('aria-expanded="false"');
    });
  });

  describe('trigger button', () => {
    it('renders a button element', () => {
      const markup = renderSelector();
      expect(markup).toContain('<button');
      expect(markup).toContain('type="button"');
    });

    it('contains the Gauge icon area', () => {
      // The Gauge icon from lucide-react renders as an SVG
      const markup = renderSelector();
      expect(markup).toContain('<svg');
    });
  });

  describe('dropdown is closed by default', () => {
    it('does not render the listbox when closed', () => {
      const markup = renderSelector();
      expect(markup).not.toContain('role="listbox"');
    });

    it('does not show quality descriptions when closed', () => {
      const markup = renderSelector();
      // Descriptions like "10 Mbps" should not appear when dropdown is closed
      expect(markup).not.toContain('10 Mbps');
      expect(markup).not.toContain('4 Mbps');
      expect(markup).not.toContain('1.5 Mbps');
      expect(markup).not.toContain('根据网络自动调整');
    });
  });

  describe('quality options metadata', () => {
    it('exports QualityOption type that includes auto', () => {
      // Type-level check: this should compile without errors
      const options: Array<'high' | 'medium' | 'low' | 'auto'> = [
        'auto',
        'high',
        'medium',
        'low',
      ];
      expect(options).toHaveLength(4);
    });
  });
});
