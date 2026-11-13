package ru.asntl.vclk.util

import android.graphics.Bitmap
import android.util.Base64
import java.io.ByteArrayOutputStream

private const val AVATAR_SIZE = 192

/** Фото профиля как в вебе: квадрат по центру, 192×192, JPEG с качеством 82, data URL. */
fun avatarDataUrl(source: Bitmap): String {
    val side = minOf(source.width, source.height)
    val x = (source.width - side) / 2
    val y = (source.height - side) / 2
    val square = Bitmap.createBitmap(source, x, y, side, side)
    val scaled = Bitmap.createScaledBitmap(square, AVATAR_SIZE, AVATAR_SIZE, true)
    val output = ByteArrayOutputStream()
    scaled.compress(Bitmap.CompressFormat.JPEG, 82, output)
    return "data:image/jpeg;base64," + Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP)
}
