package ru.asntl.vclk.ui

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.FlipCameraAndroid
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.MicOff
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material.icons.filled.VideocamOff
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilledIconToggleButton
import androidx.compose.material3.FilledTonalIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import io.livekit.android.compose.ui.CameraPreview
import io.livekit.android.room.track.CameraPosition
import kotlinx.coroutines.launch
import ru.asntl.vclk.AppViewModel
import ru.asntl.vclk.data.ApiException
import ru.asntl.vclk.data.JoinTarget
import ru.asntl.vclk.util.NetworkQuality
import ru.asntl.vclk.util.avatarDataUrl
import ru.asntl.vclk.util.canJoin
import ru.asntl.vclk.util.networkQualityFromMbps

private fun Context.has(permission: String) =
    ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED

/** Оценка downlink по параметрам активной сети (как `navigator.connection.downlink` в вебе). */
private fun Context.networkInfo(): Pair<NetworkQuality, Double?> {
    val manager = getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
    val capabilities = manager?.activeNetwork?.let { manager.getNetworkCapabilities(it) }
    val mbps = capabilities?.linkDownstreamBandwidthKbps?.takeIf { it > 0 }?.let { it / 1000.0 }
    val hasInternet = capabilities?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) == true
    return (if (hasInternet) networkQualityFromMbps(mbps) else NetworkQuality.Unknown) to mbps
}

/**
 * Комната ожидания: единственное место до комнаты общения, где включается превью камеры/микрофона.
 * Для запланированной встречи имя берётся из профиля; для свободной комнаты нужен код комнаты.
 */
