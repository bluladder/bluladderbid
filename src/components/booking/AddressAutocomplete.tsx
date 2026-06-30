import { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { MapPin, Loader2 } from 'lucide-react';
import { useGoogleMaps } from '@/hooks/useGoogleMaps';

export interface ParsedAddress {
  street: string;
  city: string;
  state: string;
  zip: string;
}

interface Suggestion {
  id: string;
  text: string;
  prediction: any;
}

interface AddressAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  onSelect: (address: ParsedAddress) => void;
  placeholder?: string;
  className?: string;
  id?: string;
}

function getComponent(components: any[], type: string, useShort = false): string {
  const match = components?.find((c) =>
    (c.types || c.Types || []).includes(type),
  );
  if (!match) return '';
  return useShort
    ? match.shortText ?? match.short_name ?? match.longText ?? match.long_name ?? ''
    : match.longText ?? match.long_name ?? match.shortText ?? match.short_name ?? '';
}

/**
 * Street-address input backed by Google Places API (New) autocomplete.
 * Selecting a suggestion fills Street, City, State and ZIP via onSelect.
 * Falls back to a plain input when the Maps API is unavailable.
 */
export function AddressAutocomplete({
  value,
  onChange,
  onSelect,
  placeholder,
  className,
  id,
}: AddressAutocompleteProps) {
  const { ready } = useGoogleMaps();
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const sessionTokenRef = useRef<any>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const containerRef = useRef<HTMLDivElement>(null);
  const skipNextFetch = useRef(false);

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const fetchSuggestions = async (input: string) => {
    if (!ready || !input || input.trim().length < 3) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    try {
      setLoading(true);
      const g = (window as any).google;
      const { AutocompleteSuggestion, AutocompleteSessionToken } =
        await g.maps.importLibrary('places');
      if (!sessionTokenRef.current) {
        sessionTokenRef.current = new AutocompleteSessionToken();
      }
      const { suggestions: results } =
        await AutocompleteSuggestion.fetchAutocompleteSuggestions({
          input,
          sessionToken: sessionTokenRef.current,
          includedRegionCodes: ['us'],
        });
      const mapped: Suggestion[] = (results || [])
        .filter((s: any) => s.placePrediction)
        .map((s: any) => ({
          id: s.placePrediction.placeId,
          text: s.placePrediction.text?.text ?? '',
          prediction: s.placePrediction,
        }));
      setSuggestions(mapped);
      setOpen(mapped.length > 0);
      setActiveIndex(-1);
    } catch (err) {
      console.error('Address autocomplete failed', err);
      setSuggestions([]);
      setOpen(false);
    } finally {
      setLoading(false);
    }
  };

  const handleInput = (next: string) => {
    onChange(next);
    if (skipNextFetch.current) {
      skipNextFetch.current = false;
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchSuggestions(next), 250);
  };

  const handlePick = async (suggestion: Suggestion) => {
    setOpen(false);
    setSuggestions([]);
    try {
      const place = suggestion.prediction.toPlace();
      await place.fetchFields({ fields: ['addressComponents', 'formattedAddress'] });
      const components = place.addressComponents || [];
      const streetNumber = getComponent(components, 'street_number');
      const route = getComponent(components, 'route');
      const city =
        getComponent(components, 'locality') ||
        getComponent(components, 'sublocality') ||
        getComponent(components, 'postal_town') ||
        getComponent(components, 'administrative_area_level_2');
      const state = getComponent(components, 'administrative_area_level_1', true);
      const zip = getComponent(components, 'postal_code');
      const street = [streetNumber, route].filter(Boolean).join(' ').trim();
      skipNextFetch.current = true;
      onSelect({ street: street || suggestion.text, city, state, zip });
    } catch (err) {
      console.error('Failed to fetch place details', err);
      skipNextFetch.current = true;
      onChange(suggestion.text);
    } finally {
      // Reset the session after a selection per Places billing guidance.
      sessionTokenRef.current = null;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open || suggestions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault();
      handlePick(suggestions[activeIndex]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div className="relative" ref={containerRef}>
      <MapPin className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground z-10" />
      <Input
        id={id}
        value={value}
        onChange={(e) => handleInput(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        placeholder={placeholder}
        autoComplete="off"
        className={className}
      />
      {loading && (
        <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground animate-spin" />
      )}
      {open && suggestions.length > 0 && (
        <ul className="absolute z-50 mt-1 w-full rounded-md border border-border bg-popover shadow-md max-h-60 overflow-auto py-1">
          {suggestions.map((s, idx) => (
            <li key={s.id}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handlePick(s)}
                className={`flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-accent ${
                  idx === activeIndex ? 'bg-accent' : ''
                }`}
              >
                <MapPin className="w-3.5 h-3.5 mt-0.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 break-words">{s.text}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}