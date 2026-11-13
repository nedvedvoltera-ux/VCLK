package ru.asntl.vclk.util

import java.time.DayOfWeek
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter
import java.time.temporal.TemporalAdjusters

enum class CalendarMode(val label: String) { Month("месяц"), Week("неделя"), Day("день") }

/** Событие календаря в локальном времени устройства. */
data class CalEvent(val key: String, val title: String, val start: LocalDateTime, val end: LocalDateTime)

/** Отрезок события внутри одних суток, в минутах от полуночи. */
data class DaySegment(val event: CalEvent, val startMinute: Int, val endMinute: Int)

data class LaidOutSegment(val segment: DaySegment, val lane: Int, val lanes: Int)

fun startOfWeek(date: LocalDate): LocalDate = date.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY))

fun weekDays(anchor: LocalDate): List<LocalDate> = startOfWeek(anchor).let { start -> (0..6).map { start.plusDays(it.toLong()) } }

/** Недели месяца (понедельник первый день), включая «хвосты» соседних месяцев. */
fun monthGrid(anchor: LocalDate): List<List<LocalDate>> {
    val first = anchor.withDayOfMonth(1)
    val last = anchor.withDayOfMonth(anchor.lengthOfMonth())
    val weeks = ArrayList<List<LocalDate>>()
    var cursor = startOfWeek(first)
    while (!cursor.isAfter(last)) {
        weeks.add((0..6).map { cursor.plusDays(it.toLong()) })
        cursor = cursor.plusWeeks(1)
    }
    return weeks
}

fun overlapsDay(event: CalEvent, day: LocalDate): Boolean {
    val dayStart = day.atStartOfDay()
    return event.start < dayStart.plusDays(1) && event.end > dayStart
}

fun eventsOnDay(events: List<CalEvent>, day: LocalDate): List<CalEvent> =
    events.filter { overlapsDay(it, day) }.sortedWith(compareBy({ it.start }, { it.end }))

fun segmentFor(event: CalEvent, day: LocalDate): DaySegment {
    val dayStart = day.atStartOfDay()
    val start = if (event.start.isBefore(dayStart)) dayStart else event.start
    val endLimit = dayStart.plusDays(1)
    val end = if (event.end.isAfter(endLimit)) endLimit else event.end
    val startMinute = java.time.Duration.between(dayStart, start).toMinutes().toInt()
    val endMinute = java.time.Duration.between(dayStart, end).toMinutes().toInt()
    return DaySegment(event, startMinute, maxOf(endMinute, startMinute + 20))
}

/** Раскладывает пересекающиеся события в параллельные колонки (как в календаре недели). */
fun layoutLanes(segments: List<DaySegment>): List<LaidOutSegment> {
    val sorted = segments.sortedWith(compareBy({ it.startMinute }, { -it.endMinute }))
    val result = ArrayList<LaidOutSegment>()
    var cluster = ArrayList<Pair<DaySegment, Int>>()
    var laneEnds = ArrayList<Int>()
    var clusterEnd = -1

    fun flush() {
        val lanes = laneEnds.size.coerceAtLeast(1)
        cluster.forEach { (segment, lane) -> result.add(LaidOutSegment(segment, lane, lanes)) }
        cluster = ArrayList()
        laneEnds = ArrayList()
    }

    for (segment in sorted) {
        if (cluster.isNotEmpty() && segment.startMinute >= clusterEnd) flush()
        var lane = laneEnds.indexOfFirst { it <= segment.startMinute }
        if (lane == -1) {
            lane = laneEnds.size
            laneEnds.add(segment.endMinute)
        } else {
            laneEnds[lane] = segment.endMinute
        }
        cluster.add(segment to lane)
        clusterEnd = if (cluster.size == 1) segment.endMinute else maxOf(clusterEnd, segment.endMinute)
    }
    if (cluster.isNotEmpty()) flush()
    return result
}

fun shiftAnchor(mode: CalendarMode, anchor: LocalDate, direction: Int): LocalDate = when (mode) {
    CalendarMode.Month -> anchor.withDayOfMonth(1).plusMonths(direction.toLong())
    CalendarMode.Week -> anchor.plusWeeks(direction.toLong())
    CalendarMode.Day -> anchor.plusDays(direction.toLong())
}

fun calendarTitle(mode: CalendarMode, anchor: LocalDate): String = when (mode) {
    CalendarMode.Month -> DateTimeFormatter.ofPattern("LLLL yyyy", RU).format(anchor).replaceFirstChar { it.uppercase() }
    CalendarMode.Day -> DateTimeFormatter.ofPattern("d MMMM yyyy", RU).format(anchor)
    CalendarMode.Week -> {
        val days = weekDays(anchor)
        val first = days.first()
        val last = days.last()
        val dayMonth = DateTimeFormatter.ofPattern("d MMM", RU)
        if (first.year == last.year) {
            "${dayMonth.format(first)} – ${dayMonth.format(last)} ${last.year}"
        } else {
            "${DateTimeFormatter.ofPattern("d MMM yyyy", RU).format(first)} – ${DateTimeFormatter.ofPattern("d MMM yyyy", RU).format(last)}"
        }
    }
}

fun dayOfWeekShort(day: LocalDate): String =
    DateTimeFormatter.ofPattern("EEE", RU).format(day).replaceFirstChar { it.uppercase() }
