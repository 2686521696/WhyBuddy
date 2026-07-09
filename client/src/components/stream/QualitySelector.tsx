/**
 * QualitySelector — A compact dropdown for manual video quality switching.
 *
 * Renders in the player's top-right area. Shows the current quality level
 * with an icon and allows selecting high / medium / low / auto.
 *
 * When "auto" is selected, the QualityMonitor drives quality changes.
 * When a manual level is selected, the monitor is paused.
 *
 * Task 5.3 of the ue-video-stream-player spec.
 */

import { ChevronDown, Gauge } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import type { QualityLevel } from '@/lib/webrtc';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type QualityOption = QualityLevel | 'auto';

export interface QualitySelectorProps {
  /** Current active quality level. */
  value: QualityOption;
  /** Called when the user selects a quality option. */
  onChange: (quality: QualityOption) => void;
  /** Optional CSS class for the root element. */
  className?: string;
}

// ---------------------------------------------------------------------------
// Quality option metadata
// ---------------------------------------------------------------------------

interface QualityOptionMeta {
  label: string;
  description: string;
}

const QUALITY_OPTIONS: Record<QualityOption, QualityOptionMeta> = {
  auto: { label: '自动', description: '根据网络自动调整' },
  high: { label: '高清', description: '10 Mbps' },
  medium: { label: '标清', description: '4 Mbps' },
  low: { label: '流畅', description: '1.5 Mbps' },
};

const OPTION_ORDER: QualityOption[] = ['auto', 'high', 'medium', 'low'];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function QualitySelector({
  value,
  onChange,
  className,
}: QualitySelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const handleSelect = useCallback(
    (option: QualityOption) => {
      onChange(option);
      setIsOpen(false);
    },
    [onChange],
  );

  const currentOption = QUALITY_OPTIONS[value];

  return (
    <div
      ref={containerRef}
      className={`relative ${className ?? ''}`}
      data-testid="quality-selector"
    >
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex items-center gap-1.5 rounded-lg bg-black/50 px-2.5 py-1.5 text-xs text-white/80 backdrop-blur-sm transition-colors hover:bg-black/70 hover:text-white"
        aria-label={`画质: ${currentOption.label}`}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
      >
        <Gauge className="size-3.5" />
        <span>{currentOption.label}</span>
        <ChevronDown
          className={`size-3 transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {/* Dropdown popover */}
      {isOpen && (
        <div
          className="absolute right-0 top-full z-30 mt-1 w-40 overflow-hidden rounded-lg border border-white/10 bg-black/80 shadow-lg backdrop-blur-md"
          role="listbox"
          aria-label="选择画质"
        >
          {OPTION_ORDER.map((option) => {
            const meta = QUALITY_OPTIONS[option];
            const isSelected = option === value;

            return (
              <button
                key={option}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => handleSelect(option)}
                className={`flex w-full items-center justify-between px-3 py-2 text-left text-xs transition-colors ${
                  isSelected
                    ? 'bg-white/15 text-white'
                    : 'text-white/70 hover:bg-white/10 hover:text-white'
                }`}
              >
                <div>
                  <div className="font-medium">{meta.label}</div>
                  <div className="mt-0.5 text-[10px] text-white/50">
                    {meta.description}
                  </div>
                </div>
                {isSelected && (
                  <div className="size-1.5 rounded-full bg-emerald-400" />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
