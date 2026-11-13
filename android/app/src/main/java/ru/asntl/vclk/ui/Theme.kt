package ru.asntl.vclk.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withLink
import androidx.compose.ui.unit.dp
import ru.asntl.vclk.util.LinkKind
import ru.asntl.vclk.util.tokenizeLinks

object VclkColors {
    val Background = Color(0xFF0F1720)
    val Surface = Color(0xFF17222E)
    val SurfaceHigh = Color(0xFF1F2D3B)
    val Primary = Color(0xFF4C84FF)
    val Outline = Color(0xFF33465A)
    val Muted = Color(0xFF9FB0C3)
    val Danger = Color(0xFFFF6B6B)
    val Success = Color(0xFF4CD08A)
    val Rec = Color(0xFFE5484D)
}

private val DarkColors = darkColorScheme(
    primary = VclkColors.Primary,
    onPrimary = Color.White,
    primaryContainer = Color(0xFF244A99),
    onPrimaryContainer = Color.White,
    secondaryContainer = VclkColors.SurfaceHigh,
    onSecondaryContainer = Color(0xFFE8EEF5),
    background = VclkColors.Background,
    onBackground = Color(0xFFE8EEF5),
    surface = VclkColors.Surface,
    onSurface = Color(0xFFE8EEF5),
    surfaceVariant = VclkColors.SurfaceHigh,
    onSurfaceVariant = VclkColors.Muted,
    surfaceContainer = VclkColors.Surface,
    surfaceContainerHigh = VclkColors.SurfaceHigh,
    surfaceContainerHighest = VclkColors.SurfaceHigh,
    outline = VclkColors.Outline,
    outlineVariant = VclkColors.Outline,
    error = VclkColors.Danger,
    onError = Color.White,
)

@Composable
fun VclkTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = DarkColors, content = content)
}

/** Текст со кликабельными ссылками и e-mail (поведение как в описании встречи в вебе). */
@Composable
fun LinkedText(text: String, modifier: Modifier = Modifier, style: TextStyle = MaterialTheme.typography.bodyMedium) {
    val linkColor = MaterialTheme.colorScheme.primary
    val annotated = remember(text, linkColor) {
        buildAnnotatedString {
            for (token in tokenizeLinks(text)) {
                if (token.kind == LinkKind.Text || token.href == null) {
                    append(token.text)
                } else {
                    withLink(
                        LinkAnnotation.Url(
                            token.href,
                            TextLinkStyles(SpanStyle(color = linkColor, textDecoration = TextDecoration.Underline)),
                        ),
                    ) { append(token.text) }
                }
            }
        }
    }
    Text(annotated, modifier = modifier, style = style)
}

@Composable
fun LabeledValue(label: String, modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(
            label.uppercase(),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        content()
    }
}
