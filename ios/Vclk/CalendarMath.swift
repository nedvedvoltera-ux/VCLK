import Foundation

enum CalendarMode: String, CaseIterable {
    case month = "месяц"
    case week = "неделя"
    case day = "день"
}

/// Событие календаря в локальном времени устройства.
struct CalEvent {
    let key: String
    let title: String
    let start: Date
    let end: Date
}

/// Григорианский календарь, неделя начинается с понедельника.
let ruCalendar: Calendar = {
    var calendar = Calendar(identifier: .gregorian)
    calendar.locale = ruLocale
    calendar.firstWeekday = 2
    calendar.minimumDaysInFirstWeek = 4
    return calendar
}()

func startOfDay(_ date: Date) -> Date { ruCalendar.startOfDay(for: date) }

func addDays(_ date: Date, _ days: Int) -> Date {
    ruCalendar.date(byAdding: .day, value: days, to: date) ?? date
}

func startOfWeek(_ date: Date) -> Date {
    let day = startOfDay(date)
    let weekday = ruCalendar.component(.weekday, from: day) // 1 = воскресенье
    return addDays(day, -((weekday + 5) % 7))
}

func weekDays(_ anchor: Date) -> [Date] {
    let start = startOfWeek(anchor)
    return (0..<7).map { addDays(start, $0) }
}

func startOfMonth(_ date: Date) -> Date {
    let parts = ruCalendar.dateComponents([.year, .month], from: date)
    return ruCalendar.date(from: parts) ?? startOfDay(date)
}

/// Недели месяца (понедельник первый день), включая «хвосты» соседних месяцев.
func monthGrid(_ anchor: Date) -> [[Date]] {
    let first = startOfMonth(anchor)
    let dayCount = ruCalendar.range(of: .day, in: .month, for: first)?.count ?? 30
    let last = addDays(first, dayCount - 1)
    var weeks: [[Date]] = []
    var cursor = startOfWeek(first)
    while cursor <= last {
        weeks.append((0..<7).map { addDays(cursor, $0) })
        cursor = addDays(cursor, 7)
    }
    return weeks
}

func overlapsDay(_ event: CalEvent, _ day: Date) -> Bool {
    let dayStart = startOfDay(day)
    let dayEnd = addDays(dayStart, 1)
    return event.start < dayEnd && event.end > dayStart
}

func eventsOnDay(_ events: [CalEvent], _ day: Date) -> [CalEvent] {
    events.filter { overlapsDay($0, day) }.sorted {
        $0.start == $1.start ? $0.end < $1.end : $0.start < $1.start
    }
}

func isSameDay(_ lhs: Date, _ rhs: Date) -> Bool { ruCalendar.isDate(lhs, inSameDayAs: rhs) }

func shiftAnchor(_ mode: CalendarMode, _ anchor: Date, direction: Int) -> Date {
    switch mode {
    case .month:
        return ruCalendar.date(byAdding: .month, value: direction, to: startOfMonth(anchor)) ?? anchor
    case .week:
        return addDays(anchor, 7 * direction)
    case .day:
        return addDays(anchor, direction)
    }
}

private func formatter(_ format: String) -> DateFormatter {
    let formatter = DateFormatter()
    formatter.locale = ruLocale
    formatter.calendar = ruCalendar
    formatter.dateFormat = format
    return formatter
}

private func capitalizedFirst(_ text: String) -> String {
    guard let first = text.first else { return text }
    return String(first).uppercased() + String(text.dropFirst())
}

func calendarTitle(_ mode: CalendarMode, _ anchor: Date) -> String {
    switch mode {
    case .month:
        return capitalizedFirst(formatter("LLLL yyyy").string(from: anchor))
    case .day:
        return formatter("d MMMM yyyy").string(from: anchor)
    case .week:
        let days = weekDays(anchor)
        guard let first = days.first, let last = days.last else { return "" }
        let firstYear = ruCalendar.component(.year, from: first)
        let lastYear = ruCalendar.component(.year, from: last)
        if firstYear == lastYear {
            let dayMonth = formatter("d MMM")
            return "\(dayMonth.string(from: first)) – \(dayMonth.string(from: last)) \(lastYear)"
        }
        let full = formatter("d MMM yyyy")
        return "\(full.string(from: first)) – \(full.string(from: last))"
    }
}

func dayOfWeekShort(_ day: Date) -> String {
    capitalizedFirst(formatter("EE").string(from: day))
}

func dayLabel(_ day: Date) -> String {
    capitalizedFirst(formatter("EEEE, d MMMM").string(from: day))
}
