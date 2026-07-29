import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  addMonths,
  clampMonth,
  isSameDay,
  isWithin,
  monthWeeks,
  startOfDay,
  startOfMonth,
} from '../../domain/services/calendarMonth';
import { colors, radius, spacing, typography } from '../theme/theme';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

interface Props {
  /** Currently selected day, or null when nothing is chosen yet. */
  value: Date | null;
  /** Fires with local midnight on the chosen day. */
  onChange: (day: Date) => void;
  /** Earliest selectable day (inclusive). */
  minDate: Date;
  /** Latest selectable day (inclusive). */
  maxDate: Date;
}

/**
 * An inline day picker, built from the app's own tokens rather than a native
 * date-picker module. Two reasons it is hand-rolled: the platform picker's
 * chrome looks nothing like the rest of this app, and a new native dependency
 * cannot reach already-installed builds over the air.
 *
 * Tapping the month title switches to a month/year grid, so reaching a trip
 * three years back is two taps rather than thirty-six chevrons.
 */
export function CalendarPicker({ value, onChange, minDate, maxDate }: Props): React.JSX.Element {
  const [visibleMonth, setVisibleMonth] = useState(() =>
    clampMonth(value ?? maxDate, minDate, maxDate),
  );
  const [pickingMonth, setPickingMonth] = useState(false);

  const weeks = useMemo(() => monthWeeks(visibleMonth), [visibleMonth]);

  const canGoBack = startOfMonth(visibleMonth).getTime() > startOfMonth(minDate).getTime();
  const canGoForward = startOfMonth(visibleMonth).getTime() < startOfMonth(maxDate).getTime();

  const step = (delta: number): void =>
    setVisibleMonth(m => clampMonth(addMonths(m, delta), minDate, maxDate));

  const title = `${MONTHS[visibleMonth.getMonth()] ?? ''} ${visibleMonth.getFullYear()}`;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => step(-1)}
          disabled={!canGoBack || pickingMonth}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Previous month"
          accessibilityState={{ disabled: !canGoBack || pickingMonth }}
        >
          <Ionicons
            name="chevron-back"
            size={20}
            color={canGoBack && !pickingMonth ? colors.text : colors.textMuted}
          />
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => setPickingMonth(p => !p)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={title}
          accessibilityHint="Switches between picking a day and picking a month"
        >
          <View style={styles.titleRow}>
            <Text style={styles.title}>{title}</Text>
            <Ionicons name={pickingMonth ? 'chevron-up' : 'chevron-down'} size={14} color={colors.textSecondary} />
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => step(1)}
          disabled={!canGoForward || pickingMonth}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Next month"
          accessibilityState={{ disabled: !canGoForward || pickingMonth }}
        >
          <Ionicons
            name="chevron-forward"
            size={20}
            color={canGoForward && !pickingMonth ? colors.text : colors.textMuted}
          />
        </TouchableOpacity>
      </View>

      {pickingMonth ? (
        <MonthGrid
          visibleMonth={visibleMonth}
          minDate={minDate}
          maxDate={maxDate}
          onPick={month => {
            setVisibleMonth(month);
            setPickingMonth(false);
          }}
        />
      ) : (
        <>
          <View style={styles.weekdayRow}>
            {WEEKDAYS.map((label, i) => (
              <Text key={`${label}-${i}`} style={styles.weekday}>{label}</Text>
            ))}
          </View>

          {weeks.map((week, wi) => (
            <View key={wi} style={styles.week}>
              {week.map((day, di) => {
                if (day == null) return <View key={di} style={styles.cell} />;
                const selected = value != null && isSameDay(day, value);
                const selectable = isWithin(day, minDate, maxDate);
                return (
                  <TouchableOpacity
                    key={di}
                    testID={`calendar-day-${day.getFullYear()}-${day.getMonth() + 1}-${day.getDate()}`}
                    style={[styles.cell, selected && styles.cellSelected]}
                    disabled={!selectable}
                    onPress={() => onChange(startOfDay(day))}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityState={{ selected, disabled: !selectable }}
                    accessibilityLabel={`${day.getDate()} ${MONTHS[day.getMonth()] ?? ''} ${day.getFullYear()}`}
                  >
                    <Text
                      style={[
                        styles.day,
                        selected && styles.daySelected,
                        !selectable && styles.dayDisabled,
                      ]}
                    >
                      {day.getDate()}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          ))}
        </>
      )}
    </View>
  );
}

/** Year stepper + the twelve months, for jumping without chevron-mashing. */
function MonthGrid({ visibleMonth, minDate, maxDate, onPick }: {
  visibleMonth: Date;
  minDate: Date;
  maxDate: Date;
  onPick: (month: Date) => void;
}): React.JSX.Element {
  const [year, setYear] = useState(visibleMonth.getFullYear());

  const minYear = minDate.getFullYear();
  const maxYear = maxDate.getFullYear();

  return (
    <View style={styles.monthPane}>
      <View style={styles.yearRow}>
        <TouchableOpacity
          onPress={() => setYear(y => Math.max(minYear, y - 1))}
          disabled={year <= minYear}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Previous year"
          accessibilityState={{ disabled: year <= minYear }}
        >
          <Ionicons name="chevron-back" size={18} color={year > minYear ? colors.text : colors.textMuted} />
        </TouchableOpacity>
        <Text style={styles.year}>{year}</Text>
        <TouchableOpacity
          onPress={() => setYear(y => Math.min(maxYear, y + 1))}
          disabled={year >= maxYear}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Next year"
          accessibilityState={{ disabled: year >= maxYear }}
        >
          <Ionicons name="chevron-forward" size={18} color={year < maxYear ? colors.text : colors.textMuted} />
        </TouchableOpacity>
      </View>

      <View style={styles.monthWrap}>
        {MONTHS_SHORT.map((label, index) => {
          const month = new Date(year, index, 1);
          // A month is reachable when any of its days is; comparing months
          // directly keeps a partially-covered boundary month enabled.
          const selectable =
            month.getTime() >= startOfMonth(minDate).getTime() &&
            month.getTime() <= startOfMonth(maxDate).getTime();
          const current = visibleMonth.getFullYear() === year && visibleMonth.getMonth() === index;
          return (
            <TouchableOpacity
              key={label}
              testID={`calendar-month-${year}-${index + 1}`}
              style={[styles.monthChip, current && styles.monthChipActive]}
              disabled={!selectable}
              onPress={() => onPick(month)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityState={{ selected: current, disabled: !selectable }}
              accessibilityLabel={`${MONTHS[index] ?? ''} ${year}`}
            >
              <Text
                style={[
                  styles.monthChipText,
                  current && styles.monthChipTextActive,
                  !selectable && styles.dayDisabled,
                ]}
              >
                {label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.xs,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: spacing.sm,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  title: { ...typography.heading, color: colors.text },

  weekdayRow: { flexDirection: 'row' },
  weekday: {
    ...typography.caption,
    fontSize: 11,
    fontWeight: '600',
    color: colors.textMuted,
    flex: 1,
    textAlign: 'center',
    paddingBottom: spacing.xs,
  },
  week: { flexDirection: 'row' },
  cell: {
    flex: 1,
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    margin: 1,
  },
  cellSelected: { backgroundColor: colors.accent },
  day: { ...typography.body, fontSize: 14, color: colors.text },
  daySelected: { color: colors.onAccent, fontWeight: '700' },
  dayDisabled: { color: colors.textMuted, opacity: 0.5 },

  monthPane: { gap: spacing.md, paddingBottom: spacing.xs },
  yearRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.lg },
  year: { ...typography.heading, color: colors.text, minWidth: 56, textAlign: 'center' },
  monthWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, justifyContent: 'center' },
  monthChip: {
    width: '28%',
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
  },
  monthChipActive: { backgroundColor: colors.accent },
  monthChipText: { ...typography.caption, fontWeight: '600', color: colors.text },
  monthChipTextActive: { color: colors.onAccent },
});
