import XCTest
@testable import Vclk

final class HelpersTests: XCTestCase {
    func testNormalizeServerUrl() {
        XCTAssertEqual(normalizeServerUrl("vclk.company.ru"), "https://vclk.company.ru")
        XCTAssertEqual(normalizeServerUrl("  http://192.168.1.5:8080/path "), "http://192.168.1.5:8080")
        XCTAssertEqual(normalizeServerUrl("HTTPS://host"), "https://host")
        XCTAssertNil(normalizeServerUrl(""))
        XCTAssertNil(normalizeServerUrl("ftp://host"))
    }

    func testSignalingUrl() {
        XCTAssertEqual(buildSignalingUrl("https://vclk.ru"), "wss://vclk.ru/livekit")
        XCTAssertEqual(buildSignalingUrl("http://10.0.0.1:8080"), "ws://10.0.0.1:8080/livekit")
    }

    func testLinks() {
        XCTAssertEqual(buildInviteLink("https://h", room: " my room "), "https://h/room?room=my%20room")
        XCTAssertEqual(buildInviteLink("https://h", room: ""), "https://h/room?room=demo-room")
        XCTAssertEqual(buildMeetingLink("https://h", meetingId: "abc"), "https://h/room?meeting=abc")
    }

    func testCanJoinAndChat() {
        XCTAssertTrue(canJoin(room: "r", username: "u"))
        XCTAssertFalse(canJoin(room: " ", username: "u"))
        XCTAssertFalse(canJoin(room: "r", username: ""))
        XCTAssertTrue(isNonEmptyChatMessage(" hi "))
        XCTAssertFalse(isNonEmptyChatMessage("   "))
    }

    func testAttachmentMimeType() {
        XCTAssertEqual(attachmentMimeType("a.PDF"), "application/pdf")
        XCTAssertEqual(attachmentMimeType("photo.jpeg"), "image/jpeg")
        XCTAssertNil(attachmentMimeType("virus.exe"))
        XCTAssertNil(attachmentMimeType("noext"))
    }

    func testAutoRecording() {
        XCTAssertTrue(shouldAutoStartRecording(recordingEnabled: true, participantCount: 2, alreadyRecording: false, alreadyAttempted: false))
        XCTAssertFalse(shouldAutoStartRecording(recordingEnabled: true, participantCount: 1, alreadyRecording: false, alreadyAttempted: false))
        XCTAssertFalse(shouldAutoStartRecording(recordingEnabled: false, participantCount: 3, alreadyRecording: false, alreadyAttempted: false))
        XCTAssertFalse(shouldAutoStartRecording(recordingEnabled: true, participantCount: 3, alreadyRecording: true, alreadyAttempted: false))
        XCTAssertFalse(shouldAutoStartRecording(recordingEnabled: true, participantCount: 3, alreadyRecording: false, alreadyAttempted: true))
    }

    func testScreenSharePriorityKeepsOrder() {
        let result = sortByScreenSharePriority(["cam1", "screen", "cam2", "screen2"]) { $0.hasPrefix("screen") }
        XCTAssertEqual(result, ["screen", "screen2", "cam1", "cam2"])
    }

    func testMobileLayout() {
        XCTAssertEqual(mobileLayoutMode(trackCount: 0), .single)
        XCTAssertEqual(mobileLayoutMode(trackCount: 1), .single)
        XCTAssertEqual(mobileLayoutMode(trackCount: 2), .two)
        XCTAssertEqual(mobileLayoutMode(trackCount: 5), .stack)
    }

    func testAvatarUrl() {
        XCTAssertEqual(parseParticipantAvatarUrl("{\"avatarUrl\":\"/avatar/1.jpg\"}", serverUrl: "https://h/"), "https://h/avatar/1.jpg")
        XCTAssertEqual(parseParticipantAvatarUrl("{\"avatarUrl\":\"https://x/y.jpg\"}", serverUrl: "https://h"), "https://x/y.jpg")
        XCTAssertNil(parseParticipantAvatarUrl("{}", serverUrl: "https://h"))
        XCTAssertNil(parseParticipantAvatarUrl(nil, serverUrl: "https://h"))
    }

    func testShiftSeriesTime() {
        let series = Date(timeIntervalSince1970: 1_000_000)
        let occurrence = Date(timeIntervalSince1970: 1_000_000 + 7 * 86_400)
        let moved = occurrence.addingTimeInterval(1_800)
        XCTAssertEqual(shiftSeriesTime(seriesTime: series, occurrenceTime: occurrence, newTime: moved),
                       series.addingTimeInterval(1_800))
    }

    func testUpcomingDistinctSeries() {
        struct Item { let id: String; let ends: Date; let scheduled: Bool }
        let now = Date(timeIntervalSince1970: 1_000)
        let items = [
            Item(id: "a", ends: Date(timeIntervalSince1970: 500), scheduled: true),   // закончилась
            Item(id: "b", ends: Date(timeIntervalSince1970: 2_000), scheduled: true),
            Item(id: "b", ends: Date(timeIntervalSince1970: 3_000), scheduled: true), // та же серия
            Item(id: "c", ends: Date(timeIntervalSince1970: 4_000), scheduled: false),
            Item(id: "d", ends: Date(timeIntervalSince1970: 5_000), scheduled: true),
        ]
        let result = upcomingDistinctSeries(items, now: now, limit: 5, idOf: { $0.id }, endsAtOf: { $0.ends }, isScheduled: { $0.scheduled })
        XCTAssertEqual(result.map { $0.id }, ["b", "d"])
        XCTAssertEqual(upcomingDistinctSeries(items, now: now, limit: 1, idOf: { $0.id }, endsAtOf: { $0.ends }, isScheduled: { $0.scheduled }).count, 1)
    }

    func testTokenizeLinks() {
        let tokens = tokenizeLinks("см. https://a.ru/x, пишите me@a.ru и www.b.ru.")
        XCTAssertEqual(tokens.filter { $0.kind != .text }.map { $0.href }, ["https://a.ru/x", "mailto:me@a.ru", "https://www.b.ru"])
        XCTAssertEqual(tokenizeLinks("без ссылок").count, 1)
    }

    func testSafeFileName() {
        XCTAssertEqual(safeFileName("a/b:c*.pdf"), "a_b_c_.pdf")
        XCTAssertEqual(safeFileName("   "), "attachment")
    }

    func testRecurrence() {
        XCTAssertEqual(Recurrence.from("weekly"), .weekly)
        XCTAssertEqual(Recurrence.from("zzz"), .none)
        XCTAssertEqual(Recurrence.from(nil), .none)
    }

    func testReminderLabel() {
        XCTAssertEqual(reminderLabel(nil), "Без напоминания")
        XCTAssertEqual(reminderLabel(60), "За 1 час")
        XCTAssertEqual(reminderLabel(15), "За 15 мин.")
    }

    func testParseInstant() {
        XCTAssertEqual(parseInstant("2026-01-02T03:04:05Z"), parseInstant("2026-01-02T03:04:05.000Z"))
        XCTAssertEqual(toIsoString(parseInstant("2026-01-02T03:04:05Z")), "2026-01-02T03:04:05Z")
    }
}
