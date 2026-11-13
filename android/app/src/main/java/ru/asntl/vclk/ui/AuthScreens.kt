package ru.asntl.vclk.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import ru.asntl.vclk.AppViewModel
import ru.asntl.vclk.data.ApiException
import ru.asntl.vclk.data.InviteInfo
import ru.asntl.vclk.data.JoinTarget
import ru.asntl.vclk.util.formatDateTime

@Composable
private fun AuthCard(eyebrow: String, title: String, subtitle: String?, content: @Composable () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .systemBarsPadding()
            .imePadding()
            .verticalScroll(rememberScrollState())
            .padding(20.dp),
        verticalArrangement = Arrangement.Center,
    ) {
        Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
            Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(eyebrow, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
                Text(title, style = MaterialTheme.typography.headlineSmall)
                if (subtitle != null) {
                    Text(subtitle, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                content()
            }
        }
    }
}

@Composable
private fun ErrorText(message: String?) {
    if (!message.isNullOrBlank()) {
        Text(message, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
    }
}

/** Первый запуск: адрес сервера VCLK. */
@Composable
fun ServerScreen(vm: AppViewModel) {
    var address by remember { mutableStateOf(vm.serverUrl ?: "https://") }
    var error by remember { mutableStateOf<String?>(null) }
    AuthCard(
        eyebrow = "VCLK",
        title = "Подключение к серверу",
        subtitle = "Укажите адрес вашего сервера видеовстреч. Его выдаёт администратор.",
    ) {
        OutlinedTextField(
            value = address,
            onValueChange = { address = it; error = null },
            label = { Text("Адрес сервера") },
            placeholder = { Text("https://vclk.company.ru") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
            modifier = Modifier.fillMaxWidth(),
        )
        ErrorText(error)
        Button(onClick = { error = vm.setServer(address) }, modifier = Modifier.fillMaxWidth()) { Text("Продолжить") }
    }
}

/** Вход, либо создание первого администратора, если система ещё не настроена. */
@Composable
fun AuthScreen(vm: AppViewModel) {
    val setup = vm.modes.setupRequired
    var displayName by remember { mutableStateOf("") }
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var ldap by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    fun submit() {
        if (busy) return
        if (password.length < 10) {
            error = "Пароль должен содержать минимум 10 символов"
            return
        }
        busy = true
        error = null
        scope.launch {
            try {
                if (setup) vm.setupAdmin(email, password, displayName) else vm.login(email, password, ldap)
            } catch (caught: ApiException) {
                error = caught.message
            } finally {
                busy = false
            }
        }
    }

    AuthCard(
        eyebrow = "VCLK",
        title = if (setup) "Создание администратора" else "Вход в VCLK",
        subtitle = if (setup) {
            "Первый аккаунт получит полный доступ к пользователям, календарю и интеграциям."
        } else {
            "Войдите в корпоративную систему видеовстреч."
        },
    ) {
        if (setup) {
            OutlinedTextField(
                value = displayName,
                onValueChange = { displayName = it },
                label = { Text("Ваше имя") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
        }
        OutlinedTextField(
            value = email,
            onValueChange = { email = it },
            label = { Text("Корпоративный e-mail") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
            value = password,
            onValueChange = { password = it },
            label = { Text("Пароль") },
            singleLine = true,
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
            modifier = Modifier.fillMaxWidth(),
        )
        if (!setup) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(checked = ldap, onCheckedChange = { ldap = it })
                Text("Войти через AD/LDAP")
            }
        }
        ErrorText(error ?: vm.loadError)
        Button(
            onClick = ::submit,
            enabled = !busy && email.isNotBlank() && password.isNotEmpty() && (!setup || displayName.isNotBlank()),
            modifier = Modifier.fillMaxWidth(),
        ) {
            if (busy) CircularProgressIndicator(Modifier.height(18.dp), strokeWidth = 2.dp)
            else Text(if (setup) "Создать администратора" else "Войти")
        }
        if (!setup && vm.modes.freeMode) {
            TextButton(onClick = { vm.openWaiting(JoinTarget()) }, modifier = Modifier.fillMaxWidth()) {
                Text("Войти в свободную комнату без учётной записи")
            }
        }
        Spacer(Modifier.height(4.dp))
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Text(
                vm.serverUrl.orEmpty().removePrefix("https://").removePrefix("http://"),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.weight(1f),
            )
            TextButton(onClick = { vm.changeServer() }) { Text("Сменить сервер") }
        }
    }
}

/** Активация персонального приглашения (`/invite/<token>`). */
@Composable
fun InviteScreen(vm: AppViewModel, token: String) {
    var invite by remember { mutableStateOf<InviteInfo?>(null) }
    var displayName by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(token) {
        try {
            invite = vm.api.inviteInfo(token)
        } catch (caught: ApiException) {
            error = caught.message
        }
    }

    AuthCard(
        eyebrow = "Приглашение VCLK",
        title = invite?.title ?: "Проверяем приглашение…",
        subtitle = invite?.let {
            "Вы приглашены на ${if (it.startsAt.isNotEmpty()) formatDateTime(it.startsAt) else "встречу"}. Активируйте доступ для ${it.email}."
        },
    ) {
        OutlinedTextField(
            value = displayName,
            onValueChange = { displayName = it },
            label = { Text("Ваше имя") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
            value = password,
            onValueChange = { password = it },
            label = { Text("Создайте пароль (от 10 символов)") },
            singleLine = true,
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
            modifier = Modifier.fillMaxWidth(),
        )
        ErrorText(error)
        Button(
            onClick = {
                if (password.length < 10) {
                    error = "Пароль должен содержать минимум 10 символов"
                    return@Button
                }
                busy = true
                error = null
                scope.launch {
                    try {
                        val result = vm.api.activateInvite(token, displayName.trim(), password)
                        vm.finishInviteActivation(result.user, result.meetingId)
                    } catch (caught: ApiException) {
                        error = caught.message
                    } finally {
                        busy = false
                    }
                }
            },
            enabled = invite != null && !busy && displayName.isNotBlank() && password.isNotEmpty(),
            modifier = Modifier.fillMaxWidth(),
        ) { Text("Активировать и подключиться") }
        TextButton(onClick = { vm.cancelInvite() }, modifier = Modifier.fillMaxWidth()) { Text("Отмена") }
    }
}
