import XCTest
@testable import Vclk

final class CalendarMathTests: XCTestCase {
    private func date(_ year: Int, _ month: Int, _ day: Int, _ hour: Int = 0, _ minute: Int = 0) -> Date {
        ruCalendar.date(from: DateComponents(year: year, month: month, day: day, hour: hour, minute: minute))!
    }

    func testStartOfWeekIsMonday() {
        // 13 ноября 2026 — пятница, понедельник — 9 ноября.
        XCTAssertEqual(startOfWeek(date(2026, 11, 13)), date(2026, 11, 9))
        // Воскресенье относится к предыдущей неделе.
        XCTAssertEqual(startOfWeek(date(2026, 11, 15)), date(2026, 11, 9))
        XCTAssertEqual(startOfWeek(date(2026, 11, 9)), date(2026, 11, 9))
    }

    func testWeekHasSevenDays() {
        let days = weekDays(date(2026, 11, 13))
        XCTAssertEqual(days.count, 7)
        XCTAssertEqual(days.first, date(2026, 11, 9))
        XCTAssertEqual(days.last, date(2026, 11, 15))
    }

    func testMonthGridCoversMonth() {
        let weeks = monthGrid(date(2026, 11, 13))
        XCTAssertTrue(weeks.allSatisfy { $0.count == 7 })
        XCTAssertEqual(weeks.first?.first, date(2026, 10, 26))
        XCTAssertEqual(weeks.last?.last, date(2026, 12, 6))
        XCTAssertEqual(weeks.count, 6)
    }

    func testEventsOnDayIncludesMultiDayAndSorts() {
        let late = CalEvent(key: "late", title: "late", start: date(2026, 11, 13, 15), end: date(2026, 11, 13, 16))
        let early = CalEvent(key: "early", title: "early", start: date(2026, 11, 13, 9), end: date(2026, 11, 13, 10))
        let overnight = CalEvent(key: "night", title: "night", start: date(2026, 11, 12, 22), end: date(2026, 11, 13, 1))
        let other = CalEvent(key: "other", title: "other", start: date(2026, 11, 14, 9), end: date(2026, 11, 14, 10))
        let result = eventsOnDay([late, early, overnight, other], date(2026, 11, 13)).map { $0.key }
        XCTAssertEqual(result, ["night", "early", "late"])
    }

    func testEventEndingAtMidnightDoesNotLeakToNextDay() {
        let event = CalEvent(key: "e", title: "e", start: date(2026, 11, 13, 23), end: date(2026, 11, 14, 0))
        XCTAssertTrue(overlapsDay(event, date(2026, 11, 13)))
        XCTAssertFalse(overlapsDay(event, date(2026, 11, 14)))
    }

    func testShiftAnchor() {
        XCTAssertEqual(shiftAnchor(.month, date(2026, 11, 13), direction: 1), date(2026, 12, 1))
        XCTAssertEqual(shiftAnchor(.month, date(2026, 1, 20), direction: -1), date(2025, 12, 1))
        XCTAssertEqual(shiftAnchor(.week, date(2026, 11, 13), direction: 1), date(2026, 11, 20))
        XCTAssertEqual(shiftAnchor(.day, date(2026, 11, 13), direction: -1), date(2026, 11, 12))
    }

    func testCalendarTitles() {
        XCTAssertEqual(calendarTitle(.month, date(2026, 11, 13)), "Ноябрь 2026")
        XCTAssertTrue(calendarTitle(.day, date(2026, 11, 13)).hasPrefix("13 ноября"))
        XCTAssertTrue(calendarTitle(.week, date(2026, 11, 13)).hasSuffix("2026"))
    }
}
