package ru.asntl.vclk.util

enum class LinkKind { Text, Url, Email }

data class LinkToken(val text: String, val kind: LinkKind, val href: String? = null)

private val URL_IN_TEXT = Regex(
    "(https?://[^\\s<]+[^\\s<.,;:!?)]|www\\.[^\\s<]+[^\\s<.,;:!?)]|[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,})",
)

/** Делит текст на обычные фрагменты, ссылки (http/https/www) и e-mail — как `renderLinkedText` в вебе. */
fun tokenizeLinks(text: String): List<LinkToken> {
    val tokens = ArrayList<LinkToken>()
    var cursor = 0
    for (match in URL_IN_TEXT.findAll(text)) {
        if (match.range.first > cursor) tokens.add(LinkToken(text.substring(cursor, match.range.first), LinkKind.Text))
        val value = match.value
        tokens.add(
            when {
                value.startsWith("http://", ignoreCase = true) || value.startsWith("https://", ignoreCase = true) ->
                    LinkToken(value, LinkKind.Url, value)
                value.startsWith("www.", ignoreCase = true) -> LinkToken(value, LinkKind.Url, "https://$value")
                else -> LinkToken(value, LinkKind.Email, "mailto:$value")
            },
        )
        cursor = match.range.last + 1
    }
    if (cursor < text.length) tokens.add(LinkToken(text.substring(cursor), LinkKind.Text))
    return tokens
}
