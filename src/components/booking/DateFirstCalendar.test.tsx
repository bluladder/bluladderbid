import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DateFirstCalendar } from './DateFirstCalendar';
import { format, addDays } from 'date-fns';

function findDay(dateKey: string) {
  return screen.getByTestId(`calendar-day-${dateKey}`) as HTMLButtonElement;
}

function nextWeekday(offsetDays: number) {
  // Return an upcoming Monday-Friday date offset from today so tests are
  // deterministic regardless of when they run.
  let d = addDays(new Date(), offsetDays);
  while (d.getDay() === 0 || d.getDay() === 6) d = addDays(d, 1);
  return d;
}

function iso(d: Date, hour: number) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(hour).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T${hh}:00:00`;
}

describe('DateFirstCalendar — status-driven presentation', () => {
  it('renders "Open" on a business day with several valid slots', () => {
    const target = nextWeekday(3);
    const key = format(target, 'yyyy-MM-dd');
    render(
      <DateFirstCalendar
        viewMode="month"
        onViewModeChange={() => {}}
        selectedDate={null}
        onSelectDate={() => {}}
        availableSlots={[iso(target, 9), iso(target, 12), iso(target, 15)].map((s) => ({ startTime: s }))}
      />,
    );
    const cell = findDay(key);
    expect(cell.dataset.status).toBe('open');
    expect(cell.disabled).toBe(false);
    expect(cell.textContent).toMatch(/open/i);
  });

  it('renders "Limited" with a count on 1–2 valid slots', () => {
    const target = nextWeekday(4);
    const key = format(target, 'yyyy-MM-dd');
    render(
      <DateFirstCalendar
        viewMode="month"
        onViewModeChange={() => {}}
        selectedDate={null}
        onSelectDate={() => {}}
        availableSlots={[iso(target, 9), iso(target, 13)].map((s) => ({ startTime: s }))}
      />,
    );
    const cell = findDay(key);
    expect(cell.dataset.status).toBe('limited');
    expect(cell.textContent).toMatch(/left|limited/i);
    expect(cell.disabled).toBe(false);
  });

  it('renders "Full" and disables selection for a fully-booked business day', () => {
    const target = nextWeekday(5);
    const key = format(target, 'yyyy-MM-dd');
    const onSelectDate = vi.fn();
    render(
      <DateFirstCalendar
        viewMode="month"
        onViewModeChange={() => {}}
        selectedDate={null}
        onSelectDate={onSelectDate}
        availableSlots={[]}
        fullyBookedDays={[key]}
      />,
    );
    const cell = findDay(key);
    expect(cell.dataset.status).toBe('full');
    expect(cell.disabled).toBe(true);
    fireEvent.click(cell);
    expect(onSelectDate).not.toHaveBeenCalled();
  });

  it('marks weekends as Unavailable and prevents selection', () => {
    let saturday = new Date();
    while (saturday.getDay() !== 6) saturday = addDays(saturday, 1);
    const key = format(saturday, 'yyyy-MM-dd');
    const onSelectDate = vi.fn();
    render(
      <DateFirstCalendar
        viewMode="month"
        onViewModeChange={() => {}}
        selectedDate={null}
        onSelectDate={onSelectDate}
      />,
    );
    const cell = findDay(key);
    expect(cell.dataset.status).toBe('unavailable');
    expect(cell.disabled).toBe(true);
    fireEvent.click(cell);
    expect(onSelectDate).not.toHaveBeenCalled();
  });

  it('shows a fail-closed banner and never paints dates as Open when availability is unavailable', () => {
    const target = nextWeekday(2);
    const key = format(target, 'yyyy-MM-dd');
    render(
      <DateFirstCalendar
        viewMode="month"
        onViewModeChange={() => {}}
        selectedDate={null}
        onSelectDate={() => {}}
        availableSlots={[iso(target, 9), iso(target, 12), iso(target, 15)].map((s) => ({ startTime: s }))}
        availabilityUnavailable
      />,
    );
    expect(screen.getByTestId('calendar-availability-unavailable')).toBeInTheDocument();
    expect(findDay(key).dataset.status).not.toBe('open');
  });

  it('marks the grid as loading (aria-busy) and never renders any Open cells while loading with no data', () => {
    render(
      <DateFirstCalendar
        viewMode="month"
        onViewModeChange={() => {}}
        selectedDate={null}
        onSelectDate={() => {}}
        availableSlots={[]}
        isLoadingAvailability
      />,
    );
    const grid = screen.getByTestId('calendar-grid');
    expect(grid.getAttribute('aria-busy')).toBe('true');
    // With no slot data, no cell should read as "Open".
    const openCells = document.querySelectorAll('[data-status="open"]');
    expect(openCells.length).toBe(0);
  });

  it('emits open/limited/full analytics events without any PII', () => {
    const openDate = nextWeekday(2);
    const limitedDate = nextWeekday(3);
    const fullDate = nextWeekday(4);
    const openKey = format(openDate, 'yyyy-MM-dd');
    const limitedKey = format(limitedDate, 'yyyy-MM-dd');
    const fullKey = format(fullDate, 'yyyy-MM-dd');
    const events: unknown[] = [];
    render(
      <DateFirstCalendar
        viewMode="month"
        onViewModeChange={() => {}}
        selectedDate={null}
        onSelectDate={() => {}}
        availableSlots={[
          iso(openDate, 9),
          iso(openDate, 12),
          iso(openDate, 15),
          iso(limitedDate, 10),
        ].map((s) => ({ startTime: s }))}
        fullyBookedDays={[fullKey]}
        onCalendarEvent={(e) => events.push(e)}
      />,
    );
    fireEvent.click(findDay(openKey));
    fireEvent.click(findDay(limitedKey));
    fireEvent.click(findDay(fullKey));
    const types = events.map((e) => (e as { type: string }).type);
    expect(types).toContain('calendar_month_viewed');
    expect(types).toContain('open_date_selected');
    expect(types).toContain('limited_date_selected');
    expect(types).toContain('full_date_clicked');
    // No event carries customer PII fields.
    for (const e of events as Array<Record<string, unknown>>) {
      expect(Object.keys(e)).not.toEqual(expect.arrayContaining(['email', 'phone', 'address', 'name']));
    }
  });
});