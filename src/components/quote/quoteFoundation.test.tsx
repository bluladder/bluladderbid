import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Calendar, House, Sparkles } from 'lucide-react';
import { ChoiceCard } from './ChoiceCard';
import { SummaryRow } from './SummaryRow';
import { PersistentActionBar } from './PersistentActionBar';
import { JourneyProgress } from './JourneyProgress';
import { PriceDisplay } from './PriceDisplay';
import { AsyncStatePanel } from './AsyncStatePanel';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/alert';

describe('Phase 1A quote foundation', () => {
  it('preserves the shared Button, Card, Input, Label, and Alert primitives', () => {
    render(
      <Card>
        <Label htmlFor="quote-name">Name</Label>
        <Input id="quote-name" />
        <Alert>Quote notice</Alert>
        <Button>Continue</Button>
      </Card>,
    );
    const input = screen.getByLabelText('Name');
    input.focus();
    expect(document.activeElement).toBe(input);
    expect(screen.getByRole('alert')).toHaveTextContent('Quote notice');
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled();
  });

  it('provides a semantic ChoiceCard with visible selection state', () => {
    const select = vi.fn();
    const { rerender } = render(
      <ChoiceCard icon={Sparkles} title="Window Cleaning" description="Clear views" onSelect={select} />,
    );
    const choice = screen.getByRole('button', { name: 'Add Window Cleaning' });
    expect(choice).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(choice);
    expect(select).toHaveBeenCalledOnce();

    rerender(
      <ChoiceCard icon={Sparkles} title="Window Cleaning" description="Clear views" selected onSelect={select} />,
    );
    expect(screen.getByRole('button', { name: 'Selected Window Cleaning' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('keeps SummaryRow Edit and Remove controls independent', () => {
    const edit = vi.fn();
    const remove = vi.fn();
    render(<SummaryRow icon={House} title="House Wash" price="$300" onEdit={edit} onRemove={remove} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit House Wash' }));
    expect(edit).toHaveBeenCalledOnce();
    expect(remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Remove House Wash' }));
    expect(remove).toHaveBeenCalledOnce();
  });

  it('announces semantic quote progress', () => {
    const steps = [
      { id: 'services' as const, label: 'Select Services', icon: Sparkles },
      { id: 'quote' as const, label: 'Review Quote', icon: House },
      { id: 'book' as const, label: 'Book', icon: Calendar },
    ];
    render(<JourneyProgress steps={steps} currentStep="quote" />);
    expect(screen.getByRole('navigation', { name: 'Quote progress' })).toBeInTheDocument();
    expect(screen.getByText('Review Quote').closest('li')).toHaveAttribute('aria-current', 'step');
    expect(screen.getByText('Select Services').closest('li')).toHaveTextContent('Completed');
  });

  it('formats the supplied canonical value without deriving a price', () => {
    render(<PriceDisplay value={312} prefix="Total" />);
    expect(screen.getByText('$312')).toBeInTheDocument();
    expect(screen.getByText('Total')).toBeInTheDocument();
  });

  it('represents loading state accessibly', () => {
    render(
      <AsyncStatePanel state="loading" title="Calculating quote">
        Please wait.
      </AsyncStatePanel>,
    );
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Calculating quote')).toBeInTheDocument();
  });

  it('shows the exact persistent action label only when the canonical quote is actionable', () => {
    const action = vi.fn();
    const { rerender } = render(
      <PersistentActionBar
        visible={false}
        label="Review one-time quote · $312"
        onAction={action}
      />,
    );
    expect(screen.queryByTestId('persistent-quote-action')).toBeNull();

    rerender(
      <PersistentActionBar
        visible
        label="Review one-time quote · $312"
        onAction={action}
      />,
    );
    const button = screen.getByRole('button', { name: 'Review one-time quote · $312' });
    expect(screen.getByTestId('persistent-quote-action').className).toContain('safe-area-inset-bottom');
    fireEvent.click(button);
    expect(action).toHaveBeenCalledOnce();
  });
});
