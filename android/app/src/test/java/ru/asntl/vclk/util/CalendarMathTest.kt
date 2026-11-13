package ru.asntl.vclk.util

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.LocalDateTime

class CalendarMathTest {
    private fun event(key: String, start: String, end: String) =
        CalEvent(key, key, LocalDateTime.parse(start), LocalDateTime.parse(end))

    @Test
    fun weekStartsOnMonday() {
        val days = weekDays(LocalDate.of(2026, 11, 12)) // четверг
        assertEquals(LocalDate.of(2026, 11, 9), days.first())
        assertEquals(DayOfWeek.MONDAY, days.first().dayOfWeek)
        assertEquals(LocalDate.of(2026, 11, 15), days.last())
    }

    @Test
    fun monthGridCoversWholeMonthWithFullWeeks() {
        val grid = monthGrid(LocalDate.of(2026, 11, 12))
        assertTrue(grid.all { it.size == 7 })
        assertEquals(LocalDate.of(2026, 10, 26), grid.first().first())
        assertEquals(LocalDate.of(2026, 12, 6), grid.last().last())
        assertTrue(grid.flatten().contains(LocalDate.of(2026, 11, 30)))
    }

    @Test
    fun eventOverlapsEveryDayItTouches() {
        val night = event("night", "2026-11-12T23:00", "2026-11-13T01:00")
        assertTrue(overlapsDay(night, LocalDate.of(2026, 11, 12)))
        assertTrue(overlapsDay(night, LocalDate.of(2026, 11, 13)))
        assertFalse(overlapsDay(night, LocalDate.of(2026, 11, 14)))
        val ends = event("ends", "2026-11-12T10:00", "2026-11-13T00:00")
        assertFalse(overlapsDay(ends, LocalDate.of(2026, 11, 13)))
    }

    @Test
    fun segmentIsClippedToDay() {
        val night = event("night", "2026-11-12T23:00", "2026-11-13T01:00")
        val first = segmentFor(night, LocalDate.of(2026, 11, 12))
        val second = segmentFor(night, LocalDate.of(2026, 11, 13))
        assertEquals(23 * 60, first.startMinute)
        assertEquals(24 * 60, first.endMinute)
        assertEquals(0, second.startMinute)
        assertEquals(60, second.endMinute)
    }

    @Test
    fun overlappingEventsGetSeparateLanes() {
        val day = LocalDate.of(2026, 11, 12)
        val a = segmentFor(event("a", "2026-11-12T10:00", "2026-11-12T11:00"), day)
        val b = segmentFor(event("b", "2026-11-12T10:30", "2026-11-12T11:30"), day)
        val c = segmentFor(event("c", "2026-11-12T13:00", "2026-11-12T14:00"), day)
        val laid = layoutLanes(listOf(a, b, c)).associateBy { it.segment.event.key }
        assertEquals(2, laid.getValue("a").lanes)
        assertEquals(2, laid.getValue("b").lanes)
        assertEquals(setOf(0, 1), setOf(laid.getValue("a").lane, laid.getValue("b").lane))
        assertEquals(1, laid.getValue("c").lanes)
        assertEquals(0, laid.getValue("c").lane)
    }

    @Test
    fun navigationStepsByMode() {
        val anchor = LocalDate.of(2026, 1, 31)
        assertEquals(LocalDate.of(2026, 2, 1), shiftAnchor(CalendarMode.Month, anchor, 1))
        assertEquals(LocalDate.of(2026, 2, 7), shiftAnchor(CalendarMode.Week, anchor, 1))
        assertEquals(LocalDate.of(2026, 1, 30), shiftAnchor(CalendarMode.Day, anchor, -1))
    }

    @Test
    fun titles() {
        assertEquals("Ноябрь 2026", calendarTitle(CalendarMode.Month, LocalDate.of(2026, 11, 12)))
        assertTrue(calendarTitle(CalendarMode.Week, LocalDate.of(2026, 11, 12)).endsWith("2026"))
    }
}
