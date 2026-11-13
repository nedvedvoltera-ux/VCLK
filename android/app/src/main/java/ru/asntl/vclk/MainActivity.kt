package ru.asntl.vclk

import android.content.ActivityNotFoundException
import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.core.content.FileProvider
import ru.asntl.vclk.ui.AuthScreen
import ru.asntl.vclk.ui.InviteScreen
import ru.asntl.vclk.ui.MainScreen
import ru.asntl.vclk.ui.RoomScreen
import ru.asntl.vclk.ui.ServerScreen
import ru.asntl.vclk.ui.VclkTheme
import ru.asntl.vclk.ui.WaitingRoomScreen

class MainActivity : ComponentActivity() {
    private val vm: AppViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        if (savedInstanceState == null) intent?.data?.let(vm::handleLink)
        setContent {
            VclkTheme {
                AppRoot(vm)
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        intent.data?.let(vm::handleLink)
    }

    private fun openFile(event: UiEvent.OpenFile): Boolean {
        val uri = FileProvider.getUriForFile(this, "$packageName.files", event.file)
        val view = Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, event.mime)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        return try {
            startActivity(view)
            true
        } catch (_: ActivityNotFoundException) {
            false
        }
    }

    @Composable
    private fun AppRoot(vm: AppViewModel) {
        val snackbar = remember { SnackbarHostState() }
        LaunchedEffect(Unit) {
            vm.events.collect { event ->
                when (event) {
                    is UiEvent.Toast -> {
                        snackbar.currentSnackbarData?.dismiss()
                        snackbar.showSnackbar(
                            listOfNotNull(event.title, event.description?.takeIf { it.isNotBlank() }).joinToString(": "),
                        )
                    }
                    is UiEvent.OpenFile -> if (!openFile(event)) {
                        snackbar.showSnackbar("Нет приложения для открытия файла «${event.file.name}»")
                    }
                }
            }
        }

        Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
            val session = vm.roomSession
            val target = vm.joinTarget
            val invite = vm.inviteToken
            when {
                vm.serverUrl == null -> ServerScreen(vm)
                vm.checking -> CircularProgressIndicator(Modifier.align(Alignment.Center))
                invite != null -> InviteScreen(vm, invite)
                session != null -> RoomScreen(vm, session)
                vm.user == null -> AuthScreen(vm)
                target != null -> WaitingRoomScreen(vm, target)
                else -> MainScreen(vm)
            }
            SnackbarHost(snackbar, Modifier.align(Alignment.TopCenter).statusBarsPadding())
        }
    }
}
