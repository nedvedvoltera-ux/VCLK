package ru.asntl.vclk.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ru.asntl.vclk.util.CalEvent
import ru.asntl.vclk.util.CalendarMode
import ru.asntl.vclk.util.calendarTitle
import ru.asntl.vclk.util.dayOfWeekShort
import ru.asntl.vclk.util.eventsOnDay
import ru.asntl.vclk.util.formatTime
import ru.asntl.vclk.util.layoutLanes
import ru.asntl.vclk.util.monthGrid
import ru.asntl.vclk.util.segmentFor
import ru.asntl.vclk.util.shiftAnchor
import ru.asntl.vclk.util.weekDays
import java.time.LocalDate
import java.time.LocalDateTime

private val HOUR_HEIGHT = 56.dp
private val EVENT_COLOR = Color(0xFF2F5FD0)

/** Полный календарь встреч: месяц / неделя / день. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CalendarScreen(
    events: List<CalEvent>,
    onEventClick: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    var mode by rememberSaveable { mutableStateOf(CalendarMode.Month) }
    var anchorEpochDay by rememberSaveable { mutableStateOf(LocalDate.now().toEpochDay()) }
    val anchor = LocalDate.ofEpochDay(anchorEpochDay)
    val today = LocalDate.now()

    Column(modifier = modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = { anchorEpochDay = shiftAnchor(mode, anchor, -1).toEpochDay() }) {
                Icon(Icons.AutoMirrored.Filled.KeyboardArrowLeft, contentDescription = "Назад")
            }
            Text(
                calendarTitle(mode, anchor),
                modifier = Modifier.weight(1f),
                textAlign = TextAlign.Center,
                style = MaterialTheme.typography.titleMedium,
            )
            IconButton(onClick = { anchorEpochDay = shiftAnchor(mode, anchor, 1).toEpochDay() }) {
                Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = "Вперёд")
            }
        }
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            TextButton(onClick = { anchorEpochDay = today.toEpochDay() }) { Text("Сегодня") }
            SingleChoiceSegmentedButtonRow(Modifier.weight(1f)) {
                CalendarMode.entries.forEachIndexed { index, item ->
                    SegmentedButton(
                        selected = mode == item,
                        onClick = {
                            mode = item
                            // «неделя» и «день» открывают текущую неделю/день, а не первую неделю месяца
                            if (item != CalendarMode.Month) anchorEpochDay = today.toEpochDay()
                        },
                        shape = SegmentedButtonDefaults.itemShape(index, CalendarMode.entries.size),
                        label = { Text(item.label) },
                    )
                }
            }
        }
        when (mode) {
            CalendarMode.Month -> MonthGrid(
                anchor = anchor,
                events = events,
                compact = false,
                onDayClick = { day ->
                    anchorEpochDay = day.toEpochDay()
                    mode = CalendarMode.Day
                },
                onEventClick = onEventClick,
                modifier = Modifier.weight(1f),
            )
            CalendarMode.Week -> TimeGrid(weekDays(anchor), events, onEventClick, Modifier.weight(1f))
            CalendarMode.Day -> TimeGrid(listOf(anchor), events, onEventClick, Modifier.weight(1f))
        }
    }
}

private val WEEKDAYS = listOf("Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс")

/** Сетка месяца. В компактном виде (обзор) вместо названий — точки. */
@Composable
fun MonthGrid(
    anchor: LocalDate,
    events: List<CalEvent>,
    compact: Boolean,
    onDayClick: (LocalDate) -> Unit,
    onEventClick: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val today = LocalDate.now()
    val weeks = remember(anchor) { monthGrid(anchor) }
    Column(modifier.fillMaxWidth().padding(horizontal = 4.dp)) {
        Row(Modifier.fillMaxWidth()) {
            WEEKDAYS.forEach {
                Text(
                    it,
                    modifier = Modifier.weight(1f),
                    textAlign = TextAlign.Center,
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        val scrollModifier = if (compact) Modifier else Modifier.weight(1f).verticalScroll(rememberScrollState())
        Column(scrollModifier) {
            weeks.forEach { week ->
                Row(Modifier.fillMaxWidth()) {
                    week.forEach { day ->
                        val dayEvents = remember(events, day) { eventsOnDay(events, day) }
                        DayCell(
                            day = day,
                            inMonth = day.month == anchor.month,
                            isToday = day == today,
                            events = dayEvents,
                            compact = compact,
                            onDayClick = onDayClick,
                            onEventClick = onEventClick,
                            modifier = Modifier.weight(1f),
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun DayCell(
    day: LocalDate,
    inMonth: Boolean,
    isToday: Boolean,
    events: List<CalEvent>,
    compact: Boolean,
    onDayClick: (LocalDate) -> Unit,
    onEventClick: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val outline = MaterialTheme.colorScheme.outline.copy(alpha = 0.5f)
    Column(
        modifier
            .height(if (compact) 52.dp else 96.dp)
            .border(0.5.dp, outline)
            .clickable { onDayClick(day) }
            .padding(2.dp),
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Box(
            Modifier
                .size(22.dp)
                .clip(CircleShape)
                .background(if (isToday) MaterialTheme.colorScheme.primary else Color.Transparent),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                day.dayOfMonth.toString(),
                fontSize = 12.sp,
                color = when {
                    isToday -> Color.White
                    inMonth -> MaterialTheme.colorScheme.onSurface
                    else -> MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f)
                },
            )
        }
        if (compact) {
            if (events.isNotEmpty()) {
                Row(horizontalArrangement = Arrangement.spacedBy(2.dp), modifier = Modifier.padding(start = 2.dp)) {
                    repeat(minOf(events.size, 3)) {
                        Box(Modifier.size(5.dp).clip(CircleShape).background(MaterialTheme.colorScheme.primary))
                    }
                }
            }
        } else {
            events.take(2).forEach { event ->
                Text(
                    event.title,
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(3.dp))
                        .background(EVENT_COLOR)
                        .clickable { onEventClick(event.key) }
                        .padding(horizontal = 3.dp),
                    fontSize = 10.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    color = Color.White,
                )
            }
            if (events.size > 2) {
                Text("+${events.size - 2}", fontSize = 10.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

/** Недельная/дневная сетка со временем по вертикали. */
@Composable
fun TimeGrid(
    days: List<LocalDate>,
    events: List<CalEvent>,
    onEventClick: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val today = LocalDate.now()
    val density = LocalDensity.current
    val scroll = rememberScrollState(with(density) { (HOUR_HEIGHT * 7).roundToPx() })
    val labelWidth = 40.dp
    val lineColor = MaterialTheme.colorScheme.outline.copy(alpha = 0.45f)

    Column(modifier.fillMaxWidth()) {
        Row(Modifier.fillMaxWidth().padding(start = labelWidth)) {
            days.forEach { day ->
                Column(Modifier.weight(1f).padding(vertical = 4.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(dayOfWeekShort(day), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Box(
                        Modifier
                            .size(26.dp)
                            .clip(CircleShape)
                            .background(if (day == today) MaterialTheme.colorScheme.primary else Color.Transparent),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            day.dayOfMonth.toString(),
                            fontSize = 13.sp,
                            fontWeight = FontWeight.Medium,
                            color = if (day == today) Color.White else MaterialTheme.colorScheme.onSurface,
                        )
                    }
                }
            }
        }
        Row(Modifier.fillMaxWidth().weight(1f).verticalScroll(scroll)) {
            Column(Modifier.width(labelWidth)) {
                repeat(24) { hour ->
                    Box(Modifier.height(HOUR_HEIGHT), contentAlignment = Alignment.TopEnd) {
                        Text(
                            "%02d:00".format(hour),
                            fontSize = 10.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(end = 4.dp),
                        )
                    }
                }
            }
            days.forEach { day ->
                DayColumn(
                    day = day,
                    events = events,
                    isToday = day == today,
                    lineColor = lineColor,
                    onEventClick = onEventClick,
                    modifier = Modifier.weight(1f),
                )
            }
        }
    }
}

@Composable
private fun DayColumn(
    day: LocalDate,
    events: List<CalEvent>,
    isToday: Boolean,
    lineColor: Color,
    onEventClick: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val segments = remember(events, day) { layoutLanes(eventsOnDay(events, day).map { segmentFor(it, day) }) }
    val minuteHeight: Dp = HOUR_HEIGHT / 60
    BoxWithConstraints(
        modifier
            .height(HOUR_HEIGHT * 24)
            .drawBehind {
                val hour = HOUR_HEIGHT.toPx()
                repeat(24) { index -> drawLine(lineColor, Offset(0f, index * hour), Offset(size.width, index * hour), 1f) }
                drawLine(lineColor, Offset(0f, 0f), Offset(0f, size.height), 1f)
            },
    ) {
        segments.forEach { laid ->
            val segment = laid.segment
            val width = maxWidth / laid.lanes
            Column(
                Modifier
                    .offset(x = width * laid.lane, y = minuteHeight * segment.startMinute)
                    .width(width)
                    .height(minuteHeight * (segment.endMinute - segment.startMinute))
                    .padding(1.dp)
                    .clip(RoundedCornerShape(4.dp))
                    .background(EVENT_COLOR)
                    .clickable { onEventClick(segment.event.key) }
                    .padding(horizontal = 3.dp, vertical = 1.dp),
            ) {
                Text(segment.event.title, fontSize = 10.sp, maxLines = 2, overflow = TextOverflow.Ellipsis, color = Color.White, fontWeight = FontWeight.Medium)
                Text(formatTime(segment.event.start), fontSize = 9.sp, color = Color.White.copy(alpha = 0.8f), maxLines = 1)
            }
        }
        if (isToday) {
            val now = LocalDateTime.now()
            Box(
                Modifier
                    .offset(y = minuteHeight * (now.hour * 60 + now.minute))
                    .fillMaxWidth()
                    .height(2.dp)
                    .background(MaterialTheme.colorScheme.error),
            )
        }
    }
}