@Composable
fun WaitingRoomScreen(vm: AppViewModel, target: JoinTarget) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val isMeeting = target.meetingId != null
    var username by remember { mutableStateOf(vm.user?.displayName.orEmpty()) }
    var roomCode by remember { mutableStateOf(target.roomCode) }
    var title by remember { mutableStateOf(target.title) }
    var micOn by remember { mutableStateOf(true) }
    var cameraOn by remember { mutableStateOf(true) }
    var frontCamera by remember { mutableStateOf(true) }
    var previewPaused by remember { mutableStateOf(false) }
    var avatar by remember { mutableStateOf<Bitmap?>(null) }
    var joining by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var hasCamera by remember { mutableStateOf(context.has(Manifest.permission.CAMERA)) }
    var hasMic by remember { mutableStateOf(context.has(Manifest.permission.RECORD_AUDIO)) }
    val network = remember { context.networkInfo() }

    val permissionLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        hasCamera = context.has(Manifest.permission.CAMERA)
        hasMic = context.has(Manifest.permission.RECORD_AUDIO)
    }
    val photoLauncher = rememberLauncherForActivityResult(ActivityResultContracts.TakePicturePreview()) { bitmap ->
        previewPaused = false
        if (bitmap != null) avatar = bitmap
    }

    LaunchedEffect(Unit) {
        val needed = buildList {
            if (!hasCamera) add(Manifest.permission.CAMERA)
            if (!hasMic) add(Manifest.permission.RECORD_AUDIO)
            if (Build.VERSION.SDK_INT >= 33 && !context.has(Manifest.permission.POST_NOTIFICATIONS)) {
                add(Manifest.permission.POST_NOTIFICATIONS)
            }
        }
        if (needed.isNotEmpty()) permissionLauncher.launch(needed.toTypedArray())
    }
    LaunchedEffect(target.meetingId) {
        if (target.meetingId != null && title == null) {
            runCatching { vm.api.meeting(target.meetingId) }.onSuccess { title = it.title }
        }
    }
    BackHandler { vm.closeWaiting() }

    val nameOk = username.trim().isNotEmpty()
    val canSubmit = if (isMeeting) nameOk else canJoin(roomCode, username)

    fun join() {
        if (joining || !canSubmit) return
        joining = true
        error = null
        scope.launch {
            try {
                vm.startJoin(
                    target = target.copy(roomCode = roomCode),
                    username = username,
                    avatarDataUrl = avatar?.let(::avatarDataUrl),
                    micEnabled = micOn && hasMic,
                    cameraEnabled = cameraOn && hasCamera,
                    frontCamera = frontCamera,
                )
            } catch (caught: ApiException) {
                error = caught.message
                joining = false
            } catch (caught: Exception) {
                error = caught.message ?: "Неизвестная ошибка при входе в комнату"
                joining = false
            }
        }
    }

    Column(
        Modifier
            .fillMaxSize()
            .systemBarsPadding()
            .imePadding()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = { vm.closeWaiting() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Назад") }
            Column {
                Text("Комната ожидания", style = MaterialTheme.typography.titleLarge)
                Text(
                    if (isMeeting) (title ?: "Встреча") else "Свободная комната",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }

        // Превью камеры
        Box(
            Modifier
                .fillMaxWidth()
                .height(280.dp)
                .clip(RoundedCornerShape(16.dp))
                .background(MaterialTheme.colorScheme.surface),
            contentAlignment = Alignment.Center,
        ) {
            when {
                cameraOn && hasCamera && !previewPaused -> CameraPreview(
                    cameraPosition = if (frontCamera) CameraPosition.FRONT else CameraPosition.BACK,
                    mirror = frontCamera,
                    modifier = Modifier.fillMaxSize(),
                )
                avatar != null -> Image(
                    bitmap = avatar!!.asImageBitmap(),
                    contentDescription = "Фото профиля",
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.size(140.dp).clip(CircleShape),
                )
                else -> Text(
                    if (!hasCamera) "Нет доступа к камере" else "Камера выключена",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (avatar != null && cameraOn && hasCamera && !previewPaused) {
                Image(
                    bitmap = avatar!!.asImageBitmap(),
                    contentDescription = "Фото профиля",
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.align(Alignment.BottomEnd).padding(10.dp).size(56.dp).clip(CircleShape),
                )
            }
        }

        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterHorizontally)) {
            FilledIconToggleButton(checked = micOn && hasMic, onCheckedChange = { if (hasMic) micOn = it else permissionLauncher.launch(arrayOf(Manifest.permission.RECORD_AUDIO)) }) {
                Icon(if (micOn && hasMic) Icons.Filled.Mic else Icons.Filled.MicOff, contentDescription = "Микрофон")
            }
            FilledIconToggleButton(checked = cameraOn && hasCamera, onCheckedChange = { if (hasCamera) cameraOn = it else permissionLauncher.launch(arrayOf(Manifest.permission.CAMERA)) }) {
                Icon(if (cameraOn && hasCamera) Icons.Filled.Videocam else Icons.Filled.VideocamOff, contentDescription = "Камера")
            }
            FilledTonalIconButton(onClick = { frontCamera = !frontCamera }, enabled = cameraOn && hasCamera) {
                Icon(Icons.Filled.FlipCameraAndroid, contentDescription = "Сменить камеру")
            }
            FilledTonalIconButton(
                onClick = {
                    // Камеру нужно освободить, иначе системная камера не откроется.
                    previewPaused = true
                    photoLauncher.launch(null)
                },
                enabled = hasCamera,
            ) { Icon(Icons.Filled.CameraAlt, contentDescription = "Сделать фото профиля") }
        }
        Text(
            "Фото профиля показывается другим участникам, когда выключена камера.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        OutlinedTextField(
            value = username,
            onValueChange = { username = it },
            label = { Text("Ваше имя") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        if (!isMeeting) {
            OutlinedTextField(
                value = roomCode,
                onValueChange = { roomCode = it },
                label = { Text("Код комнаты") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Ascii),
                modifier = Modifier.fillMaxWidth(),
            )
        }

        // Диагностика
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text("Проверка устройства", style = MaterialTheme.typography.labelLarge)
            DiagnosticRow("Камера", if (hasCamera) "разрешена" else "нет доступа", hasCamera)
            DiagnosticRow("Микрофон", if (hasMic) "разрешён" else "нет доступа", hasMic)
            DiagnosticRow(
                "Сеть",
                network.first.label + (network.second?.let { " (≈ ${"%.0f".format(it)} Мбит/с)" } ?: ""),
                network.first == NetworkQuality.High || network.first == NetworkQuality.Medium,
            )
            if (!hasCamera || !hasMic) {
                OutlinedButton(
                    onClick = {
                        context.startActivity(
                            Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null))
                                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                        )
                    },
                ) { Text("Открыть настройки разрешений") }
            }
        }

        if (error != null) Text(error!!, color = MaterialTheme.colorScheme.error)
        Button(onClick = ::join, enabled = canSubmit && !joining, modifier = Modifier.fillMaxWidth()) {
            if (joining) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
            else Text(if (isMeeting) "Подключиться к встрече" else "Войти в комнату")
        }
    }
}

@Composable
private fun DiagnosticRow(label: String, value: String, ok: Boolean) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value, color = if (ok) VclkColors.Success else MaterialTheme.colorScheme.error)
    }
}
