package ru.asntl.vclk

import android.app.Application
import io.livekit.android.LiveKit

class VclkApp : Application() {
    override fun onCreate() {
        super.onCreate()
        // CameraPreview в комнате ожидания работает без Room — WebRTC нужно инициализировать заранее.
        LiveKit.init(this)
    }
}
